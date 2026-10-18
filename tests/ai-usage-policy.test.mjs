import assert from "node:assert/strict";
import { test, beforeEach, afterEach } from "node:test";
import { createHmac, randomUUID } from "node:crypto";
import { createModuleLoader } from "./helpers/load-typescript.mjs";
import { universeState } from "./helpers/aurora-universe-fixture.mjs";

const { periodRetrySeconds } = createModuleLoader()("lib/server/security/policy.ts");
const now = new Date("2026-10-18T03:00:00Z");
const user = { id: "synthetic-user", status: "active", role: "owner", closingDaily: 5, interpretationDaily: 3, analyzeDaily: 3, monthlyBudget: null };
const fixtureEnv = () => ({ VERCEL_ENV: "preview", AI_MODEL_PRICES_JSON: JSON.stringify({
  "gpt-4o-mini": { input: .15, cachedInput: .075, output: .6, maxInputTokens: 16000, verifiedAt: "2026-10-18", source: "https://example.invalid/pricing" },
  "gpt-6.1-sol": { input: 2, cachedInput: .1, output: 10, maxInputTokens: 16000, verifiedAt: "2026-10-18", source: "https://example.invalid/pricing" },
}), AI_USER_MONTH_USD: "50", AI_GLOBAL_DAY_USD: "50", AI_GLOBAL_MONTH_USD: "200", AI_GLOBAL_DAY_REQUESTS: "100", AI_GLOBAL_MONTH_REQUESTS: "1000", AI_GLOBAL_CONCURRENCY: "2" });
const overrideKey = "AI_CLOSING_MAX_INPUT_BYTES";
let saved;
beforeEach(t => {
  const keys = [...Object.keys(fixtureEnv()), overrideKey, "AI_INTERPRETATION_MAX_INPUT_BYTES"];
  saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  Object.assign(process.env, fixtureEnv()); process.env[overrideKey] = "120000"; process.env.AI_INTERPRETATION_MAX_INPUT_BYTES = "120000";
  t.mock.method(console, "error", () => {});
});
afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
const measured = p => Buffer.byteLength(JSON.stringify(p), "utf8") + 4096;
function paramsWithSize(size, feature = "closing") {
  const params = { model: feature === "closing" ? "gpt-4o-mini" : "gpt-6.1-sol", max_completion_tokens: feature === "closing" ? 180 : 25000,
    messages: [{ role: "user", content: "합성 🌌" }] };
  params.messages[0].content += "x".repeat(size - measured(params));
  assert.equal(measured(params), size);
  return params;
}
const completion = (input = 16140, output = 100) => ({ usage: { prompt_tokens: input, completion_tokens: output,
  prompt_tokens_details: { cached_tokens: 100 }, completion_tokens_details: { reasoning_tokens: 10 } } });
const isError = code => e => e.code === code;

