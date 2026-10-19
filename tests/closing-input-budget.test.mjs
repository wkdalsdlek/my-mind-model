import assert from "node:assert/strict";
import { test, beforeEach, afterEach } from "node:test";
import { createHmac, randomUUID } from "node:crypto";
import { createModuleLoader } from "./helpers/load-typescript.mjs";

const { budgetConfig, featureBudgetConfig, cost, featureModel } = createModuleLoader()("lib/server/security/policy.ts");
const now = new Date("2026-10-18T03:00:00Z");
const user = { id: "synthetic-user", status: "active", role: "owner", closingDaily: 5, interpretationDaily: 3, analyzeDaily: 3, monthlyBudget: null };
const fixtureEnv = () => ({ VERCEL_ENV: "preview", AI_MODEL_PRICES_JSON: JSON.stringify({
  "gpt-6.1-sol": { input: 2, cachedInput: .1, output: 10, maxInputTokens: 16000, verifiedAt: "2026-10-18", source: "https://example.invalid/pricing" },
}), AI_USER_MONTH_USD: "5", AI_GLOBAL_DAY_USD: "10", AI_GLOBAL_MONTH_USD: "20", AI_GLOBAL_DAY_REQUESTS: "50", AI_GLOBAL_MONTH_REQUESTS: "100", AI_GLOBAL_CONCURRENCY: "2" });
const overrideKey = "AI_CLOSING_MAX_INPUT_BYTES";
let saved;
beforeEach(t => {
  const keys = [...Object.keys(fixtureEnv()), overrideKey, "AI_INTERPRETATION_MAX_INPUT_BYTES"];
  saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  Object.assign(process.env, fixtureEnv()); delete process.env[overrideKey]; delete process.env.AI_INTERPRETATION_MAX_INPUT_BYTES;
  t.mock.method(console, "error", () => {});
});
afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
const measured = p => Buffer.byteLength(JSON.stringify(p), "utf8") + 4096;
function paramsWithSize(size, feature = "closing") {
  const params = { model: "gpt-6.1-sol", max_completion_tokens: feature === "closing" ? 4096 : 25000,
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
  return { state, policy: load("lib/server/security/policy.ts"), reserve: (feature = "closing", digest = randomUUID(), principal = fresh) => reserveUsage(principal, feature, digest),
    run: (permit, params = paramsWithSize(16140), result = completion()) => permit.run(params, async () => { state.calls++; return result; }) };
}

test("observed Q10 16140-byte Preview failure is input-only; missing config keeps the old 16000 limit", async t => {
  const logs = []; t.mock.method(console, "error", (...args) => logs.push(args));
  const h = harness(), permit = await h.reserve();
  assert.deepEqual(featureModel("closing"), { model: "gpt-6.1-sol", output: 4096, attempts: 1 });
  await assert.rejects(h.run(permit), isError("MODEL_BUDGET_MISMATCH")); await permit.finish(false);
  assert.deepEqual(logs[0][1].mismatchTypes, ["INPUT_BYTES_EXCEEDED"]);
  assert.equal(logs[0][1].inputBytesWithOverhead, 16140);
  assert.equal(logs[0][1].maxInputTokens, 16000);
  assert.equal(h.state.calls, 0); assert.equal(h.state.attempts.length, 0);
  assert.equal(h.state.rows[0].charged_usd, 0);
});
test("Q10 and interpretation overrides are isolated, preserve rates and never mutate the Secret", () => {
  const env = { ...fixtureEnv(), [overrideKey]: "120000", AI_INTERPRETATION_MAX_INPUT_BYTES: "90000" };
  const before = JSON.stringify(env), base = budgetConfig(env);
  const closing = featureBudgetConfig("closing", env), interpretation = featureBudgetConfig("interpretation", env);
  assert.equal(closing.prices["gpt-6.1-sol"].maxInputTokens, 120000);
  assert.deepEqual({ ...closing.prices["gpt-6.1-sol"], maxInputTokens: 16000 }, base.prices["gpt-6.1-sol"]);
  assert.equal(base.prices["gpt-6.1-sol"].maxInputTokens, 16000);
  assert.equal(interpretation.prices["gpt-6.1-sol"].maxInputTokens, 90000);
  assert.equal(closing.prices["gpt-6.1-sol"].maxInputTokens, 120000);
  assert.deepEqual(featureBudgetConfig("analyze", env), base);
  assert.equal(JSON.stringify(env), before);
  assert.equal(featureBudgetConfig("interpretation", { ...env, AI_INTERPRETATION_MAX_INPUT_BYTES: "120000" }).prices["gpt-6.1-sol"].maxInputTokens, 120000);
});
for (const environment of [undefined, "development", "production"]) test(`closing override is inactive outside Preview (${environment ?? "unset"})`, () => {
  const env = { ...fixtureEnv(), [overrideKey]: "invalid" };
  if (environment === undefined) delete env.VERCEL_ENV; else env.VERCEL_ENV = environment;
  assert.deepEqual(featureBudgetConfig("closing", env), budgetConfig(env));
});
for (const raw of ["", " ", "120000 ", "0120000", "1.2e5", "120000.0", "+120000", "4095", "120001", "-1", "NaN", "Infinity"]) {
  test(`invalid Q10 cap ${JSON.stringify(raw)} blocks before reservation; other features remain usable`, async () => {
    process.env[overrideKey] = raw; process.env.AI_INTERPRETATION_MAX_INPUT_BYTES = "120000";
    const h = harness(); await assert.rejects(h.reserve(), isError("BUDGET_NOT_CONFIGURED"));
    assert.equal(h.state.locks, 0); assert.equal(h.state.calls, 0);
    assert.equal(featureBudgetConfig("interpretation").prices["gpt-6.1-sol"].maxInputTokens, 120000);
    assert.deepEqual(featureBudgetConfig("analyze"), budgetConfig());
  });
}
for (const size of [16000, 16140, 60000, 90000, 110000, 120000, 120001]) test(`Q10 UTF-8 boundary ${size} includes JSON and overhead, with matching reservation/usage snapshot`, async () => {
  process.env[overrideKey] = "120000";
  const h = harness(), permit = await h.reserve(), row = h.state.rows[0];
  assert.equal(row.reserved_usd, .28096);
  assert.equal(row.price_snapshot.maxInputTokens, 120000);
  assert.equal(row.price_snapshot.maxOutputTokens, 4096); assert.equal(row.price_snapshot.maxAttempts, 1);
  const result = { usage: { prompt_tokens: size, completion_tokens: 4096 } };
  if (size > 120000) {
    await assert.rejects(h.run(permit, paramsWithSize(size), result), isError("MODEL_BUDGET_MISMATCH"));
    await permit.finish(false); assert.equal(h.state.calls, 0); assert.equal(row.charged_usd, 0);
  } else {
    await h.run(permit, paramsWithSize(size), result); await permit.finish(true);
    assert.equal(h.state.calls, 1); assert.equal(h.state.attempts[0].state, "reported");
    assert.ok(Math.abs(row.charged_usd - cost(permit.config.prices["gpt-6.1-sol"], size, 4096)) < 1e-8);
  }
});
for (const [patch, reasons] of [
  [{ model: "synthetic-wrong-model" }, ["MODEL_NAME_MISMATCH"]],
  [{ max_completion_tokens: 4097 }, ["MAX_OUTPUT_TOKENS_MISMATCH"]],
  [{ model: "synthetic-wrong-model", max_completion_tokens: 4097 }, ["MODEL_NAME_MISMATCH", "MAX_OUTPUT_TOKENS_MISMATCH"]],
]) test(`large closing cap never bypasses ${reasons.join("/")}`, async t => {
  process.env[overrideKey] = "120000";
  const logs = []; t.mock.method(console, "error", (...args) => logs.push(args));
  const h = harness(), permit = await h.reserve();
  await assert.rejects(h.run(permit, { ...paramsWithSize(16140), ...patch }), isError("MODEL_BUDGET_MISMATCH"));
  assert.deepEqual(logs[0][1].mismatchTypes, reasons);
  assert.equal(h.state.calls, 0); assert.equal(h.state.attempts.length, 0);
  await permit.finish(false); assert.equal(h.state.rows[0].charged_usd, 0);
});
test("only one Q10 call remains authorized; later config changes cannot alter a permit", async () => {
  process.env[overrideKey] = "120000";
  const h = harness(), permit = await h.reserve();
  process.env[overrideKey] = "invalid";
  await h.run(permit); await assert.rejects(h.run(permit), isError("MODEL_NOT_AUTHORIZED"));
  await permit.finish(true); assert.equal(h.state.calls, 1);
  assert.equal(permit.config.prices["gpt-6.1-sol"].maxInputTokens, 120000);
  assert.equal(h.state.rows[0].charged_usd, .03309);
});
for (const result of [{}, { usage: { prompt_tokens: 120001, completion_tokens: 100 } }, { usage: { prompt_tokens: 100, completion_tokens: 4097 } }]) {
  test("missing/over-cap reported usage stays uncertain and retains the full closing reservation", async () => {
    process.env[overrideKey] = "120000";
    const h = harness(), permit = await h.reserve(); await h.run(permit, paramsWithSize(16140), result);
    await permit.finish(true); assert.equal(h.state.attempts[0].state, "uncertain");
    assert.equal(h.state.rows[0].charged_usd, .28096);
  });
}
test("provider failure retains the reservation; pre-call cancellation spends nothing", async () => {
  process.env[overrideKey] = "120000";
  const h = harness(), permit = await h.reserve();
  await assert.rejects(permit.run(paramsWithSize(16140), async () => { throw new Error("synthetic provider failure"); }));
  await permit.finish(false); assert.equal(h.state.rows[0].charged_usd, .28096);
  const h2 = harness(), p2 = await h2.reserve();
  await assert.rejects(p2.run(paramsWithSize(16140), async () => assert.fail("provider called"), AbortSignal.abort()), isError("REQUEST_TIMEOUT"));
  await p2.finish(false); assert.equal(h2.state.rows[0].charged_usd, 0);
});
for (const key of ["AI_USER_MONTH_USD", "AI_GLOBAL_DAY_USD", "AI_GLOBAL_MONTH_USD"]) test(`Q10 insufficient ${key} still returns 429 before handler/model`, async () => {
  process.env[overrideKey] = "120000"; process.env[key] = ".018";
  const h = harness();
  await assert.rejects(h.reserve(), e => e.code === "AI_BUDGET_LIMIT" && e.status === 429);
  assert.equal(h.state.calls, 0); assert.equal(h.state.rows.length, 0);
});
test("disabled accounts, Q10 daily quotas and DB failure remain closed", async () => {
  process.env[overrideKey] = "120000";
  for (const [options, code] of [[{ user: { status: "disabled" } }, "ACCOUNT_DISABLED"], [{ user: { closingDaily: 0 } }, "USER_DAILY_LIMIT"]]) {
    const h = harness(options); await assert.rejects(h.reserve(), isError(code)); assert.equal(h.state.calls, 0);
  }
  const h = harness({ dbError: new Error("synthetic DB failure") }); await assert.rejects(h.reserve()); assert.equal(h.state.calls, 0);
});
test("Q10 low-effort route builds real SDK params with safe headroom and succeeds only after its own override", async () => {
  const pure = createModuleLoader(), service = pure("lib/server/closing-message-service.ts");
  const { QUESTION_DATA } = pure("lib/question-data.ts");
  const selection = (q, i) => ({ keywordId: `synthetic-${q.id}-${i}`, selectionId: `synthetic-selection-${q.id}-${i}`,
    questionId: q.id, label: "합성 선택", originalText: "합성 선택", source: q.id === "q10" ? "personalized" : "preset", answerIntent: q.answerIntent });
  const input = { q10Selections: Array.from({ length: 4 }, (_, i) => selection(QUESTION_DATA[9], i)), authoredText: "", authoredWord: "",
    context: QUESTION_DATA.slice(0, 9).map(q => ({ questionId: q.id, status: "answered", selections: Array.from({ length: 6 }, (_, i) => selection(q, i)) })) };
  let originalParams;
  for (const enabled of [false, true]) {
    if (enabled) process.env[overrideKey] = "120000";
    const h = harness(), permit = await h.reserve(); let captured, sdkCalls = 0;
    const run = permit.run.bind(permit);
    permit.run = (params, call) => { captured = params; return run(params, call); };
    class MockOpenAI {
      chat = { completions: { create: async () => { sdkCalls++; return { ...completion(), choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ text: "내 마음의 속도를 따라 걷고 싶다" }) } }] }; } } };
    }
    const route = createModuleLoader({ openai: MockOpenAI,
      "../../../lib/server/security/api": { protectAI: (feature, handler) => async req => {
        assert.equal(feature, "closing"); const response = await handler(req, permit); await permit.finish(response.ok);
        return permit.fault ? h.policy.securityFailure(permit.fault) : response;
      } },
      "../../../lib/server/closing-message-service": { ...service, createClosingMessageHandler: deps => service.createClosingMessageHandler({ ...deps, apiKey: () => "synthetic-provider-key" }) },
    })("app/api/closing-message/route.ts");
    const response = await route.POST(new Request("https://preview.example.invalid/api/closing-message", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: "synthetic-route-request", input }),
    }));
    assert.equal(captured.model, "gpt-6.1-sol"); assert.equal(captured.max_completion_tokens, 4096);
    assert.equal(captured.messages[0].content, service.CLOSING_MESSAGE_SYSTEM_PROMPT);
    assert.deepEqual(captured.response_format, service.CLOSING_RESPONSE_FORMAT);
    assert.ok(measured(captured) > 16000); assert.ok(measured(captured) < 120000);
    if (!enabled) { originalParams = captured; assert.equal(response.status, 503); assert.equal(sdkCalls, 0); }
    else { assert.deepEqual(captured, originalParams); assert.equal(response.status, 200); assert.equal(sdkCalls, 1); assert.equal(h.state.attempts[0].state, "reported"); }
  }
});

