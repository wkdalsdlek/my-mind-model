import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { loadModule } from './helpers/load-typescript.mjs';
import { universeState, universeFixture, interpretationForRequest } from './helpers/aurora-universe-fixture.mjs';
const { AuroraUniverseRequestController, universeRibbonLayout, auroraUniverseFailureMessage } = loadModule('lib/aurora-universe.ts');
const { validateAuroraInterpretationResponse } = loadModule('lib/aurora-interpretation-validation.ts');
const { questionnaireReducer: reduce, getApprovedClosingMessage } = loadModule('lib/questionnaire-state.ts');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function until(fn) { for (let i = 0; i < 1000; i++) { if (fn()) return; await new Promise(r => setImmediate(r)); } assert.fail('fixture did not become ready'); }
function callbacks(current = () => true) {
  const events = [], results = [], phases = [];
  return { events, results, phases, hooks: { isCurrent: current, start: () => events.push('start'), phase: p => phases.push(p),
    success: r => { events.push('success'); results.push(r); }, failure: code => events.push(code), settled: () => events.push('settled') } };
}
const goodFetch = async (_, options) => Response.json(await interpretationForRequest(JSON.parse(options.body)));
test('current approval produces one new API request, no legacy comments, and one fully bound result', async () => {
  const s = universeState(), before = structuredClone(s), observed = callbacks(), calls = [];
  const controller = new AuroraUniverseRequestController(async (url, options) => { calls.push(url); return goodFetch(url, options); });
  await controller.generate(s, observed.hooks);
  assert.deepEqual(calls, ['/api/aurora-interpretation']); assert.deepEqual(observed.events, ['start','success','settled']);
  assert.deepEqual(observed.phases, ['preparing','requesting','validating']); assert.equal(controller.busy, false);
  assert.equal(observed.results[0].status,'interpreted'); assert.ok(!('comments' in observed.results[0])); assert.deepEqual(s,before);
  assert.equal(observed.results[0].context.binding.requestDigest, observed.results[0].interpretation.binding.requestDigest);
});
test('synchronous lock covers digest preparation as well as HTTP; duplicate clicks send one request', async () => {
  const wait = deferred(); let calls = 0; const observed = callbacks();
  const controller = new AuroraUniverseRequestController(async (...args) => { calls++; await wait.promise; return goodFetch(...args); });
  const first = controller.generate(universeState(), observed.hooks); assert.equal(controller.busy,true);
  await controller.generate(universeState(), observed.hooks); await until(()=>calls===1); assert.equal(calls,1);
  wait.resolve(); await first; assert.equal(observed.results.length,1);
});
test('all nine answered questions and approved Q10 reach one validated result without changing question contexts', async () => {
  const s=universeState('all'), saved=structuredClone(s), o=callbacks();
  await new AuroraUniverseRequestController(goodFetch).generate(s,o.hooks);
  const r=o.results[0];assert.ok(r);assert.deepEqual(s,saved);
  assert.equal(r.context.facts.questions.length,10);
  for(const q of r.context.facts.questions) assert.ok(q.evidence.length);
  assert.ok(r.interpretation.generated.overall.evidenceRefs.includes('approved:q10'));
  for(const id of ['q3','q7','q8','q9']){
    const refs=r.context.facts.questions.find(q=>q.questionId===id).evidence.map(e=>e.ref);
    assert.ok(refs.some(ref=>r.interpretation.generated.overall.evidenceRefs.includes(ref)));
    for(const ribbon of r.context.facts.ribbons)assert.ok(ribbon.evidence.every(e=>!refs.includes(e.ref)));
  }
});
test('response arrays can be reordered but identities are never guessed by index/color', async () => {
  const r = await universeFixture(), body = { interpretation: structuredClone(r.interpretation) };
  body.interpretation.generated.ribbons.reverse();
  const parsed = validateAuroraInterpretationResponse(body,r.context);
  assert.deepEqual(parsed.generated.ribbons.map(v=>v.ribbonId),r.context.facts.ribbons.map(v=>v.ribbonId));
});
const corruptions = [
  ['digest', r=>{r.binding.requestDigest='0'.repeat(64);}], ['quality binding',r=>{r.binding.quality='low';}],
  ['approval text',r=>{r.approvedClosing.text='別 문장';}], ['fact color',r=>{r.facts.ribbons[0].layers[0].visual.colorA.color='#ffffff';}],
  ['fact keyword',r=>{r.facts.questions[0].evidence[0].originalText='선택하지 않은 표현';}],
  ['duplicate ribbon ID',r=>{r.generated.ribbons[1].ribbonId=r.generated.ribbons[0].ribbonId;}],
  ['missing ribbon',r=>{r.generated.ribbons.pop();}], ['wrong ribbon ID',r=>{r.generated.ribbons[0].ribbonId='aurora-ribbon-v1:loop:99';}],
  ['empty overall',r=>{r.generated.overall.text=' ';}], ['quote source',r=>{r.generated.philosophy.line.source.url='https://example.com/fake';}],
  ['inspired draft',r=>{r.generated.philosophy.line.mode='inspired';r.generated.philosophy.line.quoteId=null;}],
  ['AI origin relabel',r=>{r.generated.overall.origin='deterministic-insufficient-evidence';}],
];
for(const [label,mutate] of corruptions)test(`${label} mismatch is rejected at the browser boundary`, async()=>{
  const r=await universeFixture(),body={interpretation:structuredClone(r.interpretation)};mutate(body.interpretation);
  assert.throws(()=>validateAuroraInterpretationResponse(body,r.context));
});
test('a changed neutral explanation cannot masquerade as a deterministic note',async()=>{
  const r=await universeFixture(universeState('neutral')),body={interpretation:structuredClone(r.interpretation)};
  body.interpretation.generated.ribbons[0].psychological.text='확인되지 않은 나의 성격 설명입니다.';
  assert.throws(()=>validateAuroraInterpretationResponse(body,r.context));
});
test('quote shortage alone enters an explicit no-quote universe without inventing analysis',async()=>{
  const observed=callbacks();let calls=0;const controller=new AuroraUniverseRequestController(async()=>{calls++;return Response.json({code:'QUOTE_CANDIDATES_INSUFFICIENT'},{status:422});});
  const s=universeState(),before=structuredClone(s);await controller.generate(s,observed.hooks);
  assert.equal(calls,1);assert.equal(observed.results[0].status,'quote-unavailable');assert.equal(observed.results[0].interpretation,null);
  assert.ok(observed.results[0].context.facts.ribbons.length);assert.deepEqual(s,before);assert.ok(getApprovedClosingMessage(s));
});
test('a bogus success without interpretation is never treated as a no-quote fallback',async()=>{
  const o=callbacks();await new AuroraUniverseRequestController(async()=>Response.json({code:'QUOTE_CANDIDATES_INSUFFICIENT'})).generate(universeState(),o.hooks);
  assert.deepEqual(o.events,['start','INTERPRETATION_RESPONSE_INVALID','settled']);assert.equal(o.results.length,0);
});
for(const [label,fetcher,code]of [
  ['no key',async()=>Response.json({code:'AI_NOT_CONFIGURED'},{status:503}),'AI_NOT_CONFIGURED'],
  ['model/server failure',async()=>Response.json({code:'INTERPRETATION_FAILED'},{status:502}),'INTERPRETATION_FAILED'],
  ['server deadline',async()=>Response.json({code:'INTERPRETATION_FAILED'},{status:408}),'REQUEST_TIMEOUT'],
  ['stale approval',async()=>Response.json({code:'APPROVAL_MISMATCH'},{status:409}),'APPROVAL_MISMATCH'],
  ['invalid output',async()=>Response.json({code:'INTERPRETATION_RESPONSE_INVALID'},{status:502}),'INTERPRETATION_RESPONSE_INVALID'],
  ['broken JSON',async()=>new Response('{'),'INTERPRETATION_RESPONSE_INVALID'],
  ['network',async()=>{throw new Error('PRIVATE_TRANSPORT_MARKER');},'CONNECTION_FAILED'],
])test(`${label} preserves answers, unlocks and permits one explicit retry`,async()=>{
  let calls=0;const o=callbacks(),state=universeState(),saved=structuredClone(state);
  const c=new AuroraUniverseRequestController((...args)=>calls++?goodFetch(...args):fetcher(...args));
  await c.generate(state,o.hooks);assert.equal(c.busy,false);assert.equal(calls,1);assert.deepEqual(o.events,['start',code,'settled']);assert.deepEqual(state,saved);
  await c.generate(state,o.hooks);assert.equal(calls,2);assert.equal(o.results.length,1);assert.ok(!auroraUniverseFailureMessage(code).includes('PRIVATE'));
});
test('cancelling an abort-ignoring fetch releases the old lock without touching a newer request',async()=>{
  const old=deferred(),recent=deferred();let calls=0;const first=callbacks(),second=callbacks();
  const c=new AuroraUniverseRequestController(async(...args)=>{const p=calls++?recent:old;await p.promise;return goodFetch(...args);});
  const a=c.generate(universeState(),first.hooks);await until(()=>calls===1);c.cancel();await a;
  const b=c.generate(universeState(),second.hooks);await until(()=>calls===2);old.resolve();await new Promise(r=>setImmediate(r));
  assert.equal(c.busy,true);assert.deepEqual(first.events,['start','settled']);recent.resolve();await b;assert.equal(second.results.length,1);
});
test('unmount cancellation suppresses late success, errors and settled callback',async()=>{
  const wait=deferred(),o=callbacks();let started=false;
  const c=new AuroraUniverseRequestController(async()=>{started=true;await wait.promise;return Response.json({},{status:500});});
  const p=c.generate(universeState(),o.hooks);await until(()=>started);c.cancel(false);await p;wait.resolve();assert.deepEqual(o.events,['start']);
});
test('changing current approval while JSON is pending prevents a stale transition',async()=>{
  const json=deferred();let current=true,reading=false;const o=callbacks(()=>current);
  const c=new AuroraUniverseRequestController(async()=>({ok:true,json:()=>{reading=true;return json.promise;}}));
  const p=c.generate(universeState(),o.hooks);await until(()=>reading);current=false;json.resolve({});await p;
  assert.deepEqual(o.events,['start','settled']);
});
test('client timeout unlocks even an abort-ignoring transport, with no automatic paid retry',async()=>{
  const never=deferred(),o=callbacks();let calls=0;
  const c=new AuroraUniverseRequestController(async()=>{calls++;return never.promise;},20);
  await c.generate(universeState(),o.hooks);assert.equal(c.busy,false);assert.ok(calls<=1);assert.deepEqual(o.events,['start','REQUEST_TIMEOUT','settled']);
  never.resolve(Response.json({}));
});
test('result transition errors are distinct from network errors',async()=>{
  const o=callbacks();o.hooks.success=()=>{throw new Error('PRIVATE_UI_MARKER');};const c=new AuroraUniverseRequestController(goodFetch);
  await c.generate(universeState(),o.hooks);assert.deepEqual(o.events,['start','RESULT_TRANSITION_FAILED','settled']);
});
test('unapproved/stale state never starts a request; current callback can block preparation',async()=>{
  let calls=0;const c=new AuroraUniverseRequestController(async()=>{calls++;return Response.json({});});
  const stale=reduce(universeState(),{type:'closing-edit',text:'다시 승인할 문장'}),o=callbacks();await c.generate(stale,o.hooks);
  assert.deepEqual(o.events,['APPROVAL_MISMATCH']);await c.generate(universeState(),callbacks(()=>false).hooks);assert.equal(calls,0);
});
test('default browser fetch keeps its native invocation context',async()=>{
  const saved=globalThis.fetch;try{globalThis.fetch=function(...args){assert.equal(this,globalThis);return goodFetch(...args);};
    const o=callbacks();await new AuroraUniverseRequestController().generate(universeState(),o.hooks);assert.equal(o.results.length,1);
  }finally{globalThis.fetch=saved;}
});
test('all quality changes preserve exact meanings and active IDs for two through six ribbons',async()=>{
  for(const kind of ['single','mixed','neutral'])for(const flow of ['independent','hybrid','loop-emphasis']){
    const r=await universeFixture(universeState(kind),'balanced',flow),saved=structuredClone(r);
    for(const q of ['low','balanced','high']){const list=universeRibbonLayout(r,q);assert.ok(list);assert.deepEqual(list.map(v=>v.ribbonId),r.context.facts.ribbons.map(v=>v.ribbonId));
      assert.deepEqual(list.map(v=>v.composition),r.context.facts.ribbons.map(v=>v.composition));}
    assert.deepEqual(r,saved);
  }
});
test('quality helper refuses a mismatch rather than guessing by a similar color',async()=>{
  const r=await universeFixture();r.context.facts.ribbons[0].ribbonId='aurora-ribbon-v1:curtain:99';assert.equal(universeRibbonLayout(r,'high'),null);
});
test('normal page generation imports the new controller and never calls the legacy controller',()=>{
  const page=readFileSync(new URL('../components/MindJourney.tsx',import.meta.url),'utf8');
  assert.ok(page.includes('AuroraUniverseRequestController'));assert.ok(!page.includes('AuroraAnalysisRequestController'));assert.ok(!page.includes('/api/analyze'));
  assert.ok(page.includes('approval.text === snapshot.personalization.approvedTitle.text'));
});