// Only an in-memory query double. Never import pg, connect, migrate or call an SDK.
function harness(options = {}) {
  const state = { queries: [], rows: structuredClone(options.rows ?? []), attempts: [], locks: 0, calls: 0 };
  const fresh = { ...user, ...options.user };
  const db = { async query(sql, values = []) {
    state.queries.push({ sql, values });
    if (options.dbError) throw options.dbError;
    const one = row => ({ rows: row ? [row] : [], rowCount: row ? 1 : 0 });
    if (sql === "SELECT now() AS time") return one({ time: now });
    if (sql.startsWith("UPDATE ai_request SET state='expired'")) return one();
    if (sql.startsWith('SELECT status, role,')) return one(fresh);
    if (sql.startsWith("SELECT user_id,feature,day,month")) return { rows: state.rows };
    if (sql.startsWith("INSERT INTO ai_request")) {
      const [id, user_id, feature, digest, day, month, reserved, price] = values;
      state.rows.push({ id, user_id, feature, digest, day, month, state: "pending", attempts: 0, reserved_usd: reserved,
        charged_usd: reserved, price_snapshot: JSON.parse(price), created_at: now });
      return one();
    }
    if (sql.startsWith("SELECT * FROM ai_request")) return one(state.rows.find(r => r.id === values[0] && (!sql.includes("state='pending'") || r.state === "pending")));
    if (sql.startsWith('SELECT status FROM "user"')) return one(fresh);
    if (sql.startsWith("SELECT 1 FROM ai_attempt")) return { rows: [], rowCount: state.attempts.filter(a => a.request_id === values[0] && a.state === "started").length };
    if (sql.startsWith("UPDATE ai_request SET attempts=")) { state.rows.find(r => r.id === values[0]).attempts = values[1]; return one(); }
    if (sql.startsWith("INSERT INTO ai_attempt")) { state.attempts.push({ request_id: values[0], number: values[1], state: "started" }); return one(); }
    if (sql.startsWith("UPDATE ai_attempt SET state='uncertain'")) { state.attempts.find(a => a.request_id === values[0] && a.number === values[1]).state = "uncertain"; return one(); }
    if (sql.startsWith("UPDATE ai_attempt SET state=$3")) {
      Object.assign(state.attempts.find(a => a.request_id === values[0] && a.number === values[1]), {
        state: values[2], prompt_tokens: values[3], completion_tokens: values[4], cached_tokens: values[5], reasoning_tokens: values[6], estimated_usd: values[7],
      }); return one();
    }
    if (sql.startsWith("SELECT state,estimated_usd FROM ai_attempt")) return { rows: state.attempts.filter(a => a.request_id === values[0]) };
    if (sql.startsWith("UPDATE ai_request SET state=$2")) {
      Object.assign(state.rows.find(r => r.id === values[0]), { state: values[1], estimated_usd: values[2], charged_usd: values[3] }); return one();
    }
    assert.fail("Unexpected mock query");
  } };
  let queue = Promise.resolve();
  const load = createModuleLoader({ "node:crypto": { createHmac, randomUUID }, "./database": { locked: fn => {
    state.locks++;
    const next = queue.then(() => fn(db)); queue = next.catch(() => {}); return next;
  } } });
  const { reserveUsage } = load("lib/server/security/usage.ts");
  return { state, load, principal: fresh, policy: load("lib/server/security/policy.ts"), reserve: (feature = "interpretation", digest = randomUUID(), principal = fresh) => reserveUsage(principal, feature, digest),
    run: (permit, params = paramsWithSize(16140), result = completion()) => permit.run(params, async () => { state.calls++; return result; }) };
}

