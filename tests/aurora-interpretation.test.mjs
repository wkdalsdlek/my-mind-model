import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { loadModule, createModuleLoader } from './helpers/load-typescript.mjs';

const { createQuestionnaireState, questionnaireReducer: reduce } = loadModule('lib/questionnaire-state.ts');
const { createKeywordPools, createSelectedCapsule, createCustomKeyword, QUESTIONS } = loadModule('lib/capsules.ts');
const { prepareAuroraResult, validateAuroraAnalysisResponse } = loadModule('lib/aurora-result.ts');
const { buildAuroraRibbonMeaningMap } = loadModule('lib/aurora-ribbon-meaning.ts');
const { buildAuroraInterpretationRequest, prepareAuroraInterpretation } = loadModule('lib/aurora-interpretation.ts');
const { philosophyQuoteCandidates, resolvePhilosophyQuote, isVerifiedPhilosophyQuote, prepareInspiredPhilosophyDraft } = loadModule('lib/philosophy-quotes.ts');
const { interpretationResponseFormat, interpretationModelInput, parseAuroraInterpretation, createAuroraInterpretationHandler,
  logInterpretationDiagnostic, INTERPRETATION_MODEL, INTERPRETATION_REASONING_EFFORT, INTERPRETATION_LIMITS,
  INTERPRETATION_MAX_COMPLETION_TOKENS } = loadModule('lib/server/aurora-interpretation-service.ts');
const { createAnalysisHandler } = loadModule('lib/server/analysis-service.ts');
const { closingInputFingerprint, validateClosingMessageInput } = loadModule('lib/closing-message.ts');
const pools = createKeywordPools();
function state(kind = 'mixed', sentence = '내 시간을 지키며 함께 걸어간다') {
  let s = createQuestionnaireState();
  const rows = kind === 'neutral' ? {} : kind === 'single' ? { 0: [11] } : { 0: [1, 2, 3, 11], 2: [0], 3: [0], 6: [0], 7: [0], 8: [0] };
  for (let i = 0; i < 9; i++) {
    for (const index of rows[i] ?? []) s = reduce(s, { type: 'select', step: i, selection: createSelectedCapsule(pools[i][index], `q${i + 1}`, `test-${i}-${index}`) });
    if (!s.selections[i].length) s = reduce(s, { type: 'skip', step: i });
  }
  s = reduce(s, { type: 'closing-input', field: 'authoredText', text: sentence });
  return reduce(s, { type: 'closing-approve', direct: true, approvedAt: '2026-10-15T07:00:00.000Z' });
}
const input = (s = state(), quality = 'balanced', flow = 'hybrid') => buildAuroraInterpretationRequest(s, quality, flow);
const context = () => prepareAuroraInterpretation(input());
const grounded = (refs, text = '실제 표현에서 서로 다른 가치를 함께 살피려는 가능성을 읽어 볼 수 있습니다.') => ({ text, evidenceRefs: refs, basis: refs.length ? 'answer-grounded' : 'insufficient-evidence' });
function fixture(c) {
  return { auroraName: '함께 흐르는 나의 시간', quoteId: philosophyQuoteCandidates()[0].quoteId,
    q10Anchor: '내 시간', quoteReason: ['내 시간을 지키려는 승인 문장의 주제가 자신의 시간을 되찾는 관점과 닿아 있습니다.'],
    overall: grounded(c.facts.questions.flatMap(q => q.evidence.map(e => e.ref))),
    ribbons: Object.fromEntries(c.facts.ribbons.map(r => [r.ribbonId, { ribbonId: r.ribbonId,
      psychological: grounded(r.evidence.map(e => e.ref)), philosophical: grounded(r.evidence.map(e => e.ref), '가치가 함께 머무는 방식은 삶의 방향을 돌아볼 계기가 될 수 있습니다.'),
      reflectionQuestion: '이 가치들을 일상에서 어떻게 함께 돌보고 싶나요?' }])) };
}
const completion = (c, extra = {}) => ({ content: JSON.stringify(fixture(c)), finishReason: 'stop', refused: false,
  usage: { promptTokens: 4000, completionTokens: 6000, totalTokens: 10000, reasoningTokens: 2500 }, ...extra });
