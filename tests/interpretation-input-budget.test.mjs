import assert from "node:assert/strict";
import { test, beforeEach, afterEach } from "node:test";
import { createHmac, randomUUID } from "node:crypto";
import { createModuleLoader } from "./helpers/load-typescript.mjs";

const { budgetConfig, featureBudgetConfig, cost, seoulPeriods } = createModuleLoader()("lib/server/security/policy.ts");
const now = new Date("2026-10-18T03:00:00Z");
const user = { id: "synthetic-user", status: "active", role: "owner", closingDaily: 5, interpretationDaily: 3, analyzeDaily: 3, monthlyBudget: null };
const fixtureEnv = () => ({ VERCEL_ENV: "preview", AI_MODEL_PRICES_JSON: JSON.stringify({
  "gpt-4o-mini": { input: .15, cachedInput: .075, output: .6, maxInputTokens: 16000, verifiedAt: "2026-10-18", source: "https://example.invalid/pricing" },
  "gpt-6.1-sol": { input: 2, cachedInput: .1, output: 10, maxInputTokens: 16000, verifiedAt: "2026-10-18", source: "https://example.invalid/pricing" },
}), AI_USER_MONTH_USD: "5", AI_GLOBAL_DAY_USD: "10", AI_GLOBAL_MONTH_USD: "20", AI_GLOBAL_DAY_REQUESTS: "50", AI_GLOBAL_MONTH_REQUESTS: "100", AI_GLOBAL_CONCURRENCY: "2" });
const overrideKey = "AI_INTERPRETATION_MAX_INPUT_BYTES";
let saved;
beforeEach(t => {
  const keys = [...Object.keys(fixtureEnv()), overrideKey];
  saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  Object.assign(process.env, fixtureEnv()); delete process.env[overrideKey];
  t.mock.method(console, "error", () => {});
});
afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
const measured = p => Buffer.byteLength(JSON.stringify(p), "utf8") + 4096;
function paramsWithSize(size, feature = "interpretation") {
  const params = { model: feature === "closing" ? "gpt-4o-mini" : "gpt-6.1-sol", max_completion_tokens: feature === "closing" ? 180 : 25000,
    messages: [{ role: "user", content: "합성 🌌" }] };
  params.messages[0].content += "x".repeat(size - measured(params));
  assert.equal(measured(params), size);
  return params;
}
const completion = (input = 20000, output = 1000) => ({ usage: { prompt_tokens: input, completion_tokens: output,
  prompt_tokens_details: { cached_tokens: 100 }, completion_tokens_details: { reasoning_tokens: 500 } } });
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
  return { state, policy: load("lib/server/security/policy.ts"), reserve: (feature = "interpretation", digest = randomUUID(), principal = fresh) => reserveUsage(principal, feature, digest),
    run: (permit, params = paramsWithSize(47336), result = completion()) => permit.run(params, async () => { state.calls++; return result; }) };
}
function priorRow(patch = {}) {
  return { id: "prior-request", user_id: "another-user", feature: "closing", digest: "prior-digest", ...seoulPeriods(now),
    state: "success", attempts: 1, charged_usd: 0, created_at: new Date(now.getTime() - 120000), ...patch };
}

