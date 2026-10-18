import assert from "node:assert/strict";
import { test } from "node:test";
import { createHmac, randomUUID } from "node:crypto";
import { createModuleLoader } from "./helpers/load-typescript.mjs";
import { universeState } from "./helpers/aurora-universe-fixture.mjs";

const inputModule = createModuleLoader()("lib/aurora-interpretation.ts");
const flush = () => new Promise(resolve => setImmediate(resolve));
async function until(check) { for (let i = 0; i < 1000; i++) { if (check()) return; await flush(); } assert.fail("mock did not become ready"); }
function clockFor(t) {
  let now = 0, id = 0; const tasks = new Map();
  const schedule = (ms, call) => { const key = ++id; tasks.set(key, { at: now + ms, call }); return key; };
  t.mock.method(performance, "now", () => now);
  t.mock.method(globalThis, "setTimeout", (fn, ms, ...args) => ({ key: schedule(ms, () => fn(...args)), unref() {} }));
  t.mock.method(globalThis, "clearTimeout", timer => { tasks.delete(timer?.key ?? timer); });
  t.mock.method(AbortSignal, "timeout", ms => {
    const controller = new AbortController(); schedule(ms, () => controller.abort(new DOMException("Synthetic deadline", "TimeoutError")));
    return controller.signal;
  });
  return { schedule, async advance(ms) {
    const end = now + ms;
    while (true) {
      const next = [...tasks].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      now = next[1].at; tasks.delete(next[0]); next[1].call(); await flush();
    }
    now = end; await flush();
  }, delay(ms, signal, ignoreAbort = false) {
    return new Promise((resolve, reject) => {
      const abort = () => { tasks.delete(key); reject(new Error("PRIVATE_ABORT_MARKER")); };
      const key = schedule(ms, () => { signal?.removeEventListener("abort", abort); resolve(); });
      if (!ignoreAbort && signal) {
        if (signal.aborted) { abort(); return; }
        signal.addEventListener("abort", abort, { once: true });
      }
    });
  } };
}
function output(context, invalid = false) {
  if (invalid) return "{}";
  const grounded = refs => ({ text: "실제 표현에서 여러 가치를 함께 살피려는 가능성을 읽어 볼 수 있습니다.", evidenceRefs: refs,
    basis: refs.length ? "answer-grounded" : "insufficient-evidence" });
  return JSON.stringify({ auroraName: "함께 흐르는 시간", quoteId: "seneca-letters-1-1-self", q10Anchor: "내 시간",
    quoteReason: ["내 시간을 지키려는 승인 문장의 주제와 닿아 있습니다."],
    overall: grounded(context.facts.questions.flatMap(q => q.evidence.map(e => e.ref))),
    ribbons: Object.fromEntries(context.facts.ribbons.map(r => [r.ribbonId, { ribbonId: r.ribbonId,
      psychological: grounded(r.evidence.map(e => e.ref)), philosophical: grounded(r.evidence.map(e => e.ref)),
      reflectionQuestion: "이 가치를 일상에서 어떻게 돌보고 싶나요?" }])) });
}
class MockSdkTimeout extends Error {}
function scenario(t, plans, options = {}) {
  const clock = clockFor(t), diagnostics = [], attempts = [];
  const sharedPolicy = createModuleLoader()("lib/server/security/policy.ts");
  const deadlineModule = createModuleLoader({ "./security/policy": sharedPolicy })("lib/server/interpretation-deadline.ts");
  if (options.attemptMs !== undefined) deadlineModule.INTERPRETATION_TIMING.attemptMs = options.attemptMs;
  if (options.workMs !== undefined) deadlineModule.INTERPRETATION_TIMING.workMs = options.workMs;
  if (options.totalMs !== undefined) deadlineModule.INTERPRETATION_TIMING.totalMs = options.totalMs;
  const row = { state: "pending", attempts: 0, reserved_usd: .74, charged_usd: .74 };
  const counts = { provider: 0, reserves: 0, finishes: 0, auth: 0, reservationStarted: 0 };
  const db = { async query(sql, values = []) {
    const one = r => ({ rows: r ? [r] : [], rowCount: r ? 1 : 0 });
    if (sql.startsWith("SELECT * FROM ai_request")) return one(row);
    if (sql.startsWith('SELECT status FROM "user"')) return one({ status: "active" });
    if (sql.startsWith("SELECT 1 FROM ai_attempt")) return { rows: [], rowCount: attempts.filter(a => a.state === "started").length };
    if (sql.startsWith("UPDATE ai_request SET attempts=")) { row.attempts = values[1]; return one(); }
    if (sql.startsWith("INSERT INTO ai_attempt")) { attempts.push({ number: values[1], state: "started" }); return one(); }
    if (sql.startsWith("UPDATE ai_attempt SET state='uncertain'")) {
      if (options.uncertainDelayMs) await clock.delay(options.uncertainDelayMs);
      attempts[values[1] - 1].state = "uncertain"; return one();
    }
    if (sql.startsWith("UPDATE ai_attempt SET state=$3")) {
      Object.assign(attempts[values[1] - 1], { state: values[2], estimated_usd: values[7] }); return one();
    }
    if (sql.startsWith("SELECT state,estimated_usd FROM ai_attempt")) return { rows: attempts };
    if (sql.startsWith("UPDATE ai_request SET state=$2")) {
      if (options.finishDelayMs) await clock.delay(options.finishDelayMs);
      Object.assign(row, { state: values[1], estimated_usd: values[2], charged_usd: values[3] }); counts.finishes++; return one();
    }
    assert.fail("Unexpected in-memory query");
  } };
  const load = createModuleLoader({ "node:crypto": { createHmac, randomUUID }, "./policy": sharedPolicy,
    "../interpretation-deadline": deadlineModule, "./database": { locked: fn => fn(db) } });
  const { ModelPermit } = load("lib/server/security/usage.ts"), policy = sharedPolicy;
  const permit = new ModelPermit("synthetic-request", "synthetic-user", "interpretation", {
    prices: { "gpt-6.1-sol": { input: 2, cachedInput: .1, output: 10, maxInputTokens: 60000 } },
  });
  const service = createModuleLoader({ "./interpretation-deadline": deadlineModule })("lib/server/aurora-interpretation-service.ts");
  const dependencies = { apiKey: () => "mock-only", diagnostic: v => diagnostics.push(v),
    isTimeoutError: error => error instanceof MockSdkTimeout,
    complete: async ({ context, attempt, signal }) => {
      const plan = plans[attempt - 1]; assert.ok(plan, "unexpected extra attempt");
      const result = await permit.run({ model: "gpt-6.1-sol", max_completion_tokens: 25000 }, async () => {
        counts.provider++; await clock.delay(plan.delay, signal, plan.ignoreAbort);
        if (plan.sdkTimeout) throw new MockSdkTimeout("PRIVATE_SDK_MARKER");
        if (plan.error) throw plan.error;
        return { content: output(context, plan.invalid), usage: plan.noUsage ? undefined : { prompt_tokens: 1000, completion_tokens: 2000 } };
      }, signal);
      return { content: result.content, finishReason: "stop", refused: false,
        usage: result.usage ? { promptTokens: 1000, completionTokens: 2000, totalTokens: 3000 } : undefined };
    } };
  const api = createModuleLoader({ "./policy": { ...policy, authConfig: () => ({ origins: ["https://preview.example.invalid"] }) },
    "../interpretation-deadline": deadlineModule,
    "./auth": { principal: async () => {
      counts.auth++;
      if (counts.auth === 1 && options.authenticationDelayMs) await clock.delay(options.authenticationDelayMs);
      if (counts.auth === 2 && options.revalidationDelayMs) await clock.delay(options.revalidationDelayMs);
      return { id: "synthetic-user" };
    } }, "./rate-limit": { consumeWindow: async () => {} },
    "./usage": { reserveUsage: async () => {
      counts.reservationStarted++;
      if (options.reservationDelayMs) await clock.delay(options.reservationDelayMs);
      counts.reserves++; return permit;
    }, requestDigest: () => "synthetic-digest" },
  })("lib/server/security/api.ts");
  const controller = new AbortController(), state = universeState(), saved = structuredClone(state);
  const payload = inputModule.buildAuroraInterpretationRequest(state, "balanced", "hybrid");
  if (options.preAbort) controller.abort();
  const request = new Request("https://preview.example.invalid/api/aurora-interpretation", { method: "POST",
    headers: { origin: "https://preview.example.invalid", "content-type": "application/json" }, body: JSON.stringify(payload), signal: controller.signal });
  const promise = api.protectAI("interpretation", (req, _permit, deadline) => service.createAuroraInterpretationHandler({ ...dependencies, deadline })(req))(request);
  const assertPrivate = () => {
    assert.deepEqual(state, saved);
    assert.ok(!JSON.stringify(diagnostics).includes("PRIVATE_"));
    assert.ok(diagnostics.every(d => !Object.hasOwn(d, "content") && !Object.hasOwn(d, "context")));
  };
  return { clock, diagnostics, attempts, row, counts, controller, promise, assertPrivate };
}

