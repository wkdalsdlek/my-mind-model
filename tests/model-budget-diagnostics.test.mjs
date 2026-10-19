import assert from "node:assert/strict";
import { test, beforeEach, afterEach } from "node:test";
import { createHmac, randomUUID } from "node:crypto";
import { createModuleLoader } from "./helpers/load-typescript.mjs";
import { universeState } from "./helpers/aurora-universe-fixture.mjs";

let savedPreview;
beforeEach(() => { savedPreview = process.env.VERCEL_ENV; process.env.VERCEL_ENV = "preview"; });
afterEach(() => {
  if (savedPreview === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = savedPreview;
});
const paramsFor = (feature = "interpretation") => ({
  model: "gpt-6.1-sol",
  max_completion_tokens: feature === "closing" ? 4096 : 25000,
  messages: [{ role: "user", content: "PRIVATE_ANSWER_MARKER 한글 🌌" }],
  response_format: { type: "json_schema", json_schema: { name: "synthetic", schema: { description: "PRIVATE_SCHEMA_MARKER" } } },
});
const measured = params => Buffer.byteLength(JSON.stringify(params), "utf8") + 4096;
function permitCase(feature = "interpretation", maxInputTokens = 1000000) {
  const queries = [], locks = [];
  const db = { async query(sql, values) {
    queries.push({ sql, values });
    if (sql.startsWith("SELECT * FROM ai_request")) return { rows: [{ attempts: 0 }] };
    if (sql.startsWith("SELECT status")) return { rows: [{ status: "active" }] };
    return { rows: [], rowCount: 0 };
  } };
  const load = createModuleLoader({ "node:crypto": { createHmac, randomUUID },
    "./database": { locked: async fn => { locks.push(true); return fn(db); } } });
  const price = { input: 2, cachedInput: .1, output: 10, maxInputTokens };
  const config = { prices: { "gpt-4o-mini": price, "gpt-6.1-sol": price } };
  const permit = new (load("lib/server/security/usage.ts").ModelPermit)("PRIVATE_REQUEST_MARKER", "PRIVATE_USER_MARKER", feature, config);
  return { permit, queries, locks, load };
}
function capture(t) {
  const entries = [];
  t.mock.method(console, "error", (...args) => entries.push(args));
  return entries;
}
function assertSafe(entries) {
  assert.equal(JSON.stringify(entries).includes("PRIVATE_"), false);
  for (const [tag, data] of entries) {
    assert.equal(tag, "[private-beta-model-budget]");
    assert.deepEqual(Object.keys(data).sort(), ["stage", "code", "feature", "mismatchTypes", "expectedModel",
      "inputBytesWithOverhead", "inputOverheadBytes", "maxInputTokens", "expectedMaxCompletionTokens", "requestedMaxCompletionTokens"].sort());
    assert.equal(data.stage, "model.permit.validate");
    assert.equal(data.code, "MODEL_BUDGET_MISMATCH");
  }
}
async function denied(c, params) {
  let calls = 0;
  await assert.rejects(c.permit.run(params, async () => { calls++; return {}; }), error =>
    error === c.permit.fault && error.code === "MODEL_BUDGET_MISMATCH" && error.status === 503);
  assert.equal(calls, 0);
  assert.equal(c.locks.length, 0);
  assert.equal(c.queries.length, 0);
}

for (const [label, mutate, cap, reason] of [
  ["model name", p => { p.model = "PRIVATE_API_KEY_OR_MODEL_MARKER"; }, 1000000, "MODEL_NAME_MISMATCH"],
  ["maximum output tokens", p => { p.max_completion_tokens = 180; }, 1000000, "MAX_OUTPUT_TOKENS_MISMATCH"],
  ["input byte cap", () => {}, 4096, "INPUT_BYTES_EXCEEDED"],
]) test(`${label} mismatch is distinguished and blocked before DB attempt or provider`, async t => {
  const entries = capture(t), params = paramsFor(), c = permitCase("interpretation", cap);
  mutate(params); await denied(c, params);
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0][1].mismatchTypes, [reason]);
  assert.equal(entries[0][1].inputBytesWithOverhead, measured(params));
  assert.equal(entries[0][1].maxInputTokens, cap);
  assert.equal(entries[0][1].expectedModel, "gpt-6.1-sol");
  assert.equal(entries[0][1].expectedMaxCompletionTokens, 25000);
  assertSafe(entries);
});

