import test from 'node:test';
import assert from 'node:assert/strict';
import { createModuleLoader, loadModule } from './helpers/load-typescript.mjs';
import { universeState, universeFixture, universeModelResponse, universeProviderResponse } from './helpers/aurora-universe-fixture.mjs';
const service = loadModule('lib/server/aurora-interpretation-service.ts');
const provider = loadModule('lib/server/aurora-interpretation-provider.ts');
const { buildAuroraInterpretationRequest: build } = loadModule('lib/aurora-interpretation.ts');
const fixture = (kind = 'all', flow = 'hybrid') => universeFixture(universeState(kind), 'balanced', flow, '일과 일상을 함께 돌보는 상황을 돌아보고 싶습니다.');
const request = payload => new Request('https://preview.example.invalid/api/aurora-interpretation', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
const bytes = v => Buffer.byteLength(JSON.stringify(v),'utf8');

for (const kind of ['all', 'neutral', 'single']) test(`compact v2 roundtrips every prose/evidence field and full HTTP contract: ${kind}`, async () => {
  const {context,interpretation} = await fixture(kind);
  const before = JSON.stringify(context);
  assert.deepEqual(provider.parseInterpretationProviderResponse(JSON.stringify(universeProviderResponse(context)),context),interpretation);
  assert.equal(JSON.stringify(context),before);
});
test('v1 provider request and parser remain unchanged', async () => {
  const {context,interpretation}=await universeFixture();
  const p=provider.interpretationProviderRequest(context);
  assert.deepEqual(p.responseFormat,service.interpretationResponseFormat(context));
  assert.deepEqual(p.input,service.interpretationModelInput(context));
  assert.equal(p.systemPrompt,service.interpretationSystemPrompt(context));
  assert.deepEqual(provider.parseInterpretationProviderResponse(JSON.stringify(universeModelResponse(context)),context),interpretation);
});
test('v2 compact input retains all exact selections, question roles, semantic weights, repeats, Q10 and quote catalog', async () => {
  const {context}=await fixture(),p=provider.interpretationProviderRequest(context),legacy=service.interpretationModelInput(context);
  for (let i=0;i<context.facts.questions.length;i++) {
    const q=context.facts.questions[i],v=p.input.questions[i];
    assert.equal(v.questionId,q.questionId);assert.equal(v.answerIntent,q.answerIntent);assert.equal(v.prompt,q.prompt);assert.equal(v.status,q.status);
    for(let j=0;j<q.evidence.length;j++){const e=q.evidence[j];for(const key of ['role','label','originalText','mapping','semanticWeights','coreContributions'])assert.deepEqual(v.evidence[j][key],e[key]);}
  }
  assert.deepEqual(p.input.coreShares,legacy.coreShares);assert.deepEqual(p.input.repeatedTexts,legacy.repeatedTexts);assert.deepEqual(p.input.quotes,legacy.quotes);
  assert.equal(p.input.approvedClosing.text,context.approvedClosing.text);assert.equal(p.input.situation.rawText,context.situation.rawText);
  for(let i=0;i<context.facts.ribbons.length;i++) {const r=context.facts.ribbons[i];assert.deepEqual(p.input.ribbons[i].composition,r.composition);assert.deepEqual(p.input.ribbons[i].paletteOrigins,r.paletteOrigins);assert.equal(p.input.ribbons[i].ribbonId,r.ribbonId);}
  assert.ok(bytes(p.input)<bytes(legacy));
  assert.ok(!JSON.stringify(p.input).includes('inputFingerprint'));
});
test('compressed structure reduces overhead while preserving EVERY requested deep paragraph and its prose length guidance', async () => {
  const {context}=await fixture(),p=provider.interpretationProviderRequest(context),compact=universeProviderResponse(context),full=universeModelResponse(context);
  assert.ok(bytes(compact)<bytes(full)*.8);assert.equal(Object.keys(compact.report).length,6);
  for(const r of Object.values(compact.ribbons))assert.deepEqual(Object.keys(r),['psychological','philosophical','currentMind','reportSummary','reflectionQuestion']);
  for(const guide of ['400~700','180~350','150~300','150~250','200~400','350~600'])assert.ok(p.systemPrompt.includes(guide));
  assert.equal(p.responseFormat.json_schema.strict,true);
  const walk=v=>{if(!v||typeof v!=='object')return;if(v.type==='object'){assert.equal(v.additionalProperties,false);assert.deepEqual(v.required,Object.keys(v.properties));}for(const x of Object.values(v))walk(x);};walk(p.responseFormat);
});
test('compact references cannot invent evidence, duplicate refs, migrate Q3 into core, omit paragraphs or forge quote grounding', async () => {
  const {context}=await fixture(),id=context.facts.ribbons[0].ribbonId;
  const q3index=context.facts.questions.flatMap(q=>q.evidence).findIndex(e=>e.questionId==='q3');
  for(const mutate of [
    b=>b.overall.e.push('e999999'),b=>b.overall.e.push('e00'),b=>b.overall.e.push(b.overall.e[0]),
    b=>b.ribbons[id].psychological.e=[`e${q3index}`],b=>delete b.ribbons[id].currentMind,
    b=>delete b.report.letter,b=>b.report.letter.t='',b=>b.quoteId='invented-quote',b=>b.q10Anchor='선택에 없는 앵커',
    b=>b.report.letter.e=[],b=>b.overall.t='선택에 없는 “허구의 가치”가 있습니다.',b=>b.overall.extra='forged',
  ]) {const b=universeProviderResponse(context);mutate(b);assert.throws(()=>provider.parseInterpretationProviderResponse(JSON.stringify(b),context),e=>e.code==='INTERPRETATION_RESPONSE_INVALID');}
  const raw=JSON.stringify(universeProviderResponse(context));
  assert.throws(()=>provider.parseInterpretationProviderResponse(raw.replace('"auroraName":','"auroraName":"가짜","auroraName":'),context),e=>e.reason==='duplicate-key');
  assert.throws(()=>provider.parseInterpretationProviderResponse('{',context),e=>e.reason==='invalid-json');
});
test('unknown custom keywords preserve exact original text and stay unclassified in compact input', async () => {
  const {questionnaireReducer}=loadModule('lib/questionnaire-state.ts'),{createCustomKeyword,createSelectedCapsule}=loadModule('lib/capsules.ts');
  const state=universeState('all'),original='  나만의 아직 분류되지 않은 별  ';
  const edited=questionnaireReducer(state,{type:'select',step:0,selection:createSelectedCapsule(createCustomKeyword('q1',original,'local-custom'),'q1','local-selection')});
  // Changing an answer invalidates approval; approve the same authored sentence again.
  const approved=questionnaireReducer(edited,{type:'closing-approve',direct:true,approvedAt:'2026-10-19T00:00:00.000Z'});
  const {context}=await universeFixture(approved,'balanced','hybrid','합성 상황입니다.');
  const input=provider.interpretationProviderRequest(context).input;
  const entry=input.questions[0].evidence.find(e=>e.mapping==='unclassified');assert.ok(entry);assert.equal(entry.originalText,original);assert.deepEqual(entry.semanticWeights,[]);
});
test('adaptive deep retry refuses a too-short regeneration but still allows an early corrective retry', async () => {
  const {context}=await fixture();assert.equal(service.interpretationRetryMinimumMs(context,60000),75000);
  assert.equal(service.interpretationRetryMinimumMs(context,10000),20000);assert.equal(service.interpretationRetryMinimumMs(context,30000),37500);
  const v1=await universeFixture();assert.equal(service.interpretationRetryMinimumMs(v1.context,60000),75000);
});
test('handler retries a known validation reason once and gives the second request ONLY its allowlisted code', async () => {
  const payload=build(universeState('all'),'balanced','hybrid','합성 상황입니다.'),options=[],diagnostics=[];
  const handler=service.createAuroraInterpretationHandler({apiKey:()=> 'synthetic-only',parse:provider.parseInterpretationProviderResponse,diagnostic:v=>diagnostics.push(v),complete:async o=>{
    options.push(o.validationFailure);const raw=universeProviderResponse(o.context);if(o.attempt===1)raw.overall.e.push('e999');return {content:JSON.stringify(raw),finishReason:'stop'};
  }});
  assert.equal((await handler(request(payload))).status,200);assert.deepEqual(options,[undefined,'evidence-mismatch']);assert.equal(diagnostics[0].retryDecision,'scheduled');
});
test('unexpected local validator failure never triggers a paid corrective retry or leaks its message', async () => {
  let calls=0;const diagnostics=[];
  const handler=service.createAuroraInterpretationHandler({apiKey:()=> 'synthetic',parse:()=>{throw new Error('PRIVATE_INTERNAL_ERROR');},diagnostic:v=>diagnostics.push(v),complete:async()=>{calls++;return {content:'{}',finishReason:'stop'};}});
  const response=await handler(request(build(universeState('all'),'balanced','hybrid','합성 상황입니다.')));assert.equal(response.status,502);assert.equal(calls,1);assert.equal(diagnostics[0].retryDecision,'not-retryable');assert.ok(!JSON.stringify(diagnostics).includes('PRIVATE_'));
});
test('Preview-only diagnostics accept fixed validation/retry codes and numbers, never arbitrary error text', t => {
  const old=process.env.VERCEL_ENV,logs=[];t.mock.method(console,'info',(...a)=>logs.push(a));
  try {process.env.VERCEL_ENV='preview';service.logInterpretationDiagnostic({attempt:1,outcome:'invalid-output',finishReason:'stop',expectedRibbons:5,validationReason:'evidence-mismatch',retryDecision:'scheduled',remainingWorkMs:50000,requiredRetryMs:30000,outputCharacters:1000});
    assert.equal(logs[0][1].validationReason,'evidence-mismatch');assert.equal(logs[0][1].remainingWorkMs,50000);
    service.logInterpretationDiagnostic({attempt:1,outcome:'invalid-output',finishReason:'stop',expectedRibbons:5,validationReason:'PRIVATE_PROMPT',retryDecision:'PRIVATE_RESPONSE',remainingWorkMs:Infinity});assert.ok(!JSON.stringify(logs).includes('PRIVATE_'));
    process.env.VERCEL_ENV='production';service.logInterpretationDiagnostic({attempt:1,outcome:'success',finishReason:'stop',expectedRibbons:5});assert.equal(logs.length,2);
  } finally {if(old===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=old;}
});
test('actual Next route sends compact strict v2 through the SAME cost permit and returns the original public contract', async () => {
  const {context,interpretation}=await fixture(),payload=build(universeState('all'),'balanced','hybrid','일과 일상을 함께 돌보는 상황을 돌아보고 싶습니다.');let calls=0,permits=0;const stages=[];const old=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='synthetic-only';
  class MockOpenAI {constructor(o){assert.equal(o.maxRetries,0);}chat={completions:{create:async params=>{calls++;assert.equal(params.model,'gpt-6.1-sol');assert.equal(params.reasoning_effort,'high');assert.equal(params.max_completion_tokens,25000);assert.equal(params.response_format.json_schema.name,'aurora_interpretation_compact_v2');return {choices:[{finish_reason:'stop',message:{content:JSON.stringify(universeProviderResponse(context))}}],usage:{prompt_tokens:1000,completion_tokens:2000,total_tokens:3000}};}}};}
  const {InterpretationDeadline}=loadModule('lib/server/interpretation-deadline.ts');const deadline=new InterpretationDeadline(new AbortController().signal);deadline.stage=v=>stages.push(v);
  const load=createModuleLoader({openai:MockOpenAI,'../../../lib/server/security/api':{protectAI:(_feature,handler)=>req=>handler(req,{run:(_p,call)=>{permits++;return call();}},deadline)}});
  try {const {POST}=load('app/api/aurora-interpretation/route.ts');const response=await POST(request(payload));assert.equal(response.status,200);assert.deepEqual((await response.json()).interpretation,interpretation);assert.equal(calls,1);assert.equal(permits,1);assert.ok(stages.includes('provider'));assert.ok(stages.includes('model-accounting'));assert.ok(stages.includes('validation'));}
  finally{deadline.dispose();if(old===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=old;}
});
test('route diagnoses a genuine SDK status separately from a local 408 budget/deadline error', async t => {
  const oldEnv=process.env.VERCEL_ENV,oldKey=process.env.OPENAI_API_KEY,logs=[];
  t.mock.method(console,'info',(...args)=>logs.push(args));
  class FakeAPIError extends Error { constructor(status){super('PRIVATE_PROVIDER_DETAIL');this.status=status;} }
  class MockOpenAI {static APIError=FakeAPIError;chat={completions:{create:async()=>{throw new FakeAPIError(429);}}};}
  try {process.env.VERCEL_ENV='preview';process.env.OPENAI_API_KEY='synthetic-only';
    for(const local of [false,true]) {
      const load=createModuleLoader({openai:MockOpenAI,'../../../lib/server/security/api':{protectAI:(_feature,handler)=>req=>handler(req,{run:(_p,call)=>{
        if(local){const error=new Error('PRIVATE_LOCAL_DETAIL');error.code='REQUEST_TIMEOUT';error.status=408;throw error;}return call();
      }})}});
      const {POST}=load('app/api/aurora-interpretation/route.ts');const response=await POST(request(build(universeState())));
      assert.equal(response.status,local?408:429);
      const diagnostic=logs.filter(row=>row[0]==='[aurora-interpretation-server]').at(-1)[1];
      if(local){assert.ok(!Object.hasOwn(diagnostic,'providerStatus'));assert.equal(diagnostic.abortSource,'insufficient-time');}
      else{assert.equal(diagnostic.providerStatus,429);assert.equal(diagnostic.outcome,'generation-failed');}
    }
    assert.ok(!JSON.stringify(logs).includes('PRIVATE_'));
  } finally {if(oldEnv===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=oldEnv;if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey;}
});