test("actual 45000ms signal reproduces 408, one attempt and conservative .74 settlement", async t => {
  const s = scenario(t, [{ delay: 60000 }], { attemptMs: 45000 }); await until(() => s.counts.provider === 1);
  await s.clock.advance(45000);
  assert.equal((await s.promise).status, 408);
  assert.equal(s.counts.provider, 1); assert.equal(s.counts.finishes, 1);
  assert.equal(s.diagnostics[0].abortSource, "attempt-timeout");
  assert.equal(s.diagnostics[0].attemptElapsedMs, 45000); assert.equal(s.diagnostics[0].attemptTimeoutMs, 45000);
  assert.equal(s.attempts[0].state, "uncertain"); assert.equal(s.row.charged_usd, .74); s.assertPrivate();
});
test("70000ms candidate accepts a complete response at 60000ms with unchanged actual usage billing", async t => {
  const s = scenario(t, [{ delay: 60000 }], { attemptMs: 70000 }); await until(() => s.counts.provider === 1);
  await s.clock.advance(60000); const response = await s.promise;
  assert.equal(response.status, 200); assert.equal(s.counts.provider, 1);
  assert.equal(s.row.charged_usd, .022); assert.equal(s.attempts[0].state, "reported");
  assert.equal(s.diagnostics[0].attemptElapsedMs, 60000); s.assertPrivate();
});
test("70000ms candidate still refuses an overdue response without automatically retrying", async t => {
  const s = scenario(t, [{ delay: 75000 }], { attemptMs: 70000 }); await until(() => s.counts.provider === 1);
  await s.clock.advance(70000); assert.equal((await s.promise).status, 408);
  assert.equal(s.counts.provider, 1); assert.equal(s.row.charged_usd, .74); s.assertPrivate();
});
test("85s shared work budget prevents two full 70s calls; late second attempt is billed conservatively", async t => {
  const s = scenario(t, [{ delay: 60000, invalid: true }, { delay: 60000 }], { attemptMs: 70000 });
  await until(() => s.counts.provider === 1); await s.clock.advance(60000);
  assert.equal(s.counts.provider, 2); await s.clock.advance(25000);
  assert.equal((await s.promise).status, 408); assert.equal(s.diagnostics.at(-1).abortSource, "work-timeout");
  assert.equal(s.diagnostics.at(-1).attemptElapsedMs, 25000); assert.equal(s.row.charged_usd, .74); s.assertPrivate();
});
test("recommended 85s shared work budget leaves 10s before 95s target", async t => {
  const s = scenario(t, [{ delay: 60000, invalid: true }, { delay: 30000 }]);
  await until(() => s.counts.provider === 1); await s.clock.advance(60000); await s.clock.advance(25000);
  assert.equal((await s.promise).status, 408); assert.equal(s.diagnostics.at(-1).elapsedMs, 85000);
  assert.equal(s.diagnostics.at(-1).abortSource, "work-timeout"); assert.equal(s.counts.provider, 2); s.assertPrivate();
});
test("early validation failure allows a second full 70s candidate within 85s", async t => {
  const s = scenario(t, [{ delay: 10000, invalid: true }, { delay: 70000 - 1 }]);
  await until(() => s.counts.provider === 1); await s.clock.advance(10000); await s.clock.advance(69999);
  assert.equal((await s.promise).status, 200); assert.equal(s.counts.provider, 2);
  assert.equal(s.row.charged_usd, .044); s.assertPrivate();
});
test("two invalid delayed outputs never cause a third attempt", async t => {
  const s = scenario(t, [{ delay: 30000, invalid: true }, { delay: 30000, invalid: true }]);
  await until(() => s.counts.provider === 1); await s.clock.advance(60000);
  assert.equal((await s.promise).status, 502); assert.equal(s.counts.provider, 2); assert.equal(s.row.charged_usd, .044); s.assertPrivate();
});
test("manual client cancellation remains distinct from a deadline and does not refund ambiguous usage", async t => {
  const s = scenario(t, [{ delay: 60000 }]); await until(() => s.counts.provider === 1);
  await s.clock.advance(12000); s.controller.abort(); await flush();
  assert.equal((await s.promise).status, 408); assert.equal(s.diagnostics[0].abortSource, "client-abort");
  assert.equal(s.counts.provider, 1); assert.equal(s.row.charged_usd, .74); s.assertPrivate();
});
test("cancellation before reservation starts no SDK call or usage settlement", async t => {
  const s = scenario(t, [], { preAbort: true }); assert.equal((await s.promise).status, 408);
  assert.equal(s.counts.provider, 0); assert.equal(s.counts.reserves, 0); assert.equal(s.counts.finishes, 0); s.assertPrivate();
});
test("late abort-ignoring response cannot become success; uncertain reservation is retained", async t => {
  const s = scenario(t, [{ delay: 60000, ignoreAbort: true }], { attemptMs: 45000 }); await until(() => s.counts.provider === 1);
  await s.clock.advance(60000); assert.equal((await s.promise).status, 408);
  assert.equal(s.diagnostics[0].abortSource, "attempt-timeout"); assert.equal(s.row.charged_usd, .74);
  assert.equal(s.counts.provider, 1); s.assertPrivate();
});
test("SDK timeout without an already-aborted signal is classified as 408 without raw error logging", async t => {
  const s = scenario(t, [{ delay: 45000, sdkTimeout: true }], { attemptMs: 70000 }); await until(() => s.counts.provider === 1);
  await s.clock.advance(45000); assert.equal((await s.promise).status, 408);
  assert.equal(s.diagnostics[0].abortSource, "sdk-timeout"); assert.equal(s.row.charged_usd, .74); s.assertPrivate();
});
test("DB attempt settlement delay can extend response time beyond the model timeout", async t => {
  const s = scenario(t, [{ delay: 60000 }], { attemptMs: 45000, uncertainDelayMs: 10000 }); let settled = false;
  s.promise.then(() => { settled = true; }); await until(() => s.counts.provider === 1);
  await s.clock.advance(45000); assert.equal(settled, false); await s.clock.advance(10000);
  assert.equal((await s.promise).status, 408); assert.equal(s.diagnostics[0].attemptElapsedMs, 55000);
  assert.equal(s.diagnostics[0].abortSource, "attempt-timeout"); assert.equal(s.row.charged_usd, .74); s.assertPrivate();
});
test("transport failure and missing usage never silently erase reserved cost", async t => {
  const s = scenario(t, [{ delay: 10000, error: new Error("PRIVATE_NETWORK_MARKER") }]);
  await until(() => s.counts.provider === 1); await s.clock.advance(10000);
  assert.equal((await s.promise).status, 502); assert.equal(s.row.charged_usd, .74);
  assert.equal(s.diagnostics[0].abortSource, "none"); s.assertPrivate();
});
test("successful response without token usage keeps the existing full-reservation policy", async t => {
  const s = scenario(t, [{ delay: 10000, noUsage: true }]); await until(() => s.counts.provider === 1);
  await s.clock.advance(10000); assert.equal((await s.promise).status, 200);
  assert.equal(s.attempts[0].state, "uncertain"); assert.equal(s.row.charged_usd, .74); s.assertPrivate();
});
test("authentication time is deducted from the first attempt rather than resetting the clock", async t => {
  const s = scenario(t, [{ delay: 60000 }], { authenticationDelayMs: 20000 });
  await until(() => s.counts.auth === 1); await s.clock.advance(20000);
  // Request preparation includes asynchronous WebCrypto; a single event-loop
  // flush is not a completion barrier under parallel test load.
  await until(() => s.counts.provider === 1);
  assert.equal(s.counts.provider, 1); await s.clock.advance(60000);
  assert.equal((await s.promise).status, 200);
  assert.equal(s.diagnostics[0].attemptTimeoutMs, 65000); assert.equal(s.diagnostics[0].elapsedMs, 80000);
  assert.equal(s.row.charged_usd, .022); s.assertPrivate();
});
test("authentication timeout at 85s cannot create a late reservation or model call", async t => {
  const s = scenario(t, [], { authenticationDelayMs: 120000 });
  await until(() => s.counts.auth === 1); await s.clock.advance(85000);
  assert.equal((await s.promise).status, 408); assert.equal(s.counts.reserves, 0);
  await s.clock.advance(40000); assert.equal(s.counts.provider, 0); assert.equal(s.counts.reserves, 0); s.assertPrivate();
});
test("fewer than 20 seconds prevents a meaningless first call and refunds no-model reservation", async t => {
  const s = scenario(t, [], { authenticationDelayMs: 66000 });
  await until(() => s.counts.auth === 1); await s.clock.advance(66000);
  assert.equal((await s.promise).status, 408); assert.equal(s.counts.provider, 0);
  assert.equal(s.row.charged_usd, 0); assert.equal(s.row.state, "no-model"); s.assertPrivate();
});
test("late invalid first response leaves too little for a second paid request", async t => {
  const s = scenario(t, [{ delay: 66000, invalid: true }]);
  await until(() => s.counts.provider === 1); await s.clock.advance(66000);
  assert.equal((await s.promise).status, 408); assert.equal(s.counts.provider, 1);
  assert.equal(s.diagnostics.at(-1).abortSource, "insufficient-time"); assert.equal(s.row.charged_usd, .022); s.assertPrivate();
});
test("cancellation while session revalidation waits starts no later SDK callback", async t => {
  const s = scenario(t, [{ delay: 1000 }], { revalidationDelayMs: 60000 });
  await until(() => s.counts.auth === 2); await s.clock.advance(10000); s.controller.abort(); await flush();
  assert.equal((await s.promise).status, 408); assert.equal(s.counts.provider, 0); assert.equal(s.attempts.length, 0);
  await s.clock.advance(60000); assert.equal(s.counts.provider, 0); assert.equal(s.row.charged_usd, 0); s.assertPrivate();
});
test("server 95s target responds during slow settlement without prematurely releasing the ledger", async t => {
  const s = scenario(t, [{ delay: 65000 }], { finishDelayMs: 40000 });
  await until(() => s.counts.provider === 1); await s.clock.advance(65000); await s.clock.advance(30000);
  assert.equal((await s.promise).status, 408);
  assert.equal(s.row.state, "pending"); assert.equal(s.row.charged_usd, .74); assert.equal(s.counts.provider, 1);
  await s.clock.advance(10000); assert.equal(s.row.charged_usd, .022); assert.equal(s.counts.provider, 1); s.assertPrivate();
});
test("late reservation completion is settled but cannot start an SDK call after response", async t => {
  const s = scenario(t, [], { reservationDelayMs: 110000 });
  await until(() => s.counts.reservationStarted === 1); await s.clock.advance(95000);
  assert.equal((await s.promise).status, 408); assert.equal(s.counts.provider, 0);
  await s.clock.advance(15000); assert.equal(s.counts.reserves, 1); assert.equal(s.counts.provider, 0);
  assert.equal(s.row.state, "no-model"); assert.equal(s.row.charged_usd, 0); s.assertPrivate();
});