test("simultaneous mismatches are all recorded without short-circuiting diagnostics", async t => {
  const entries = capture(t), c = permitCase("interpretation", 4096), params = paramsFor();
  params.model = "PRIVATE_MODEL_MARKER"; params.max_completion_tokens = 1;
  await denied(c, params);
  assert.deepEqual(entries[0][1].mismatchTypes, ["MODEL_NAME_MISMATCH", "MAX_OUTPUT_TOKENS_MISMATCH", "INPUT_BYTES_EXCEEDED"]);
  assertSafe(entries);
});

test("UTF-8 multibyte text, full JSON schema and 4096 overhead are counted exactly", async t => {
  const entries = capture(t), params = paramsFor();
  assert.ok(Buffer.byteLength(JSON.stringify(params), "utf8") > JSON.stringify(params).length);
  await denied(permitCase("interpretation", measured(params) - 1), params);
  assert.equal(entries[0][1].inputBytesWithOverhead, measured(params));
  assert.equal(entries[0][1].inputOverheadBytes, 4096);
  assertSafe(entries);
});

for (const feature of ["closing", "interpretation", "analyze"]) {
  test(`${feature}: exact byte boundary allows the original call and usage accounting without logs`, async t => {
    const entries = capture(t), params = paramsFor(feature), c = permitCase(feature, measured(params));
    let calls = 0, revalidations = 0;
    c.permit.revalidate = async () => { revalidations++; };
    const completion = { usage: { prompt_tokens: 100, completion_tokens: 50 } };
    assert.equal(await c.permit.run(params, async () => { calls++; return completion; }), completion);
    assert.equal(calls, 1); assert.equal(revalidations, 1); assert.equal(c.permit.fault, undefined);
    assert.equal(c.locks.length, 2);
    assert.ok(c.queries.some(q => q.sql.startsWith("INSERT INTO ai_attempt")));
    assert.equal(c.queries.at(-1).values[2], "reported");
    assert.equal(entries.length, 0);
  });
  test(`${feature}: diagnostic identifies the actual feature`, async t => {
    const entries = capture(t), params = paramsFor(feature);
    await denied(permitCase(feature, 4096), params);
    assert.equal(entries[0][1].feature, feature);
    assertSafe(entries);
  });
}

for (const output of [undefined, null, "PRIVATE_TOKEN_MARKER", NaN, Infinity, -1]) {
  test(`invalid output setting (${typeof output}, ${output === null ? "null" : "synthetic"}) remains denied with safe numeric metadata`, async t => {
    const entries = capture(t), params = paramsFor(); params.max_completion_tokens = output;
    await denied(permitCase(), params);
    assert.deepEqual(entries[0][1].mismatchTypes, ["MAX_OUTPUT_TOKENS_MISMATCH"]);
    assert.equal(entries[0][1].requestedMaxCompletionTokens, null);
    assertSafe(entries);
  });
}