test("missing override preserves the original Secret cap and rejects the observed 47336-byte request", async () => {
  assert.deepEqual(featureBudgetConfig("interpretation", fixtureEnv()), budgetConfig(fixtureEnv()));
  const h = harness(), permit = await h.reserve();
  assert.equal(permit.config.prices["gpt-6.1-sol"].maxInputTokens, 16000);
  assert.equal(h.state.rows[0].reserved_usd, .564);
  await assert.rejects(h.run(permit), isError("MODEL_BUDGET_MISMATCH"));
  await permit.finish(false);
  assert.equal(h.state.calls, 0); assert.equal(h.state.attempts.length, 0);
  assert.equal(h.state.rows[0].state, "no-model"); assert.equal(h.state.rows[0].charged_usd, 0);
});
test("60000 Preview cap is request-local; rates, base Secret and other feature configs remain identical", () => {
  const env = { ...fixtureEnv(), [overrideKey]: "60000" }, before = JSON.stringify(env);
  const original = budgetConfig(env), effective = featureBudgetConfig("interpretation", env);
  assert.equal(effective.prices["gpt-6.1-sol"].maxInputTokens, 60000);
  assert.deepEqual({ ...effective.prices["gpt-6.1-sol"], maxInputTokens: 16000 }, original.prices["gpt-6.1-sol"]);
  assert.deepEqual(featureBudgetConfig("closing", env), original);
  assert.deepEqual(featureBudgetConfig("analyze", env), original);
  assert.equal(JSON.stringify(env), before); assert.equal(original.prices["gpt-6.1-sol"].maxInputTokens, 16000);
});
for (const environment of [undefined, "production", "development"]) test(`override never changes non-Preview config (${environment ?? "unset"})`, () => {
  const env = { ...fixtureEnv(), [overrideKey]: "60000" };
  if (environment === undefined) delete env.VERCEL_ENV; else env.VERCEL_ENV = environment;
  assert.deepEqual(featureBudgetConfig("interpretation", env), budgetConfig(env));
  env[overrideKey] = "invalid";
  assert.deepEqual(featureBudgetConfig("interpretation", env), budgetConfig(env));
});
for (const limit of ["4096", "16000", "60000", "60001", "90000", "110000", "120000"]) test(`valid explicit cap ${limit} uses canonical integer bytes`, () => {
  assert.equal(featureBudgetConfig("interpretation", { ...fixtureEnv(), [overrideKey]: limit }).prices["gpt-6.1-sol"].maxInputTokens, Number(limit));
});
for (const limit of ["", " ", "60000 ", "60000\n", "+60000", "060000", "6e4", "60000.0", "0", "-1", "4095", "120001", "120000 ", "0120000", "1.2e5", "NaN", "Infinity", "9007199254740992", "invalid"]) {
  test(`invalid Preview override (${JSON.stringify(limit)}) rejects before any DB/model work`, async () => {
    process.env[overrideKey] = limit;
    const h = harness(); await assert.rejects(h.reserve(), isError("BUDGET_NOT_CONFIGURED"));
    assert.equal(h.state.locks, 0); assert.equal(h.state.calls, 0);
    for (const feature of ["closing", "analyze"]) assert.deepEqual(featureBudgetConfig(feature), budgetConfig());
  });
}
for (const missing of ["AI_MODEL_PRICES_JSON", "AI_USER_MONTH_USD", "AI_GLOBAL_DAY_USD", "AI_GLOBAL_MONTH_USD", "AI_GLOBAL_DAY_REQUESTS", "AI_GLOBAL_MONTH_REQUESTS", "AI_GLOBAL_CONCURRENCY"]) {
  test(`override cannot replace required base setting ${missing}`, async () => {
    process.env[overrideKey] = "60000"; delete process.env[missing];
    const h = harness(); await assert.rejects(h.reserve(), isError("BUDGET_NOT_CONFIGURED"));
    assert.equal(h.state.locks, 0); assert.equal(h.state.calls, 0);
  });
}
test("observed byte size passes only after 60000 cap has reserved worst-case cost and persisted matching snapshot", async () => {
  process.env[overrideKey] = "60000";
  const h = harness(), permit = await h.reserve();
  const row = h.state.rows[0];
  assert.equal(row.reserved_usd, .74); assert.equal(row.charged_usd, .74);
  assert.equal(row.price_snapshot.maxInputTokens, 60000);
  assert.equal(row.price_snapshot.maxOutputTokens, 25000); assert.equal(row.price_snapshot.maxAttempts, 2);
  assert.equal(row.price_snapshot.input, 2); assert.equal(row.price_snapshot.output, 10);
  await h.run(permit); await permit.finish(true);
  assert.equal(h.state.calls, 1); assert.equal(h.state.attempts[0].state, "reported");
  assert.equal(row.charged_usd, cost(permit.config.prices["gpt-6.1-sol"], 20000, 1000, 100));
});
test("two maximum attempts fit the reservation; third attempt is refused before provider", async () => {
  process.env[overrideKey] = "60000";
  const h = harness(), permit = await h.reserve();
  const result = { usage: { prompt_tokens: 60000, completion_tokens: 25000 } };
  await h.run(permit, paramsWithSize(60000), result); await h.run(permit, paramsWithSize(60000), result);
  await assert.rejects(h.run(permit), isError("MODEL_NOT_AUTHORIZED"));
  await permit.finish(true);
  assert.equal(h.state.calls, 2); assert.equal(h.state.attempts.length, 2);
  assert.equal(h.state.rows[0].reserved_usd, .74); assert.equal(h.state.rows[0].charged_usd, .74);
});
test("effective cap is fixed at reservation even if process setting later changes or disappears", async () => {
  process.env[overrideKey] = "60000";
  const h = harness(), permit = await h.reserve();
  process.env[overrideKey] = "invalid";
  await h.run(permit); delete process.env[overrideKey];
  await h.run(permit); await permit.finish(true);
  assert.equal(h.state.calls, 2); assert.equal(permit.config.prices["gpt-6.1-sol"].maxInputTokens, 60000);
  const next = await h.reserve();
  assert.equal(next.config.prices["gpt-6.1-sol"].maxInputTokens, 16000);
});
test("exact 60000 UTF-8 byte boundary passes; 60001 is denied before provider/attempt", async () => {
  process.env[overrideKey] = "60000";
  const h = harness(), permit = await h.reserve();
  await assert.rejects(h.run(permit, paramsWithSize(60001)), isError("MODEL_BUDGET_MISMATCH"));
  assert.equal(h.state.calls, 0); assert.equal(h.state.attempts.length, 0);
});
test("Q10 and legacy analyze reserve their original caps even with override enabled", async () => {
  process.env[overrideKey] = "60000";
  for (const feature of ["closing", "analyze"]) {
    const h = harness(), permit = await h.reserve(feature);
    const expectedModel = feature === "closing" ? "gpt-4o-mini" : "gpt-6.1-sol";
    assert.equal(permit.config.prices[expectedModel].maxInputTokens, 16000);
    await assert.rejects(h.run(permit, paramsWithSize(47336, feature)), isError("MODEL_BUDGET_MISMATCH"));
    assert.equal(h.state.calls, 0);
  }
});
for (const [label, envKey] of [["user monthly", "AI_USER_MONTH_USD"], ["global daily", "AI_GLOBAL_DAY_USD"], ["global monthly", "AI_GLOBAL_MONTH_USD"]]) {
  test(`${label} budget which allowed .564 still blocks the new .74 reservation`, async () => {
    process.env[overrideKey] = "60000"; process.env[envKey] = ".60";
    const h = harness(); await assert.rejects(h.reserve(), isError("AI_BUDGET_LIMIT"));
    assert.equal(h.state.rows.length, 0); assert.equal(h.state.calls, 0);
  });
}
test("per-account budget overrides the default user cap and refuses larger reservation", async () => {
  process.env[overrideKey] = "60000";
  const h = harness({ user: { monthlyBudget: ".60" } });
  await assert.rejects(h.reserve(), isError("AI_BUDGET_LIMIT")); assert.equal(h.state.calls, 0);
});
test("insufficient user/global money returns HTTP 429 before handler or provider", async () => {
  process.env[overrideKey] = "60000";
  for (const key of ["AI_USER_MONTH_USD", "AI_GLOBAL_DAY_USD", "AI_GLOBAL_MONTH_USD"]) {
    const old = process.env[key]; process.env[key] = ".60";
    const h = harness(); let handlerCalls = 0;
    const policy = h.policy;
    const api = createModuleLoader({
      "./policy": { ...policy, authConfig: () => ({ origins: ["https://preview.example.invalid"] }) },
      "./auth": { principal: async () => user }, "./rate-limit": { consumeWindow: async () => {} },
      "./usage": { reserveUsage: () => h.reserve(), requestDigest: () => "synthetic-digest" },
    })("lib/server/security/api.ts");
    const handler = api.protectAI("interpretation", async () => { handlerCalls++; return Response.json({}); });
    const response = await handler(new Request("https://preview.example.invalid/api/aurora-interpretation", {
      method: "POST", headers: { origin: "https://preview.example.invalid", "content-type": "application/json" }, body: "{}",
    }));
    assert.equal(response.status, 429); assert.equal((await response.json()).code, "AI_BUDGET_LIMIT");
    assert.equal(response.headers.get("retry-after"), "60"); assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(handlerCalls, 0); assert.equal(h.state.calls, 0); assert.equal(h.state.rows.length, 0);
    process.env[key] = old;
  }
});
for (const key of ["AI_USER_MONTH_USD", "AI_GLOBAL_DAY_USD", "AI_GLOBAL_MONTH_USD"]) test(`exact .74 available budget succeeds (${key})`, async () => {
  process.env[overrideKey] = "60000"; process.env[key] = ".74";
  assert.equal((await harness().reserve()).config.prices["gpt-6.1-sol"].maxInputTokens, 60000);
});
test("existing charged and pending money remain included in user/global budget checks", async () => {
  process.env[overrideKey] = "60000"; process.env.AI_GLOBAL_DAY_USD = "1";
  for (const state of ["success", "pending"]) {
    const h = harness({ rows: [priorRow({ state, charged_usd: .27 })] });
    await assert.rejects(h.reserve(), isError("AI_BUDGET_LIMIT")); assert.equal(h.state.calls, 0);
  }
});
for (const [label, patch, code] of [
  ["disabled account", { user: { status: "disabled" } }, "ACCOUNT_DISABLED"],
  ["daily feature quota", { user: { interpretationDaily: 0 } }, "USER_DAILY_LIMIT"],
  ["same-user concurrency", { rows: [priorRow({ user_id: user.id, state: "pending" })] }, "AI_BUSY"],
  ["global concurrency", { rows: [priorRow({ state: "pending" }), priorRow({ state: "pending" })] }, "AI_BUSY"],
]) test(`${label} stays enforced with override`, async () => {
  process.env[overrideKey] = "60000"; const h = harness(patch);
  await assert.rejects(h.reserve(), isError(code)); assert.equal(h.state.calls, 0);
});
test("global request quotas and duplicate digest remain enforced", async () => {
  process.env[overrideKey] = "60000";
  for (const key of ["AI_GLOBAL_DAY_REQUESTS", "AI_GLOBAL_MONTH_REQUESTS"]) {
    const old = process.env[key]; process.env[key] = "1";
    const h = harness({ rows: [priorRow()] }); await assert.rejects(h.reserve(), isError("GLOBAL_REQUEST_LIMIT"));
    process.env[key] = old; assert.equal(h.state.calls, 0);
  }
  const h = harness({ rows: [priorRow({ user_id: user.id, digest: "duplicate", created_at: now })] });
  await assert.rejects(h.reserve("interpretation", "duplicate"), isError("DUPLICATE_REQUEST"));
  assert.equal(h.state.calls, 0);
});
test("serialized budget reservations cannot both spend the last global .74 slot", async () => {
  process.env[overrideKey] = "60000"; process.env.AI_GLOBAL_DAY_USD = ".74";
  const h = harness();
  const results = await Promise.allSettled([h.reserve(), h.reserve("interpretation", randomUUID(), { ...user, id: "other-user" })]);
  assert.equal(results[0].status, "fulfilled");
  assert.equal(results[1].status, "rejected"); assert.equal(results[1].reason.code, "AI_BUDGET_LIMIT");
  assert.equal(h.state.rows.length, 1); assert.equal(h.state.calls, 0);
});
test("provider failure keeps the full .74 charge; it is never a free attempt", async () => {
  process.env[overrideKey] = "60000";
  const h = harness(), permit = await h.reserve();
  await assert.rejects(permit.run(paramsWithSize(47336), async () => { throw new Error("synthetic provider failure"); }));
  await permit.finish(false);
  assert.equal(h.state.attempts[0].state, "uncertain"); assert.equal(h.state.rows[0].charged_usd, .74);
});
for (const result of [{}, completion(60001), completion(100, 25001)]) test("unknown or over-cap reported usage retains worst-case charge", async () => {
  process.env[overrideKey] = "60000";
  const h = harness(), permit = await h.reserve(); await h.run(permit, paramsWithSize(47336), result); await permit.finish(true);
  assert.equal(h.state.attempts[0].state, "uncertain"); assert.equal(h.state.rows[0].charged_usd, .74);
});
test("DB reservation failure remains fail-closed without provider calls", async () => {
  process.env[overrideKey] = "60000"; const error = new Error("synthetic database failure"), h = harness({ dbError: error });
  await assert.rejects(h.reserve(), e => e === error); assert.equal(h.state.calls, 0);
});