for (const [patch,expected] of [
  [{model:'gpt-4o-mini'},['MODEL_NAME_MISMATCH']],
  [{max_completion_tokens:180},['MAX_OUTPUT_TOKENS_MISMATCH']],
  [{model:'gpt-4o-mini',max_completion_tokens:180},['MODEL_NAME_MISMATCH','MAX_OUTPUT_TOKENS_MISMATCH']],
]) test('stale Q10 mini/180-token contract is denied before provider and never silently accepted',async t=>{
  process.env[overrideKey]='120000';const logs=[];t.mock.method(console,'error',(...args)=>logs.push(args));
  const h=harness(),permit=await h.reserve();
  await assert.rejects(h.run(permit,{...paramsWithSize(16140),...patch}),isError('MODEL_BUDGET_MISMATCH'));
  assert.deepEqual(logs[0][1].mismatchTypes,expected);assert.equal(h.state.calls,0);await permit.finish(false);assert.equal(h.state.rows[0].charged_usd,0);
});
test('Q10 reasoning tokens share 4096 completion cap and are settled once at the Sol rate',async()=>{
  process.env[overrideKey]='120000';const h=harness(),permit=await h.reserve();
  await h.run(permit,paramsWithSize(16140),{usage:{prompt_tokens:1000,completion_tokens:4096,completion_tokens_details:{reasoning_tokens:4000}}});await permit.finish(true);
  assert.equal(h.state.attempts[0].state,'reported');assert.equal(h.state.rows[0].reserved_usd,.28096);assert.equal(h.state.rows[0].charged_usd,.04296);
});
for(const amount of ['.28095999','.28096'])test(`new Q10 reservation respects the exact remaining dollar boundary ${amount}`,async()=>{
  process.env[overrideKey]='120000';process.env.AI_GLOBAL_DAY_USD=amount;const h=harness();
  if(Number(amount)<.28096){await assert.rejects(h.reserve(),e=>e.code==='AI_BUDGET_LIMIT'&&e.status===429);assert.equal(h.state.rows.length,0);}
  else{const permit=await h.reserve();assert.equal(h.state.rows[0].reserved_usd,.28096);await permit.finish(false);}
  assert.equal(h.state.calls,0);
});
