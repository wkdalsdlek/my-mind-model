import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/load-typescript.mjs';
const settings=loadModule('lib/server/ai-model-settings.ts');
const policy=loadModule('lib/server/security/policy.ts');
const closing=loadModule('lib/server/closing-message-service.ts');
const analysis=loadModule('lib/server/analysis-service.ts');
const interpretation=loadModule('lib/server/aurora-interpretation-service.ts');
const sol={input:2,cachedInput:.1,output:10,maxInputTokens:16000,verifiedAt:'2026-10-19',source:'https://example.invalid/pricing'};
const env=()=>({VERCEL_ENV:'preview',AI_MODEL_PRICES_JSON:JSON.stringify({'gpt-6.1-sol':sol}),AI_USER_MONTH_USD:'50',AI_GLOBAL_DAY_USD:'50',AI_GLOBAL_MONTH_USD:'200',AI_GLOBAL_DAY_REQUESTS:'100',AI_GLOBAL_MONTH_REQUESTS:'1000',AI_GLOBAL_CONCURRENCY:'2'});

test('three features share one priced model while preserving separate low/high and one/two attempt contracts',()=>{
  assert.deepEqual(settings.AI_PRICED_MODELS,['gpt-6.1-sol']);
  assert.equal(closing.CLOSING_MESSAGE_MODEL,'gpt-6.1-sol');assert.equal(closing.CLOSING_MESSAGE_REASONING_EFFORT,'low');assert.equal(closing.CLOSING_MESSAGE_MAX_COMPLETION_TOKENS,4096);
  assert.deepEqual(policy.featureModel('closing'),{model:closing.CLOSING_MESSAGE_MODEL,output:closing.CLOSING_MESSAGE_MAX_COMPLETION_TOKENS,attempts:1});
  for(const feature of ['interpretation','analyze'])assert.deepEqual(policy.featureModel(feature),{model:'gpt-6.1-sol',output:25000,attempts:2});
  assert.equal(analysis.ANALYSIS_REASONING_EFFORT,'high');assert.equal(interpretation.INTERPRETATION_REASONING_EFFORT,'high');
  assert.equal(analysis.ANALYSIS_MAX_COMPLETION_TOKENS,25000);assert.equal(interpretation.INTERPRETATION_MAX_COMPLETION_TOKENS,25000);
});
test('a Sol-only Secret is sufficient; unused legacy pricing is neither required nor rewritten',()=>{
  const e=env(),before=e.AI_MODEL_PRICES_JSON;
  assert.deepEqual(policy.budgetConfig(e).prices['gpt-6.1-sol'],sol);
  assert.equal(e.AI_MODEL_PRICES_JSON,before);
  const legacy={input:.15,cachedInput:.075,output:.6,maxInputTokens:16000,verifiedAt:'2026-10-19',source:'https://example.invalid/legacy'};
  e.AI_MODEL_PRICES_JSON=JSON.stringify({'gpt-4o-mini':legacy,'gpt-6.1-sol':sol});const original=e.AI_MODEL_PRICES_JSON;
  assert.deepEqual(policy.featureBudgetConfig('closing',e).prices['gpt-4o-mini'],legacy);assert.equal(e.AI_MODEL_PRICES_JSON,original);
});
for(const patch of [null,{input:0},{output:0},{cachedInput:3},{maxInputTokens:0},{maxInputTokens:1.5},{source:'http://example.invalid'},{verifiedAt:'not-a-date'}])test(`Sol pricing fails closed: ${JSON.stringify(patch)}`,()=>{
  const e=env();e.AI_MODEL_PRICES_JSON=JSON.stringify({'gpt-4o-mini':sol,...(patch===null?{}:{'gpt-6.1-sol':{...sol,...patch}})});
  assert.throws(()=>policy.budgetConfig(e),error=>error.code==='BUDGET_NOT_CONFIGURED');
});
test('same-model feature overrides remain isolated from one another and the original price JSON',()=>{
  const e={...env(),AI_CLOSING_MAX_INPUT_BYTES:'120000',AI_INTERPRETATION_MAX_INPUT_BYTES:'90000'},before=JSON.stringify(e);
  const a=policy.featureBudgetConfig('closing',e),b=policy.featureBudgetConfig('interpretation',e),c=policy.featureBudgetConfig('analyze',e);
  assert.equal(a.prices['gpt-6.1-sol'].maxInputTokens,120000);assert.equal(b.prices['gpt-6.1-sol'].maxInputTokens,90000);assert.equal(c.prices['gpt-6.1-sol'].maxInputTokens,16000);
  assert.equal(a.prices['gpt-6.1-sol'].maxInputTokens,120000);assert.equal(JSON.stringify(e),before);
  for(const config of [a,b,c])assert.deepEqual({...config.prices['gpt-6.1-sol'],maxInputTokens:16000},sol);
});
for(const [feature,cap,expected] of [['closing',16000,.07296],['closing',120000,.28096],['interpretation',16000,.564],['interpretation',120000,.98],['analyze',16000,.564]])test(`${feature} reserves all authorized attempts with ${cap} conservative input bound: $${expected}`,()=>{
  const model=policy.featureModel(feature),value=policy.cost({...sol,maxInputTokens:cap},cap,model.output)*model.attempts;
  assert.ok(Math.abs(value-expected)<1e-8);
});
test('high effort changes actual reasoning consumption, not per-token rates or the approved timeout boundaries',()=>{
  const timing=loadModule('lib/server/interpretation-deadline.ts').INTERPRETATION_TIMING;
  assert.deepEqual(timing,{attemptMs:160000,workMs:190000,totalMs:210000,finalizationMs:20000,settlementMs:20000,minAttemptMs:20000});
  // Completion already includes reasoning; never add the reasoning subcount again.
  assert.equal(policy.cost(sol,5000,1000,1000),.0181);
  assert.equal(policy.cost(sol,5000,10000),.11);
});