test("120000 only expands explicit Preview interpretation config without changing rates or defaults", () => {
  const env = { ...fixtureEnv(), [overrideKey]: "120000" }, saved = JSON.stringify(env), base = budgetConfig(env);
  const effective = featureBudgetConfig("interpretation", env);
  assert.equal(effective.prices["gpt-6.1-sol"].maxInputTokens, 120000);
  assert.deepEqual({ ...effective.prices["gpt-6.1-sol"], maxInputTokens: 16000 }, base.prices["gpt-6.1-sol"]);
  for (const feature of ["closing", "analyze"]) assert.deepEqual(featureBudgetConfig(feature, env), base);
  for (const VERCEL_ENV of ["production", "development", undefined])
    assert.deepEqual(featureBudgetConfig("interpretation", { ...env, VERCEL_ENV }), base);
  assert.equal(JSON.stringify(env), saved);
});

for (const bytes of [60000, 90000, 110000, 120000]) test(`120000 Preview cap accepts ${bytes} total UTF-8 bytes with matching reservation and usage validation`, async () => {
  process.env[overrideKey] = "120000";
  const h = harness(), permit = await h.reserve(), row = h.state.rows[0];
  assert.equal(permit.config.prices["gpt-6.1-sol"].maxInputTokens, 120000);
  assert.equal(row.price_snapshot.maxInputTokens, 120000); assert.equal(row.reserved_usd, .98);
  await h.run(permit, paramsWithSize(bytes), completion(bytes)); await permit.finish(true);
  assert.equal(h.state.calls, 1); assert.equal(h.state.attempts[0].state, "reported");
  assert.equal(row.charged_usd, cost(permit.config.prices["gpt-6.1-sol"], bytes, 1000, 100));
});