test("production, local and unset environments stay silent while enforcing the same denial", async t => {
  const entries = capture(t);
  for (const env of ["production", "development", undefined]) {
    if (env === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = env;
    await denied(permitCase("interpretation", 4096), paramsFor());
  }
  assert.equal(entries.length, 0);
});
test("failed log sink preserves fault, status and provider denial", async t => {
  t.mock.method(console, "error", () => { throw new Error("PRIVATE_LOG_SINK_MARKER"); });
  await denied(permitCase("interpretation", 4096), paramsFor());
});
test("session revalidation failure still precedes model guard and provider call", async t => {
  const entries = capture(t), c = permitCase("interpretation", 4096);
  const error = new (c.load("lib/server/security/policy.ts").SecurityError)("ACCOUNT_DISABLED", 403);
  c.permit.revalidate = async () => { throw error; };
  await assert.rejects(c.permit.run(paramsFor(), async () => assert.fail("provider called")), e => e === error && e === c.permit.fault);
  assert.equal(entries.length, 0); assert.equal(c.locks.length, 0);
});
test("diagnostic runtime allowlists discard arbitrary identifiers and unsafe numeric values", t => {
  const entries = capture(t), { logModelBudgetMismatch } = createModuleLoader()("lib/server/security/model-budget-diagnostics.ts");
  logModelBudgetMismatch("PRIVATE_FEATURE_MARKER", ["INPUT_BYTES_EXCEEDED"], 10, 1, 25000);
  logModelBudgetMismatch("interpretation", ["PRIVATE_REASON_MARKER"], 10, 1, 25000);
  assert.equal(entries.length, 0);
  logModelBudgetMismatch("interpretation", ["INPUT_BYTES_EXCEEDED", "PRIVATE_REASON_MARKER"], Infinity, -1, "PRIVATE_TOKEN_MARKER");
  assert.deepEqual(entries[0][1].mismatchTypes, ["INPUT_BYTES_EXCEEDED"]);
  for (const key of ["inputBytesWithOverhead", "maxInputTokens", "requestedMaxCompletionTokens"]) assert.equal(entries[0][1][key], null);
  assertSafe(entries);
});
test("real protection wrapper returns the original 503 contract even if service catches permit failure", async t => {
  const entries = capture(t), c = permitCase("interpretation", 4096), settled = [];
  c.permit.finish = async success => { settled.push(success); };
  const policy = c.load("lib/server/security/policy.ts");
  const load = createModuleLoader({
    "./policy": { ...policy, authConfig: () => ({ origins: ["https://preview.example.invalid"] }) },
    "./auth": { principal: async () => ({ id: "PRIVATE_USER_MARKER" }) },
    "./rate-limit": { consumeWindow: async () => {} },
    "./usage": { reserveUsage: async () => c.permit, requestDigest: () => "PRIVATE_DIGEST_MARKER" },
  });
  const handler = load("lib/server/security/api.ts").protectAI("interpretation", async (_req, permit) => {
    try { await permit.run(paramsFor(), async () => assert.fail("provider called")); }
    catch { return Response.json({ code: "INTERPRETATION_FAILED" }, { status: 502 }); }
    assert.fail("unexpected success");
  });
  const response = await handler(new Request("https://preview.example.invalid/api/aurora-interpretation", {
    method: "POST", headers: { origin: "https://preview.example.invalid", "content-type": "application/json" }, body: "{}",
  }));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { code: "MODEL_BUDGET_MISMATCH", error: "접근 권한 또는 서비스 설정을 확인해 주세요. 답변은 유지됩니다." });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(settled, [false]); assert.equal(c.locks.length, 0);
  assertSafe(entries);
});
test("real interpretation model and output constants match the unchanged budget policy", () => {
  const load = createModuleLoader(), service = load("lib/server/aurora-interpretation-service.ts");
  const expected = load("lib/server/security/policy.ts").featureModel("interpretation");
  assert.equal(service.INTERPRETATION_MODEL, expected.model);
  assert.equal(service.INTERPRETATION_MAX_COMPLETION_TOKENS, expected.output);
});
test("actual interpretation route reproduces byte-cap failure using real request construction and no SDK call", async t => {
  const entries = capture(t), c = permitCase("interpretation", 4096), settled = [];
  c.permit.finish = async success => { settled.push(success); };
  const policy = c.load("lib/server/security/policy.ts");
  const api = createModuleLoader({
    "./policy": { ...policy, authConfig: () => ({ origins: ["https://preview.example.invalid"] }) },
    "./auth": { principal: async () => ({ id: "PRIVATE_USER_MARKER" }) },
    "./rate-limit": { consumeWindow: async () => {} },
    "./usage": { reserveUsage: async () => c.permit, requestDigest: () => "PRIVATE_DIGEST_MARKER" },
  })("lib/server/security/api.ts");
  const pure = createModuleLoader(), service = pure("lib/server/aurora-interpretation-service.ts");
  const { buildAuroraInterpretationRequest } = pure("lib/aurora-interpretation.ts");
  let providerCalls = 0, serializedBytes;
  const run = c.permit.run.bind(c.permit);
  c.permit.run = (params, call) => { serializedBytes = measured(params); return run(params, call); };
  class MockOpenAI {
    chat = { completions: { create: async () => { providerCalls++; assert.fail("provider called"); } } };
  }
  const route = createModuleLoader({ openai: MockOpenAI,
    "../../../lib/server/security/api": api,
    "../../../lib/server/aurora-interpretation-service": { ...service,
      createAuroraInterpretationHandler: deps => service.createAuroraInterpretationHandler({ ...deps,
        apiKey: () => "PRIVATE_SYNTHETIC_KEY_MARKER", diagnostic: () => {} }),
    },
  })("app/api/aurora-interpretation/route.ts");
  const response = await route.POST(new Request("https://preview.example.invalid/api/aurora-interpretation", {
    method: "POST", headers: { origin: "https://preview.example.invalid", "content-type": "application/json" },
    body: JSON.stringify(buildAuroraInterpretationRequest(universeState(), "balanced", "hybrid")),
  }));
  assert.equal(response.status, 503); assert.equal((await response.json()).code, "MODEL_BUDGET_MISMATCH");
  assert.equal(providerCalls, 0); assert.equal(c.locks.length, 0); assert.deepEqual(settled, [false]);
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0][1].mismatchTypes, ["INPUT_BYTES_EXCEEDED"]);
  assert.equal(entries[0][1].inputBytesWithOverhead, serializedBytes);
  assert.ok(serializedBytes > 4096);
  assertSafe(entries);
});