for (const [key,reason] of [["AI_USER_MONTH_USD","USER_MONTH_USD"],["AI_GLOBAL_DAY_USD","GLOBAL_DAY_USD"],["AI_GLOBAL_MONTH_USD","GLOBAL_MONTH_USD"]]) {
  test(`budget denial identifies ${reason} with no provider call or misleading minute retry`, async t => {
    process.env[key] = ".9"; const logs=[];t.mock.method(console,"error",(...args)=>logs.push(args));
    const h=harness();let denied;try{await h.reserve();}catch(e){denied=e;}
    assert.equal(denied.code,"AI_BUDGET_LIMIT");assert.equal(denied.status,429);
    assert.deepEqual(logs[0][1].reasons,[reason]);assert.equal(logs[0][1].reservedUsd,.98);
    assert.equal(logs[0][1].userBudgetSource,"environment");assert.equal(h.state.rows.length,0);assert.equal(h.state.calls,0);
    const response=h.policy.securityFailure(denied);assert.equal(response.headers.get("retry-after"),null);
    assert.match((await response.json()).error,/예산/);assert.ok(!JSON.stringify(logs).includes(user.id));
  });
}
test("all exhausted money buckets are reported together; account override remains authoritative over $50",async t=>{
  process.env.AI_GLOBAL_DAY_USD=".5";process.env.AI_GLOBAL_MONTH_USD=".5";
  const logs=[];t.mock.method(console,"error",(...args)=>logs.push(args));const h=harness({user:{monthlyBudget:".5"}});
  await assert.rejects(h.reserve(),isError("AI_BUDGET_LIMIT"));
  assert.deepEqual(logs[0][1].reasons,["USER_MONTH_USD","GLOBAL_DAY_USD","GLOBAL_MONTH_USD"]);
  assert.equal(logs[0][1].userBudgetSource,"account");assert.equal(logs[0][1].userMonthLimitUsd,.5);
});
test("Preview diagnostic reconstructs fixed fields and rejects strings, unsafe numbers and arbitrary metadata",t=>{
  const logs=[];t.mock.method(console,"error",(...args)=>logs.push(args));
  const {logUsageDenial}=createModuleLoader()("lib/server/security/usage-diagnostics.ts");
  logUsageDenial("interpretation","AI_BUDGET_LIMIT",["USER_MONTH_USD","PRIVATE_PROMPT"],{reservedUsd:Infinity,userMonthLimitUsd:-1,userDayRequests:"PRIVATE_KEY",userId:"PRIVATE_ID",DATABASE_URL:"PRIVATE_DB",messages:"PRIVATE_ANSWER"},"PRIVATE_SOURCE");
  assert.deepEqual(logs[0],["[private-beta-usage-limit]",{stage:"usage.reserve",code:"AI_BUDGET_LIMIT",feature:"interpretation",reasons:["USER_MONTH_USD"],userBudgetSource:"environment",reservedUsd:null,userMonthLimitUsd:null,userDayRequests:null}]);
  logUsageDenial("PRIVATE_FEATURE","AI_BUDGET_LIMIT",["USER_MONTH_USD"],{},"account");
  logUsageDenial("closing","PRIVATE_CODE",["USER_MONTH_USD"],{},"account");assert.equal(logs.length,1);
});
test("non-Preview stays silent and a broken log sink cannot bypass the denial",async t=>{
  process.env.AI_GLOBAL_DAY_USD=".5";const logs=[];t.mock.method(console,"error",(...args)=>logs.push(args));
  for(const env of ["production","development",undefined]){
    if(env)process.env.VERCEL_ENV=env;else delete process.env.VERCEL_ENV;
    await assert.rejects(harness().reserve(),isError("AI_BUDGET_LIMIT"));
  }
  assert.equal(logs.length,0);process.env.VERCEL_ENV="preview";
  t.mock.method(console,"error",()=>{throw new Error("PRIVATE_SINK");});
  const h=harness();await assert.rejects(h.reserve(),isError("AI_BUDGET_LIMIT"));assert.equal(h.state.calls,0);
});
test("accounting emits only safe usage/settlement numbers in Preview and never leaks responses",t=>{
 const logs=[];t.mock.method(console,"info",(...args)=>logs.push(args));const {logUsageAccounting}=createModuleLoader()("lib/server/security/usage-diagnostics.ts");
 logUsageAccounting("closing","model.usage","reported",{promptTokens:1000,completionTokens:100,estimatedUsd:.00021,content:"PRIVATE_RESPONSE",token:"PRIVATE_TOKEN"});
 assert.deepEqual(logs[0],["[private-beta-usage-accounting]",{feature:"closing",stage:"model.usage",state:"reported",promptTokens:1000,completionTokens:100,estimatedUsd:.00021}]);
 logUsageAccounting("interpretation","usage.finish","failed",{reservedUsd:.98,chargedUsd:.98,estimatedUsd:null,attempts:1});
 assert.equal(logs[1][1].chargedUsd,.98);assert.equal(logs[1][1].estimatedUsd,null);
 delete process.env.VERCEL_ENV;logUsageAccounting("closing","model.usage","reported",{promptTokens:1000});assert.equal(logs.length,2);
 process.env.VERCEL_ENV="preview";t.mock.method(console,"info",()=>{throw new Error("PRIVATE_LOG_FAILURE");});
 assert.doesNotThrow(()=>logUsageAccounting("closing","model.usage","reported",{promptTokens:1000}));
});
function previous(patch={}){return {id:randomUUID(),user_id:user.id,feature:"interpretation",day:"2026-10-18",month:"2026-10",state:"success",attempts:1,charged_usd:0,digest:randomUUID(),created_at:new Date(now.getTime()-120000),...patch};}
test("uncertain failures keep reserved charges and can exhaust money; no implicit refunds",async()=>{
  process.env.AI_GLOBAL_DAY_USD="1";const h=harness(),p=await h.reserve();
  await assert.rejects(p.run(paramsWithSize(16140,"interpretation"),async()=>{throw new Error("synthetic timeout");}));await p.finish(false);
  assert.equal(h.state.rows[0].charged_usd,.98);assert.equal(h.state.rows[0].state,"failed");
  // A later different user is not a duplicate or a daily-quota collision.
  await assert.rejects(h.reserve("interpretation",randomUUID(),{...user,id:"other-synthetic-user"}),isError("AI_BUDGET_LIMIT"));
  assert.equal(h.state.rows[0].charged_usd,.98);
});
test("account, day and monthly budgets include reported, pending and uncertain charges",async()=>{
  for(const state of ["success","failed","expired"]){
    const h=harness({rows:[previous({state,charged_usd:49.5})]});await assert.rejects(h.reserve(),isError("AI_BUDGET_LIMIT"));assert.equal(h.state.calls,0);
  }
});
test("$50/$50/$200 permits two attempts but never a third; actual usage replaces the $0.98 reserve",async()=>{
  const h=harness(),p=await h.reserve();const result={usage:{prompt_tokens:8000,completion_tokens:4000,prompt_tokens_details:{cached_tokens:1000},completion_tokens_details:{reasoning_tokens:3000}}};
  await h.run(p,paramsWithSize(47336,"interpretation"),result);await h.run(p,paramsWithSize(47336,"interpretation"),result);
  await assert.rejects(h.run(p,paramsWithSize(47336,"interpretation"),result),isError("MODEL_NOT_AUTHORIZED"));await p.finish(true);
  assert.equal(h.state.rows[0].reserved_usd,.98);assert.equal(h.state.rows[0].charged_usd,.1082);
});
test("three ordinary tester interpretations succeed; fourth is still a daily quota, not a money error",async()=>{
  const h=harness({user:{role:"tester"}});
  for(let i=0;i<3;i++){const p=await h.reserve();await h.run(p,paramsWithSize(47336,"interpretation"),{usage:{prompt_tokens:8000,completion_tokens:4000}});await p.finish(true);}
  let error;try{await h.reserve();}catch(e){error=e;}
  assert.equal(error.code,"USER_DAILY_LIMIT");assert.equal(error.retryAfterSeconds,43200);assert.equal(h.state.calls,3);
  assert.equal(h.policy.securityFailure(error).headers.get("retry-after"),"43200");
});
test("Owner creation quotas 20/10 still differ from Tester 5/3; both keep money/concurrency guards",async()=>{
  const h=harness({user:{role:"owner",closingDaily:20,interpretationDaily:10,analyzeDaily:10},rows:Array.from({length:3},()=>previous())});
  const p=await h.reserve();await p.finish(false);
  const h2=harness({rows:[previous({state:"pending"})]});await assert.rejects(h2.reserve(),isError("AI_BUSY"));
});
test("monthly quota Retry-After uses the next Korean month; same-answer window uses its remaining seconds",async()=>{
  process.env.AI_GLOBAL_MONTH_REQUESTS="1";const h=harness({rows:[previous()]});let e;try{await h.reserve();}catch(error){e=error;}
  assert.equal(e.code,"GLOBAL_REQUEST_LIMIT");assert.equal(e.retryAfterSeconds,periodRetrySeconds(now,true));
  process.env.AI_GLOBAL_MONTH_REQUESTS="1000";const digest="synthetic-digest",h2=harness({rows:[previous({digest,created_at:new Date(now.getTime()-20000)})]});
  await assert.rejects(h2.reserve("interpretation",digest),error=>error.code==="DUPLICATE_REQUEST"&&error.retryAfterSeconds===40);
});
test("Korean boundaries handle year and leap-day transitions",()=>{
  assert.equal(periodRetrySeconds(new Date("2026-12-31T14:59:30Z")),30);
  assert.equal(periodRetrySeconds(new Date("2026-12-31T14:59:30Z"),true),30);
  assert.equal(periodRetrySeconds(new Date("2028-02-28T15:00:00Z"),true),86400);
});