for (const [reason, change, bytes] of [
  ["MODEL_NAME_MISMATCH", p => { p.model = "synthetic-other-model"; }, 60000],
  ["MAX_OUTPUT_TOKENS_MISMATCH", p => { p.max_completion_tokens = 180; }, 60000],
  ["INPUT_BYTES_EXCEEDED", () => {}, 120001],
]) test(`120000 cap still distinguishes ${reason} and settles a blocked request without charge`, async t => {
  process.env[overrideKey] = "120000";
  const entries = []; t.mock.method(console, "error", (...args) => entries.push(args));
  const h = harness(), permit = await h.reserve(), params = paramsWithSize(bytes); change(params);
  await assert.rejects(h.run(permit, params), isError("MODEL_BUDGET_MISMATCH"));
  assert.equal(h.state.calls, 0); assert.equal(h.state.attempts.length, 0);
  assert.equal(entries.length, 1); assert.deepEqual(entries[0][1].mismatchTypes, [reason]);
  assert.equal(entries[0][1].inputBytesWithOverhead, measured(params)); assert.equal(entries[0][1].maxInputTokens, 120000);
  assert.equal(JSON.stringify(entries).includes("synthetic-other-model"), false);
  await permit.finish(false); assert.equal(h.state.rows[0].charged_usd, 0); assert.equal(h.state.rows[0].state, "no-model");
});