const request = (body = input(), opts = {}) => new Request('http://127.0.0.1:3000/api/aurora-interpretation', { method: 'POST',
  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), ...opts });
function service(complete = async ({ context }) => completion(context), apiKey = () => 'mock-only') {
  const calls = [], diagnostics = [];
  const handler = createAuroraInterpretationHandler({ apiKey, complete: async options => { calls.push(options); return complete(options); }, diagnostic: d => diagnostics.push(d) });
  return { handler, calls, diagnostics };
}
test('request, raw evidence, IDs and digest are deterministic without changing input or 5-A', async () => {
  const s = state(), before = structuredClone(s), payload = input(s), saved = structuredClone(payload);
  const a = await prepareAuroraInterpretation(payload), b = await prepareAuroraInterpretation(payload);
  assert.deepEqual(a, b); assert.deepEqual(payload, saved); assert.deepEqual(s, before);
  assert.match(a.binding.requestDigest, /^[a-f0-9]{64}$/);
  const p = prepareAuroraResult(s).snapshot.personalization;
  assert.deepEqual(a.facts.coreShares, p.coreShares); assert.deepEqual(a.facts.familyTrace, p.trace.families);
  assert.ok(a.facts.ribbons.some(r => r.composition.length > 1));
});
test('active ribbon counts 2–6 match actual renderer layouts for all quality and flow options', async () => {
  const counts = new Set();
  for (const kind of ['single', 'mixed', 'neutral']) for (const quality of ['low', 'balanced', 'high']) for (const flow of ['independent', 'hybrid', 'loop-emphasis']) {
    const s = state(kind), c = await prepareAuroraInterpretation(input(s, quality, flow));
    const map = buildAuroraRibbonMeaningMap(prepareAuroraResult(s).snapshot.personalization, { source: s, quality, flowMode: flow });
    assert.deepEqual(c.facts.ribbons.map(r => r.ribbonId), map.ribbons.filter(r => r.active).map(r => r.ribbonId));
    assert.equal(c.facts.ribbons.length, map.activeRibbonCount); counts.add(c.facts.ribbons.length);
  }
  assert.ok(counts.has(2) && counts.has(6));
});
test('Q3/Q7/Q8/Q9 remain contextual, cannot become ribbon core evidence', async () => {
  const c = await context();
  assert.deepEqual(c.facts.questions.filter(q => ['q3','q7','q8','q9'].includes(q.questionId)).map(q => q.evidence[0].role),
    ['currentAtmosphere','emotionalWish','releaseTarget','futureAspiration']);
  assert.ok(c.facts.ribbons.every(r => r.evidence.every(e => ['q1','q2','q4','q5','q6'].includes(e.questionId))));
  assert.equal(c.facts.context.rendererApplied, false);
});
test('unclassified custom words preserve raw whitespace and never acquire invented family evidence', async () => {
  let s = state('neutral');
  s = reduce(s, { type: 'select', step: 0, selection: createSelectedCapsule(createCustomKeyword('q1','  내 푸른 서랍  ','custom-raw'),'q1','raw-custom') });
  s = reduce(s, { type: 'closing-approve', direct: true, approvedAt: '2026-10-15T07:00:00.000Z' });
  const c = await prepareAuroraInterpretation(input(s));
  assert.equal(c.facts.unclassified[0].originalText, '  내 푸른 서랍  '); assert.equal(c.facts.unclassified[0].mapping, 'unclassified');
  assert.deepEqual(c.facts.coreShares, []); assert.ok(c.facts.ribbons.every(r => !r.evidence.length));
});
test('exact-custom matches still follow existing canonical keyword policy', async () => {
  let s = state('neutral');
  s = reduce(s, { type: 'select', step: 0, selection: createSelectedCapsule(createCustomKeyword('q1','  깊은 대화  ','custom-exact'),'q1','exact') });
  s = reduce(s, { type: 'closing-approve', direct: true, approvedAt: '2026-10-15T07:00:00.000Z' });
  const c = await prepareAuroraInterpretation(input(s));
  assert.equal(c.facts.questions[0].evidence[0].mapping, 'exact-custom'); assert.ok(c.facts.coreShares.length);
});
test('changing Q10 changes binding but never core shares or renderer profile', async () => {
  const a = await prepareAuroraInterpretation(input(state())), b = await prepareAuroraInterpretation(input(state('mixed','다른 시간을 함께 바라본다')));
  assert.notEqual(a.binding.requestDigest,b.binding.requestDigest); assert.deepEqual(a.facts.coreShares,b.facts.coreShares);
  assert.deepEqual(a.facts.ribbons,b.facts.ribbons);
});
test('stale approval fingerprint is rejected before any completion', async () => {
  const p = input(); p.closingInput.context[0].selections[0].originalText += ' '; const s = service();
  // Fixed-label tampering can be invalid input before the consistency check.
  assert.notEqual((await s.handler(request(p))).status,200); assert.equal(s.calls.length,0);
  const valid = input(); valid.approval.inputFingerprint += 'stale';
  const response = await s.handler(request(valid)); assert.equal(response.status,409); assert.equal((await response.json()).code,'APPROVAL_MISMATCH');
});
test('pending answers, forged fixed labels and client-computed weights are rejected', async () => {
  for (const mutate of [p => {p.closingInput.context[1].status='pending';},p=>{p.closingInput.context[0].selections[0].label='가짜';},
    p=>{p.appearance={palette:[]};},p=>{p.closingInput.context[0].selections[0].semanticWeights=[{familyId:'drive',weight:1}];}]) {
    const p=input();mutate(p); await assert.rejects(prepareAuroraInterpretation(p));
  }
  assert.throws(()=>buildAuroraInterpretationRequest(createQuestionnaireState()));
});
test('catalog source, exact excerpt and translation are pinned; mutable copies cannot alter it', () => {
  const list=philosophyQuoteCandidates(); assert.equal(list.length,3);
  for (const q of list) {assert.equal(isVerifiedPhilosophyQuote(q),true);assert.equal(q.mode,'direct');assert.equal(q.translation.origin,'project-translation');
    for(const mutate of [v=>v.source.url='https://example.com/fake',v=>v.originalText='invented',v=>v.philosopher='가짜 저자',v=>v.text='가짜 번역']) {
      const bad=structuredClone(q);mutate(bad);assert.equal(isVerifiedPhilosophyQuote(bad),false);
    }
  }
  list[0].source.url='https://example.com/changed';assert.notEqual(resolvePhilosophyQuote(list[0].quoteId).source.url,list[0].source.url);
  assert.equal(resolvePhilosophyQuote('invented'),null);
});
test('inspired lines never pass direct-quote validation or quote ID resolution', () => {
  assert.equal(isVerifiedPhilosophyQuote({mode:'inspired',quoteId:null,text:'창작 문장',philosopher:'세네카',displayAttribution:'세네카의 사상에서 영감을 받은 문장',isHistoricalQuotation:false}),false);
  const draft=prepareInspiredPhilosophyDraft('seneca-letters-1-1-self','나에게 돌아오는 시간도 삶의 일부입니다.','no-suitable-verified-quote');
  assert.equal(draft.mode,'inspired');assert.equal(draft.quoteId,null);assert.equal(draft.usable,false);
  assert.equal(draft.isHistoricalQuotation,false);assert.match(draft.displayAttribution,/영감을 받은 문장/);
  assert.equal(isVerifiedPhilosophyQuote(draft),false);assert.equal(prepareInspiredPhilosophyDraft('unknown','문장','no-suitable-verified-quote'),null);
});
test('schema contains every active ID and only supported basic schema constraints', async () => {
  const c=await context(),format=interpretationResponseFormat(c);assert.equal(format.json_schema.strict,true);
  const root=format.json_schema.schema;assert.deepEqual(root.properties.ribbons.required,c.facts.ribbons.map(r=>r.ribbonId));
  function walk(s){for(const key of Object.keys(s))assert.ok(['type','properties','required','additionalProperties','enum','items'].includes(key),key);
    if(s.type==='object'){assert.equal(s.additionalProperties,false);assert.deepEqual(s.required,Object.keys(s.properties));Object.values(s.properties).forEach(walk);}
    if(s.type==='array')walk(s.items);
  }walk(root);
  assert.equal(INTERPRETATION_MODEL,'gpt-6.1-sol');assert.equal(INTERPRETATION_REASONING_EFFORT,'medium');assert.equal(INTERPRETATION_MAX_COMPLETION_TOKENS,25000);
  assert.equal(INTERPRETATION_LIMITS.attemptMs,70000);assert.equal(INTERPRETATION_LIMITS.workMs,85000);
  assert.equal(INTERPRETATION_LIMITS.totalMs,95000);assert.equal(INTERPRETATION_LIMITS.maxAttempts,2);
});
test('valid output assembles exact code facts, catalog quote, approved text and stable order', async () => {
  const c=await context(),saved=structuredClone(c),body=fixture(c);body.ribbons=Object.fromEntries(Object.entries(body.ribbons).reverse());
  const result=parseAuroraInterpretation(JSON.stringify(body),c);
  assert.deepEqual(result.facts,c.facts);assert.deepEqual(c,saved);assert.deepEqual(result.generated.ribbons.map(r=>r.ribbonId),c.facts.ribbons.map(r=>r.ribbonId));
  assert.deepEqual(result.generated.philosophy.line,resolvePhilosophyQuote(body.quoteId));assert.equal(result.approvedClosing.text,c.approvedClosing.text);
});
test('neutral fallback suppresses unsupported model psychological text explicitly', async () => {
  const c=await prepareAuroraInterpretation(input(state('neutral'))),b=fixture(c);
  const result=parseAuroraInterpretation(JSON.stringify(b),c);
  result.generated.ribbons.forEach(r=>{assert.equal(r.psychological.origin,'deterministic-insufficient-evidence');assert.deepEqual(r.psychological.evidenceRefs,[]);assert.match(r.psychological.text,/근거/);});
});
const corruptions=[
  ['missing overall',b=>{delete b.overall;}],['empty overall',b=>{b.overall.text=' ';}],['wrong field type',b=>{b.overall.text=12;}],
  ['missing ribbon',b=>{delete b.ribbons[Object.keys(b.ribbons)[0]];}],['extra ribbon',b=>{b.ribbons['aurora-ribbon-v1:loop:9']=Object.values(b.ribbons)[0];}],
  ['duplicate ribbon identity',b=>{Object.values(b.ribbons)[1].ribbonId=Object.keys(b.ribbons)[0];}],
  ['invented selection reference',b=>{Object.values(b.ribbons)[0].psychological.evidenceRefs=['selection:q1:999'];}],
  ['unselected quoted keyword',b=>{Object.values(b.ribbons)[0].psychological.text='「선택하지 않은 가짜 키워드」에서 태도를 읽습니다.';}],
  ['unknown keyword field',b=>{Object.values(b.ribbons)[0].keywords=['추가 키워드'];}],
  ['wrong Q10 topic',b=>{b.q10Anchor='선택하지 않은 주제';}],['unrelated reason',b=>{b.quoteReason=['누구에게나 어울리는 아름다운 말입니다.'];}],
  ['too many reason sentences',b=>{b.quoteReason=['내 시간의 의미입니다. 다시 설명합니다. 또 설명합니다.'];}],
  ['invalid quote ID',b=>{b.quoteId='invented';}],['invented quote text',b=>{b.quoteText='가짜 인용';}],
  ['Q10 overwritten',b=>{b.approvedClosing={text:'새 문장'};}],['visual facts invented',b=>{Object.values(b.ribbons)[0].color='#ffffff';}],
  ['diagnostic certainty',b=>{b.overall.text='당신의 진정한 본성은 이렇습니다.';}],
  ['context moved into ribbon traits',b=>{Object.values(b.ribbons)[0].psychological.evidenceRefs=['selection:q7:0'];}],
  ['context omitted from overall',b=>{b.overall.evidenceRefs=b.overall.evidenceRefs.filter(id=>!id.startsWith('selection:q8:'));}],
  ['approval omitted from overall',b=>{b.overall.evidenceRefs=b.overall.evidenceRefs.filter(id=>id!=='approved:q10');}],
  ['closed reflection',b=>{Object.values(b.ribbons)[0].reflectionQuestion='이미 정해진 방향입니다.';}],
];
for(const [label,mutate]of corruptions)test(`${label} cannot become a successful interpretation`,async()=>{
  const c=await context(),b=fixture(c);mutate(b);assert.throws(()=>parseAuroraInterpretation(JSON.stringify(b),c));
});
test('invalid JSON and duplicate object keys are rejected before assembly',async()=>{
  const c=await context(),raw=JSON.stringify(fixture(c));
  for(const value of ['{',null,'null',raw.replace('{','{"auroraName":"중복",'),raw.replace('"psychological":','"psychological":{},"psychological":')])assert.throws(()=>parseAuroraInterpretation(value,c));
});
test('visual facts exactly match actual layer render keys, color pairs, seed and profiles',async()=>{
  const s=state(),c=await prepareAuroraInterpretation(input(s)),p=prepareAuroraResult(s).snapshot.personalization;
  const map=buildAuroraRibbonMeaningMap(p,{source:s});
  c.facts.ribbons.forEach(r=>{const expected=map.ribbons.find(v=>v.ribbonId===r.ribbonId);assert.deepEqual(r.layers,expected.layers);assert.deepEqual(r.visualExplanation,expected.visualExplanation);assert.deepEqual(r.composition,expected.composition);});
  assert.ok(c.facts.ribbons.every(r=>r.visualExplanationText.origin==='deterministic-code'));
});
test('normal HTTP response contains every active ribbon and no legacy API replacement',async()=>{
  const s=service(),response=await s.handler(request());assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');
  const body=await response.json();assert.equal(body.interpretation.generated.ribbons.length,s.calls[0].context.facts.ribbons.length);assert.equal(s.calls.length,1);
});
test('validation failure retries once and successful replacement is returned once',async()=>{
  const s=service(async({context,attempt})=>completion(context,attempt===1?{content:'{}'}:{}));
  assert.equal((await s.handler(request())).status,200);assert.deepEqual(s.calls.map(v=>v.attempt),[1,2]);
});
test('final malformed output has a safe error and exactly two attempts',async()=>{
  const s=service(async()=>({content:'{',finishReason:'stop',refused:false}));const response=await s.handler(request());
  assert.equal(response.status,502);assert.equal((await response.json()).code,'INTERPRETATION_RESPONSE_INVALID');assert.equal(s.calls.length,2);
});
test('no suitable verified quote is explicit and never automatically invented/retried',async()=>{
  const s=service(async({context})=>{const b=fixture(context);b.quoteId='none';return completion(context,{content:JSON.stringify(b)});});
  const response=await s.handler(request());assert.equal(response.status,422);assert.equal((await response.json()).code,'QUOTE_CANDIDATES_INSUFFICIENT');assert.equal(s.calls.length,1);
});
for(const [label,patch]of [['length',{finishReason:'length'}],['filtered',{finishReason:'content_filter'}],['missing finish',{finishReason:null}],['refusal',{refused:true}]])test(`${label} never returns partial success or spends another request`,async()=>{
  const s=service(async({context})=>completion(context,patch));assert.equal((await s.handler(request())).status,502);assert.equal(s.calls.length,1);
});
for(const [label,error,status]of [['network',new TypeError('private raw transport error'),502],['server',{status:500,message:'private raw server error'},502],['rate limit',{status:429,message:'private raw key'},429]])test(`${label} failure does not leak payloads or retry`,async()=>{
  const s=service(async()=>{throw error;});const response=await s.handler(request());assert.equal(response.status,status);assert.equal(s.calls.length,1);
  assert.ok(!(await response.text()).includes('private raw'));assert.ok(!JSON.stringify(s.diagnostics).includes('private raw'));
});
test('missing key, unsupported media and oversized/invalid request fail before model access',async()=>{
  const s=service(undefined,()=>undefined);assert.equal((await s.handler(request())).status,503);assert.equal(s.calls.length,0);
  for(const [req,status]of [[request(input(),{headers:{'Content-Type':'text/plain'}}),415],[request(input(),{headers:{'Content-Type':'application/json','content-length':'600000'}}),413],
    [request(input(),{body:'{'}),400],[request(input(),{headers:{'Content-Type':'application/json','sec-fetch-site':'cross-site'}}),403]])assert.equal((await service().handler(req)).status,status);
});
test('cancellation and late completion cannot return a stale success',async()=>{
  const controller=new AbortController(),s=service(async({context})=>{controller.abort();return completion(context);});
  assert.equal((await s.handler(request(input(),{signal:controller.signal}))).status,408);assert.equal(s.calls.length,1);
  const early=new AbortController();early.abort();const t=service();assert.equal((await t.handler(request(input(),{signal:early.signal}))).status,408);assert.equal(t.calls.length,0);
});
test('approved 70s attempt is bounded by 85s work and 95s total without timeout retry',async t=>{
  const observed=[],native=setTimeout;t.mock.method(performance,'now',()=>0);
  t.mock.method(globalThis,'setTimeout',(fn,ms,...args)=>{observed.push(ms);if(ms===70000){queueMicrotask(fn);return native(()=>{},1);}return native(fn,ms,...args);});
  const s=service();assert.equal((await s.handler(request())).status,408);assert.deepEqual(observed,[85000,95000,70000]);assert.equal(s.calls.length,1);
});
test('actual streamed body limit is enforced even without Content-Length',async()=>{
  const s=service(),r=request(input(),{body:' '.repeat(INTERPRETATION_LIMITS.bodyBytes+1)});
  assert.equal((await s.handler(r)).status,413);assert.equal(s.calls.length,0);
});
test('valid but excessive model input is rejected before a paid request',async()=>{
  const p=input(state('neutral'));
  for(const index of [0,1,3]){
    const q=p.closingInput.context[index];q.status='answered';q.selections=Array.from({length:100},(_,i)=>({keywordId:`custom-${index}-${i}`,selectionId:`sel-${index}-${String(i).padStart(3,'0')}`,
      questionId:q.questionId,answerIntent:p.closingInput.context[index].questionId==='q1'?'selfExperience':index===1?'recoverySource':'relationshipValue',
      label:`분류되지 않은 개인 표현 ${i}`,originalText:`분류되지 않은 개인 표현 ${i}`,source:'custom'}));
  }
  p.closingInput=validateClosingMessageInput(p.closingInput);
  p.approval.inputFingerprint=closingInputFingerprint(p.closingInput);
  const s=service();assert.equal((await s.handler(request(p))).status,413);assert.equal(s.calls.length,0);
});
test('response evidence excludes raw aliases from unrelated ribbons despite a valid selection ID',async()=>{
  const c=await context(),b=fixture(c),r=c.facts.ribbons.find(r=>c.facts.questions.flatMap(q=>q.evidence).some(e=>e.role==='core'&&!r.evidence.some(v=>v.ref===e.ref)));
  assert.ok(r);const other=c.facts.questions.flatMap(q=>q.evidence).find(e=>e.role==='core'&&!r.evidence.some(v=>v.ref===e.ref));
  b.ribbons[r.ribbonId].philosophical.evidenceRefs=[other.ref];assert.throws(()=>parseAuroraInterpretation(JSON.stringify(b),c));
});
test('model input excludes lossless approval fingerprint and original state machinery',async()=>{
  const c=await context(),p=input(),data=JSON.stringify(interpretationModelInput(c));
  assert.ok(!data.includes(p.approval.inputFingerprint));assert.ok(!data.includes('inputFingerprint'));assert.ok(!data.includes('approvedAt'));assert.ok(!data.includes('comments'));
});
test('diagnostics allowlist numeric metadata and count reasoning only within completion tokens',()=>{
  const old=process.env.NODE_ENV,oldPreview=process.env.VERCEL_ENV,info=console.info,entries=[];process.env.NODE_ENV='development';process.env.VERCEL_ENV='preview';console.info=(...args)=>entries.push(args);
  try{logInterpretationDiagnostic({attempt:1,outcome:'success',finishReason:'stop',expectedRibbons:5,promptTokens:1000,completionTokens:2000,reasoningTokens:1200,
    apiKey:'DO_NOT_LOG',inputFingerprint:'DO_NOT_LOG',content:'DO_NOT_LOG',requestDigest:'DO_NOT_LOG'});
    assert.equal(entries.length,1);assert.ok(!JSON.stringify(entries).includes('DO_NOT_LOG'));assert.equal(entries[0][1].estimatedStandardCostUsd,.022);
  }finally{console.info=info;if(old===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=old;if(oldPreview===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=oldPreview;}
});
test('legacy analyze still returns exactly ten comments; its prompt/model contract is unchanged',async()=>{
  const handler=createAnalysisHandler({apiKey:()=> 'mock-only',complete:async()=>({content:JSON.stringify({analyses:Object.fromEntries(Array.from({length:10},(_,i)=>[`q${i+1}`,{questionId:`q${i+1}`,analysis:'기존 요약',detailedAnalysis:'기존 상세'}]))}),finishReason:'stop',refused:false})});
  const response=await handler(new Request('http://localhost/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({questions:QUESTIONS,answers:QUESTIONS.map(()=> '기존 답변')})}));
  assert.equal(response.status,200);assert.equal(validateAuroraAnalysisResponse(await response.json()).valid,true);
});
test('new route adapter keeps model, medium, timeout, strict schema and SDK retries off without real calls',async()=>{
  let options,config,calls=0;
  class MockOpenAI{constructor(value){config=value;this.chat={completions:{create:async(request)=>{options=request;calls++;const c=await context();const b=completion(c);return {choices:[{finish_reason:'stop',message:{content:b.content}}],usage:{prompt_tokens:100,completion_tokens:200,total_tokens:300}};}}};}}
  const old=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='mock-only';
  try{const routeAdapter=createModuleLoader({openai:MockOpenAI,"../../../lib/server/security/api":{protectAI:(_feature,handler)=>req=>handler(req,{run:(_params,call)=>call()})}})('app/api/aurora-interpretation/route.ts');assert.equal((await routeAdapter.POST(request())).status,200);
    assert.equal(calls,1);assert.equal(config.maxRetries,0);assert.equal(config.logLevel,'off');assert.ok(config.timeout>0&&config.timeout<=70000);
    assert.equal(options.model,'gpt-6.1-sol');assert.equal(options.reasoning_effort,'medium');assert.equal(options.max_completion_tokens,25000);assert.equal(options.response_format.json_schema.strict,true);
    for(const key of ['temperature','top_p','logprobs','max_tokens'])assert.ok(!(key in options));
  }finally{if(old===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=old;}
  const ui=readFileSync(new URL('../components/result/AuroraResultScreen.tsx',import.meta.url),'utf8');assert.ok(!ui.includes('/api/aurora-interpretation'));
});