function output(context){
 const grounded=refs=>({text:"실제 표현에서 여러 가치를 함께 살피려는 가능성을 읽어 볼 수 있습니다.",evidenceRefs:refs,basis:refs.length?"answer-grounded":"insufficient-evidence"});
 return JSON.stringify({auroraName:"함께 흐르는 시간",quoteId:"seneca-letters-1-1-self",q10Anchor:"내 시간",quoteReason:["내 시간을 지키려는 승인 문장의 주제와 닿아 있습니다."],
 overall:grounded(context.facts.questions.flatMap(q=>q.evidence.map(e=>e.ref))),ribbons:Object.fromEntries(context.facts.ribbons.map(r=>[r.ribbonId,{ribbonId:r.ribbonId,psychological:grounded(r.evidence.map(e=>e.ref)),philosophical:grounded(r.evidence.map(e=>e.ref)),reflectionQuestion:"이 가치를 일상에서 어떻게 돌보고 싶나요?"}]))});
}
test("Q1-Q9 -> real Q10 route -> approval -> real interpretation route -> bound result uses two reservations",async()=>{
 const h=harness({user:{role:"tester"}}),pure=createModuleLoader();let state=universeState("all"),modelOutput,authCalls=0,providerCalls=0;
 const {questionnaireReducer:reduce,getApprovedClosingMessage}=pure("lib/questionnaire-state.ts");
 const closingInput=pure("lib/closing-message.ts").buildClosingMessageInput(state,state.closing.authoredText,state.closing.authoredWord);
 const apiModule=createModuleLoader({"./policy":{...h.policy,authConfig:()=>({origins:["https://preview.example.invalid"]})},"./auth":{principal:async()=>{authCalls++;return h.principal;}},"./rate-limit":{consumeWindow:async()=>{}},"./usage":{reserveUsage:(_u,f,d)=>h.reserve(f,d),requestDigest:f=>`synthetic-${f}`}})("lib/server/security/api.ts");
 class MockOpenAI{chat={completions:{create:async params=>{providerCalls++;return {usage:{prompt_tokens:2000,completion_tokens:100},choices:[{finish_reason:"stop",message:{content:params.model==="gpt-4o-mini"?JSON.stringify({text:"내 시간을 지키며 함께 걸어간다"}):modelOutput}}]};}}};}
 const closingService=pure("lib/server/closing-message-service.ts"),interpretService=pure("lib/server/aurora-interpretation-service.ts");
 const deps={openai:MockOpenAI,"../../../lib/server/security/api":apiModule,
 "../../../lib/server/closing-message-service":{...closingService,createClosingMessageHandler:d=>closingService.createClosingMessageHandler({...d,apiKey:()=>"synthetic-provider-key"})},
 "../../../lib/server/aurora-interpretation-service":{...interpretService,createAuroraInterpretationHandler:d=>interpretService.createAuroraInterpretationHandler({...d,apiKey:()=>"synthetic-provider-key",diagnostic:()=>{}})}};
 const routes=createModuleLoader(deps),closing=routes("app/api/closing-message/route.ts").POST,interpret=routes("app/api/aurora-interpretation/route.ts").POST;
 const fetcher=async(path,init)=>{if(path.includes("aurora-interpretation"))modelOutput=output(await pure("lib/aurora-interpretation.ts").prepareAuroraInterpretation(JSON.parse(init.body)));
  return (path.includes("closing-message")?closing:interpret)(new Request("https://preview.example.invalid"+path,{...init,headers:{...init.headers,origin:"https://preview.example.invalid"}}));};
 const controller=new (pure("lib/closing-message-client.ts").ClosingMessageRequestController)(fetcher,()=>"synthetic-full-flow");
 await controller.generate(closingInput,undefined,{start:(id,inputFingerprint)=>{state=reduce(state,{type:"closing-start",id,inputFingerprint});},success:(id,inputFingerprint,text)=>{state=reduce(state,{type:"closing-success",id,inputFingerprint,text});},failure:()=>assert.fail("closing failed")});
 state=reduce(state,{type:"closing-approve",approvedAt:"2026-10-18T00:00:00Z"});assert.ok(getApprovedClosingMessage(state));const before=structuredClone(state);let result;
 await new (pure("lib/aurora-universe.ts").AuroraUniverseRequestController)(fetcher).generate(state,{isCurrent:()=>true,start:()=>{},success:r=>{result=r;},failure:code=>assert.fail(code),settled:()=>{}});
 assert.equal(result.status,"interpreted");assert.equal(providerCalls,2);assert.ok(authCalls>=6);assert.deepEqual(state,before);
 assert.deepEqual(h.state.rows.map(r=>r.feature),["closing","interpretation"]);assert.ok(h.state.rows.every(r=>r.state==="success"&&r.attempts===1&&r.charged_usd<r.reserved_usd));
 // The guard, routes, validators and controllers are real; only auth/DB/provider I/O are mocked.
});
for(const code of ["AI_BUDGET_LIMIT","USER_DAILY_LIMIT","GLOBAL_REQUEST_LIMIT","AI_BUSY","DUPLICATE_REQUEST","REQUEST_RATE_LIMIT"]) test(`both clients preserve ${code} and approvals instead of generic 429`,async()=>{
 const pure=createModuleLoader(),state=universeState(),before=structuredClone(state),input=pure("lib/closing-message.ts").buildClosingMessageInput(state,state.closing.authoredText,state.closing.authoredWord),seen=[];
 const fetcher=async()=>Response.json({code},{status:429});
 await new (pure("lib/closing-message-client.ts").ClosingMessageRequestController)(fetcher).generate(input,undefined,{start:()=>{},success:()=>assert.fail(),failure:(_id,_fp,c)=>seen.push(c)});
 await new (pure("lib/aurora-universe.ts").AuroraUniverseRequestController)(fetcher).generate(state,{isCurrent:()=>true,start:()=>{},success:()=>assert.fail(),failure:c=>seen.push(c),settled:()=>{}});
 assert.deepEqual(seen,[code,code]);assert.deepEqual(state,before);assert.match(pure("lib/aurora-universe.ts").auroraUniverseFailureMessage(code),/승인한 문장.*유지/);
});