test("an unchanged explicit 60000 setting still refuses 90000 bytes rather than silently raising its limit", async () => {
  process.env[overrideKey] = "60000";
  const h = harness(), permit = await h.reserve();
  await assert.rejects(h.run(permit, paramsWithSize(90000)), isError("MODEL_BUDGET_MISMATCH"));
  assert.equal(h.state.calls, 0); assert.equal(h.state.rows[0].reserved_usd, .74);
});

test("120000 reservation covers two maximum reports and refuses a third model attempt", async () => {
  process.env[overrideKey] = "120000";
  const h = harness(), permit = await h.reserve(), params = paramsWithSize(120000);
  const maximum = { usage: { prompt_tokens: 120000, completion_tokens: 25000 } };
  await h.run(permit, params, maximum); await h.run(permit, params, maximum);
  await assert.rejects(h.run(permit, params, maximum), isError("MODEL_NOT_AUTHORIZED"));
  await permit.finish(true);
  assert.equal(h.state.calls, 2); assert.equal(h.state.rows[0].reserved_usd, .98); assert.equal(h.state.rows[0].charged_usd, .98);
});

test("an oversized retry preserves the first reported cost without calling the provider twice", async () => {
  process.env[overrideKey] = "120000";
  const h = harness(), permit = await h.reserve();
  await h.run(permit, paramsWithSize(110000), completion(110000));
  const firstCost = h.state.attempts[0].estimated_usd;
  await assert.rejects(h.run(permit, paramsWithSize(120001)), isError("MODEL_BUDGET_MISMATCH"));
  await permit.finish(false);
  assert.equal(h.state.calls, 1); assert.equal(h.state.attempts.length, 1);
  assert.equal(h.state.rows[0].state, "failed"); assert.equal(h.state.rows[0].charged_usd, firstCost);
  assert.ok(firstCost > 0 && firstCost < .98);
});