test("Preview diagnostics allow only fixed timeout reasons and safe numeric timing", t => {
  const oldEnv = process.env.VERCEL_ENV, oldNode = process.env.NODE_ENV, logs = [];
  t.mock.method(console, "info", (...args) => logs.push(args));
  const { logInterpretationDiagnostic } = createModuleLoader()("lib/server/aurora-interpretation-service.ts");
  try {
    process.env.NODE_ENV = "production"; process.env.VERCEL_ENV = "preview";
    const metadata = { attempt: 1, outcome: "cancelled", finishReason: "unknown", expectedRibbons: 5,
      abortSource: "attempt-timeout", elapsedMs: 45800, attemptElapsedMs: 45000, attemptTimeoutMs: 45000, totalTimeoutMs: 95000,
      apiKey: "PRIVATE_KEY_MARKER", prompt: "PRIVATE_PROMPT_MARKER", approvedText: "PRIVATE_TEXT_MARKER", stack: "PRIVATE_STACK_MARKER", headers: { cookie: "PRIVATE_COOKIE_MARKER" } };
    logInterpretationDiagnostic(metadata); assert.equal(logs.length, 1);
    assert.equal(logs[0][1].abortSource, "attempt-timeout"); assert.equal(logs[0][1].elapsedMs, 45800);
    assert.equal(JSON.stringify(logs).includes("PRIVATE_"), false);
    logInterpretationDiagnostic({ ...metadata, abortSource: "PRIVATE_REASON_MARKER", elapsedMs: Infinity, attemptElapsedMs: -1 });
    assert.ok(!Object.hasOwn(logs[1][1], "abortSource")); assert.ok(!Object.hasOwn(logs[1][1], "elapsedMs"));
    for (const env of ["production", "development", ""]) { process.env.VERCEL_ENV = env; logInterpretationDiagnostic(metadata); }
    assert.equal(logs.length, 2);
    process.env.VERCEL_ENV = "preview"; logInterpretationDiagnostic({ ...metadata, outcome: "success" });
    assert.equal(logs.length, 3);
    process.env.VERCEL_ENV = "development"; process.env.NODE_ENV = "development"; logInterpretationDiagnostic(metadata);
    assert.equal(logs.length, 3);
  } finally {
    if (oldEnv === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = oldEnv;
    if (oldNode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldNode;
  }
});
test("failed diagnostic sink cannot alter cancellation handling or trigger another paid call", t => {
  const old = process.env.VERCEL_ENV; process.env.VERCEL_ENV = "preview";
  t.mock.method(console, "info", () => { throw new Error("PRIVATE_SINK_MARKER"); });
  const { logInterpretationDiagnostic } = createModuleLoader()("lib/server/aurora-interpretation-service.ts");
  try { assert.doesNotThrow(() => logInterpretationDiagnostic({ attempt: 1, outcome: "cancelled", finishReason: "unknown", expectedRibbons: 5 })); }
  finally { if (old === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = old; }
});
test("actual route adapter identifies the SDK timeout class without a real OpenAI call", async () => {
  const old = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = "mock-only";
  class MockOpenAI {
    static APIConnectionTimeoutError = MockSdkTimeout;
    chat = { completions: { create: async () => { throw new MockSdkTimeout("PRIVATE_SDK_DETAIL_MARKER"); } } };
  }
  const load = createModuleLoader({ openai: MockOpenAI, "../../../lib/server/security/api": {
    protectAI: (_feature, handler) => req => handler(req, { run: (_params, call) => call() }),
  } });
  try {
    const { POST } = load("app/api/aurora-interpretation/route.ts");
    const req = new Request("https://preview.example.invalid/api/aurora-interpretation", { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify(inputModule.buildAuroraInterpretationRequest(universeState())) });
    const response = await POST(req); assert.equal(response.status, 408);
    assert.equal((await response.json()).code, "INTERPRETATION_FAILED");
  } finally { if (old === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = old; }
});

for (const cancelled of [false, true]) test(`actual SDK adapter rechecks remaining time after DB authorization: cancelled=${cancelled}`, async t => {
  const clock = clockFor(t), timeouts = [], counts = { calls: 0, waiting: false };
  const controller = new AbortController();
  const deadlineModule = createModuleLoader()("lib/server/interpretation-deadline.ts");
  const deadline = new deadlineModule.InterpretationDeadline(controller.signal);
  t.after(() => deadline.dispose());
  const service = createModuleLoader({ "./interpretation-deadline": deadlineModule })("lib/server/aurora-interpretation-service.ts");
  let context;
  class MockOpenAI {
    constructor(options) { timeouts.push(options.timeout); assert.equal(options.maxRetries, 0); }
    chat = { completions: { create: async () => {
      counts.calls++;
      return { choices: [{ message: { content: output(context) }, finish_reason: "stop" }], usage: { prompt_tokens: 1000, completion_tokens: 2000, total_tokens: 3000 } };
    } } };
  }
  const permit = { run: async (_params, call) => {
    counts.waiting = true; await clock.delay(cancelled ? 75000 : 30000);
    return call();
  } };
  const load = createModuleLoader({ openai: MockOpenAI,
    "../../../lib/server/interpretation-deadline": deadlineModule,
    "../../../lib/server/security/api": { protectAI: (_feature, handler) => req => handler(req, permit, deadline) },
    "../../../lib/server/aurora-interpretation-service": { ...service, createAuroraInterpretationHandler: deps => service.createAuroraInterpretationHandler({
      ...deps, apiKey: () => "mock-only", diagnostic: () => {}, complete: options => { context = options.context; return deps.complete(options); },
    }) },
  });
  const { POST } = load("app/api/aurora-interpretation/route.ts");
  const promise = POST(new Request("https://preview.example.invalid/api/aurora-interpretation", { method: "POST",
    headers: { "content-type": "application/json" }, signal: controller.signal,
    body: JSON.stringify(inputModule.buildAuroraInterpretationRequest(universeState())) }));
  await until(() => counts.waiting);
  if (cancelled) { await clock.advance(10000); controller.abort(); await clock.advance(65000); }
  else await clock.advance(30000);
  assert.equal((await promise).status, cancelled ? 408 : 200);
  assert.deepEqual(timeouts, cancelled ? [] : [40000]);
  assert.equal(counts.calls, cancelled ? 0 : 1);
});

test("request stage diagnostics are Preview-only and never serialize request data", t => {
  const previous = process.env.VERCEL_ENV, logs = [];
  t.mock.method(console, "info", (...args) => logs.push(args));
  const { InterpretationDeadline } = createModuleLoader()("lib/server/interpretation-deadline.ts");
  const deadline = new InterpretationDeadline(new AbortController().signal);
  try {
    for (const env of ["production", "development", ""]) { process.env.VERCEL_ENV = env; deadline.stage("model"); }
    assert.equal(logs.length, 0);
    process.env.VERCEL_ENV = "preview"; deadline.stage("settlement");
    assert.equal(logs.length, 1);
    assert.deepEqual(Object.keys(logs[0][1]).sort(), ["stage", "abortSource", "elapsedMs", "remainingMs", "remainingWorkMs", "totalTimeoutMs", "workTimeoutMs"].sort());
  } finally { deadline.dispose(); if (previous === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = previous; }
});