test("120000 permit retains its reserved cap when the setting changes before both attempts", async () => {
  process.env[overrideKey] = "120000";
  const h = harness(), permit = await h.reserve(); process.env[overrideKey] = "60000";
  await h.run(permit, paramsWithSize(110000), completion(110000)); delete process.env[overrideKey];
  await h.run(permit, paramsWithSize(110000), completion(110000)); await permit.finish(true);
  assert.equal(h.state.calls, 2); assert.equal(permit.config.prices["gpt-6.1-sol"].maxInputTokens, 120000);
  assert.equal(h.state.rows[0].reserved_usd, .98);
});

for (const result of [{}, completion(120001), completion(1000, 25001)]) test("unknown or over-120000 usage retains the .98 reservation", async () => {
  process.env[overrideKey] = "120000";
  const h = harness(), permit = await h.reserve(); await h.run(permit, paramsWithSize(110000), result); await permit.finish(true);
  assert.equal(h.state.attempts[0].state, "uncertain"); assert.equal(h.state.rows[0].charged_usd, .98);
});

test("provider cancellation at the expanded cap never releases an uncertain .98 cost", async () => {
  process.env[overrideKey] = "120000";
  const h = harness(), permit = await h.reserve(), controller = new AbortController();
  const pending = permit.run(paramsWithSize(110000), () => { h.state.calls++; controller.abort(); return new Promise(() => {}); }, controller.signal);
  await assert.rejects(pending, isError("REQUEST_TIMEOUT")); await permit.finish(false);
  assert.equal(h.state.calls, 1); assert.equal(h.state.attempts[0].state, "uncertain"); assert.equal(h.state.rows[0].charged_usd, .98);
});

for (const key of ["AI_USER_MONTH_USD", "AI_GLOBAL_DAY_USD", "AI_GLOBAL_MONTH_USD"]) test(`expanded .98 reservation is blocked by .97 remaining (${key})`, async () => {
  process.env[overrideKey] = "120000"; process.env[key] = ".97";
  const h = harness(); await assert.rejects(h.reserve(), isError("AI_BUDGET_LIMIT")); assert.equal(h.state.rows.length, 0);
});

for (const monthlyBudget of [20, 25, 30]) test(`existing account policy supports ten daily interpretations and $${monthlyBudget} monthly cap without changing Q10`, async () => {
  process.env[overrideKey] = "120000";
  const rows = Array.from({ length: 9 }, (_, i) => priorRow({ id: `prior-${i}`, user_id: user.id, feature: "interpretation", charged_usd: .98 }));
  const account = { interpretationDaily: 10, monthlyBudget: String(monthlyBudget) };
  const h = harness({ rows, user: account }), tenth = await h.reserve();
  assert.equal(h.state.rows.at(-1).reserved_usd, .98);
  await h.run(tenth, paramsWithSize(110000)); await tenth.finish(true);
  await assert.rejects(h.reserve(), isError("USER_DAILY_LIMIT"));
  // Nine earlier interpretations do not consume the distinct Q10 daily count.
  const closing = await h.reserve("closing"); assert.equal(closing.config.prices["gpt-4o-mini"].maxInputTokens, 16000);
});

test("account monthly override does not bypass the shared global monthly budget", async () => {
  process.env[overrideKey] = "120000"; process.env.AI_GLOBAL_MONTH_USD = ".97";
  const h = harness({ user: { interpretationDaily: 10, monthlyBudget: "25" } });
  await assert.rejects(h.reserve(), isError("AI_BUDGET_LIMIT")); assert.equal(h.state.rows.length, 0);
});
