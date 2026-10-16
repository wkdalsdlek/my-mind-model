import assert from "node:assert/strict";
import test from "node:test";
import { loadModule, createModuleLoader } from "./helpers/load-typescript.mjs";

const { ANALYSIS_MODEL, ANALYSIS_REASONING_EFFORT, ANALYSIS_MAX_COMPLETION_TOKENS, ANALYSIS_MAX_ATTEMPTS, ANALYSIS_INPUT_LIMITS, ANALYSIS_RESPONSE_FORMAT,
  ANALYSIS_SYSTEM_PROMPT, parseAnalysisModelOutput, validateAnalysisInput, createAnalysisHandler, logAnalysisServerDiagnostic,
  estimateAnalysisStandardCostUsd } = loadModule("lib/server/analysis-service.ts");
const { QUESTIONS, QUESTION_DATA } = loadModule("lib/capsules.ts");
const { validateAuroraAnalysisResponse, AuroraAnalysisRequestController, prepareAuroraResult } = loadModule("lib/aurora-result.ts");
const { createQuestionnaireState, questionnaireReducer: reduce } = loadModule("lib/questionnaire-state.ts");
const ids = QUESTION_DATA.map(q => q.id);
const fixture = () => ({ analyses: Object.fromEntries(ids.map(id => [id, { questionId: id, analysis: `테스트 요약 ${id}`, detailedAnalysis: `테스트 상세 ${id}` }])) });
const input = () => ({ answers: ids.map(id => `테스트 답변 ${id}`), questions: [...QUESTIONS] });
const completion = (body = fixture(), extra = {}) => ({ content: JSON.stringify(body), finishReason: "stop", refused: false,
  usage: { promptTokens: 2100, completionTokens: 3900, totalTokens: 6000 }, ...extra });
const request = (body = input(), options = {}) => new Request("http://localhost/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), ...options });
function service(complete = async () => completion(), apiKey = () => "unit-test-only") {
  const calls = [], diagnostics = [];
  const handler = createAnalysisHandler({ apiKey, complete: async options => { calls.push(options); return complete(options); }, diagnostic: value => diagnostics.push(value) });
  return { handler, calls, diagnostics };
}
test("strict schema requires all ten ID-bound objects using only basic supported keywords", () => {
  assert.equal(ANALYSIS_MODEL, "gpt-6.1-sol");
  assert.equal(ANALYSIS_REASONING_EFFORT, "medium");
  assert.equal(ANALYSIS_MAX_COMPLETION_TOKENS, 25000);
  assert.equal(ANALYSIS_MAX_ATTEMPTS, 2);
  assert.equal(ANALYSIS_RESPONSE_FORMAT.type, "json_schema");
  assert.equal(ANALYSIS_RESPONSE_FORMAT.json_schema.strict, true);
  const schema = ANALYSIS_RESPONSE_FORMAT.json_schema.schema;
  assert.deepEqual(schema.properties.analyses.required, ids);
  function walk(node) {
    for (const key of Object.keys(node)) assert.ok(["type", "properties", "required", "additionalProperties", "enum"].includes(key), key);
    if (node.type === "object") {
      assert.equal(node.additionalProperties, false);
      assert.deepEqual(new Set(node.required), new Set(Object.keys(node.properties)));
      Object.values(node.properties).forEach(walk);
    }
  }
  walk(schema);
  for (const id of ids) assert.deepEqual(schema.properties.analyses.properties[id].properties.questionId.enum, [id]);
});
test("valid ten-entry output adapts to the old comments array in canonical question order", () => {
  const body = fixture(); body.analyses = Object.fromEntries(Object.entries(body.analyses).reverse());
  const comments = parseAnalysisModelOutput(JSON.stringify(body));
  assert.deepEqual(comments.map(c => c.questionId), ids);
  assert.equal(validateAuroraAnalysisResponse({ comments }).valid, true);
  assert.deepEqual(Object.keys(comments[0]), ["questionId", "analysis", "detailedAnalysis"]);
});
const corruptions = [
  ["five entries", b => { b.analyses = Object.fromEntries(Object.entries(b.analyses).slice(0, 5)); }, "ANALYSIS_COMMENTS_COUNT_MISMATCH"],
  ["missing question", b => { delete b.analyses.q10; }, "ANALYSIS_COMMENTS_COUNT_MISMATCH"],
  ["extra question", b => { b.analyses.q11 = b.analyses.q1; }, "ANALYSIS_COMMENTS_COUNT_MISMATCH"],
  ["duplicate ID", b => { b.analyses.q2.questionId = "q1"; }, "ANALYSIS_RESPONSE_INVALID"],
  ["unknown key with ten entries", b => { b.analyses.q11 = b.analyses.q10; delete b.analyses.q10; }, "ANALYSIS_RESPONSE_INVALID"],
  ["wrong ID", b => { b.analyses.q1.questionId = "q2"; }, "ANALYSIS_RESPONSE_INVALID"],
  ["empty summary", b => { b.analyses.q3.analysis = " \n "; }, "ANALYSIS_RESPONSE_INVALID"],
  ["empty detail", b => { b.analyses.q7.detailedAnalysis = ""; }, "ANALYSIS_RESPONSE_INVALID"],
  ["missing detail", b => { delete b.analyses.q8.detailedAnalysis; }, "ANALYSIS_RESPONSE_INVALID"],
  ["numeric summary", b => { b.analyses.q4.analysis = 3; }, "ANALYSIS_RESPONSE_INVALID"],
  ["null detail", b => { b.analyses.q5.detailedAnalysis = null; }, "ANALYSIS_RESPONSE_INVALID"],
  ["legacy visual fields", b => { b.title = "레거시 제목"; }, "ANALYSIS_RESPONSE_INVALID"],
];
for (const [name, corrupt, code] of corruptions) test(`${name} is never sent as HTTP 200 and retries at most once`, async () => {
  const body = fixture(); corrupt(body);
  assert.throws(() => parseAnalysisModelOutput(JSON.stringify(body)), error => error.code === code);
  const s = service(async () => completion(body));
  const response = await s.handler(request());
  assert.equal(response.status, 502);
  assert.equal((await response.json()).code, code);
  assert.equal(s.calls.length, 2);
  assert.deepEqual(s.calls.map(call => call.attempt), [1, 2]);
  assert.ok(s.calls[1].retryReason);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});
test("raw duplicate keys, including escaped aliases and repeated nested fields, are rejected", () => {
  for (const raw of [
    '{"analyses":{},"analyses":{}}',
    '{"analyses":{"q1":{},"q\\u0031":{}}}',
    '{"analyses":{"q1":{"analysis":"first","analysis":"second"}}}',
  ]) assert.throws(() => parseAnalysisModelOutput(raw), error => error.reason === "duplicate-key");
  const body = fixture(); body.analyses.q1.analysis = '문장 안의 {"analysis":"중복 아님"}';
  assert.equal(parseAnalysisModelOutput(JSON.stringify(body)).length, 10);
});
test("broken JSON and absent/oversized model content fail validation without logging content", async () => {
  for (const raw of ["not JSON", null, "x".repeat(ANALYSIS_INPUT_LIMITS.modelCharacters + 1)]) {
    const s = service(async () => completion(undefined, { content: raw }));
    const response = await s.handler(request());
    assert.equal(response.status, 502);
    assert.equal((await response.json()).code, "ANALYSIS_RESPONSE_INVALID");
    assert.equal(s.calls.length, 2);
  }
});
test("one recoverable invalid response regenerates the full map and returns one successful result", async () => {
  const partial = fixture(); delete partial.analyses.q10;
  const s = service(async ({ attempt }) => completion(attempt === 1 ? partial : fixture()));
  const response = await s.handler(request());
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.comments.length, 10);
  assert.deepEqual(result.comments.map(c => c.questionId), ids);
  assert.equal(s.calls.length, 2);
  assert.deepEqual(s.diagnostics.map(d => d.outcome), ["invalid-output", "success"]);
  assert.equal(s.diagnostics[0].receivedCount, 9);
  assert.equal(s.diagnostics[1].completionTokens, 3900);
});
for (const reason of ["length", "content_filter", "tool_calls", "function_call", null, "PRIVATE_REASON_MARKER"]) test(`finish reason ${reason === "PRIVATE_REASON_MARKER" ? "unknown" : reason} is rejected without an extra paid request`, async () => {
  const s = service(async () => completion(undefined, { finishReason: reason }));
  const response = await s.handler(request());
  assert.equal(response.status, 502);
  assert.equal((await response.json()).code, "ANALYSIS_RESPONSE_INVALID");
  assert.equal(s.calls.length, 1);
  assert.equal(s.diagnostics[0].validationReason, "output-interrupted");
  assert.equal(JSON.stringify(s.diagnostics).includes("PRIVATE_REASON_MARKER"), false);
});
test("model refusal and SDK/network failures are not automatically retried", async () => {
  const refusal = service(async () => completion(undefined, { refused: true }));
  assert.equal((await refusal.handler(request())).status, 502);
  assert.equal(refusal.calls.length, 1);
  assert.equal(refusal.diagnostics[0].validationReason, "model-refusal");
  for (const status of [undefined, 400, 404, 500, 429]) {
    const s = service(async () => { throw Object.assign(new Error("PRIVATE_SDK_MARKER"), { status }); });
    const response = await s.handler(request());
    assert.equal(response.status, status === 429 ? 429 : 502);
    assert.equal((await response.json()).code, "ANALYSIS_FAILED");
    assert.equal(s.diagnostics[0].providerStatus, status);
    assert.equal(s.calls.length, 1);
    assert.equal(JSON.stringify(s.diagnostics).includes("PRIVATE_SDK_MARKER"), false);
  }
});
test("missing API key returns 503 before any provider call", async () => {
  const s = service(undefined, () => undefined);
  const response = await s.handler(request());
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "AI_NOT_CONFIGURED");
  assert.equal(s.calls.length, 0);
});
test("input uses server-owned question contexts and preserves authored text/explicit skips", () => {
  const body = input(); body.answers[2] = "[사용자가 건너뛴 문항 — 선택한 키워드 없음]"; body.answers[9] = "  승인한 문장\n원문  ";
  const original = structuredClone(body), result = validateAnalysisInput(body);
  assert.equal(result.questions[2].status, "skipped");
  assert.equal(result.questions[2].answerIntent, "currentAtmosphere");
  assert.equal(result.questions[9].answer, body.answers[9]);
  assert.deepEqual(body, original);
  for (const index of [6, 7, 8]) assert.equal(result.questions[index].answerIntent, QUESTION_DATA[index].answerIntent);
  body.answers[9] = "[사용자가 건너뛴 문항 — 선택한 키워드 없음]";
  assert.equal(validateAnalysisInput(body).questions[9].status, "provided"); // Q10 authored text is never inferred to be a skip.
});
test("invalid requests never consume a model call", async () => {
  for (const body of [{}, { ...input(), answers: ["only one"] }, { ...input(), questions: Array(10).fill("client instruction") },
    { ...input(), answers: Array(10).fill(5) }, { ...input(), answers: Array(10).fill("") },
    { ...input(), answers: Array(10).fill("x".repeat(6001)) }]) {
    const s = service();
    assert.equal((await s.handler(request(body))).status, 400);
    assert.equal(s.calls.length, 0);
  }
  const s = service();
  assert.equal((await s.handler(request(undefined, { headers: { "Content-Type": "text/plain" } }))).status, 415);
  assert.equal((await s.handler(request(undefined, { body: "bad JSON" }))).status, 400);
  assert.equal((await s.handler(request(undefined, { headers: { "Content-Type": "application/json", "Content-Length": "999999" } }))).status, 400);
  assert.equal(s.calls.length, 0);
});
test("abort before generation and during the first attempt suppresses retry", async () => {
  const before = new AbortController(); before.abort();
  const first = service(); assert.equal((await first.handler(request(undefined, { signal: before.signal }))).status, 408); assert.equal(first.calls.length, 0);
  const active = new AbortController();
  const second = service(async () => { active.abort(); return completion({ analyses: {} }); });
  assert.equal((await second.handler(request(undefined, { signal: active.signal }))).status, 408);
  assert.equal(second.calls.length, 1);
});
test("safe diagnostics expose finish reason, usage and count only in development", () => {
  const previous = process.env.NODE_ENV, info = console.info, captured = [];
  try {
    console.info = (...args) => captured.push(args);
    process.env.NODE_ENV = "development";
    logAnalysisServerDiagnostic({ attempt: 1, outcome: "invalid-output", finishReason: "stop", code: "ANALYSIS_COMMENTS_COUNT_MISMATCH",
      expectedCount: 10, receivedCount: 5, promptTokens: 2000, completionTokens: 3000, totalTokens: 5000,
      apiKey: "PRIVATE_KEY_MARKER", content: "PRIVATE_ANALYSIS_MARKER", answers: ["PRIVATE_ANSWER_MARKER"], error: new Error("PRIVATE_ERROR_MARKER") });
    assert.equal(captured.length, 1);
    assert.equal(captured[0][1].receivedCount, 5);
    assert.equal(JSON.stringify(captured).includes("PRIVATE_"), false);
    process.env.NODE_ENV = "production";
    logAnalysisServerDiagnostic({ attempt: 1, outcome: "success", finishReason: "stop", expectedCount: 10 });
    assert.equal(captured.length, 1);
  } finally { console.info = info; if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
});
test("prompt binds actual answers to their intent, forbids unsupported psychological certainty and omits visual generation", () => {
  for (const phrase of ["실제로 남긴 답변", "무의식적 특성", "사실처럼 단정하지", "Q3", "Q7", "Q8", "Q9", "Q10", "skipped", "지시", "새 제목은 생성하지"]) assert.ok(ANALYSIS_SYSTEM_PROMPT.includes(phrase));
});
test("actual route SDK configuration uses strict schema, bounded output and no hidden SDK retry/logging", async () => {
  const sdkCalls = [], sdkOptions = [];
  class MockOpenAI {
    constructor(options) { sdkOptions.push(options); this.chat = { completions: { create: async (params, requestOptions) => {
      sdkCalls.push({ params, requestOptions });
      return { choices: [{ finish_reason: "stop", message: { content: JSON.stringify(fixture()), refusal: null } }],
        usage: { prompt_tokens: 100, completion_tokens: 300, total_tokens: 400,
          completion_tokens_details: { reasoning_tokens: 200 }, prompt_tokens_details: { cached_tokens: 50 } } };
    } } }; }
  }
  const old = process.env.OPENAI_API_KEY, oldEnvironment = process.env.NODE_ENV, info = console.info, diagnostics = [];
  try {
    process.env.OPENAI_API_KEY = "unit-test-only";
    process.env.NODE_ENV = "development";
    console.info = (...args) => diagnostics.push(args[1]);
    const loader = createModuleLoader({ openai: MockOpenAI, "../../../lib/server/security/api": { protectAI: (_feature, handler) => req => handler(req, { run: (_params, call) => call() }) } });
    const route = loader("app/api/analyze/route.ts");
    const response = await route.POST(request());
    assert.equal(response.status, 200);
    assert.equal(sdkOptions[0].maxRetries, 0); assert.equal(sdkOptions[0].logLevel, "off"); assert.equal(sdkOptions[0].timeout, 45000);
    assert.equal(sdkCalls[0].params.model, ANALYSIS_MODEL);
    assert.equal(sdkCalls[0].params.reasoning_effort, "medium");
    for (const unsupported of ["temperature", "top_p", "logprobs", "top_logprobs", "max_tokens", "tools", "tool_choice"]) {
      assert.equal(Object.hasOwn(sdkCalls[0].params, unsupported), false, unsupported);
    }
    assert.equal(sdkCalls[0].params.max_completion_tokens, ANALYSIS_MAX_COMPLETION_TOKENS);
    assert.equal(sdkCalls[0].params.service_tier, "default");
    assert.equal(sdkCalls[0].params.store, false);
    assert.deepEqual(sdkCalls[0].params.response_format, ANALYSIS_RESPONSE_FORMAT);
    assert.deepEqual(JSON.parse(sdkCalls[0].params.messages.at(-1).content), validateAnalysisInput(input()));
    assert.ok(sdkCalls[0].requestOptions.signal instanceof AbortSignal);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].reasoningTokens, 200);
    assert.equal(diagnostics[0].cachedPromptTokens, 50);
    assert.equal(diagnostics[0].estimatedStandardCostUsd, 0.003105);
    assert.equal(diagnostics[0].model, "gpt-6.1-sol");
    assert.equal(diagnostics[0].reasoningEffort, "medium");
    assert.equal(diagnostics[0].maxCompletionTokens, 25000);
    assert.equal(JSON.stringify(diagnostics).includes("unit-test-only"), false);
    assert.equal(JSON.stringify(diagnostics).includes("테스트 답변"), false);
    assert.equal(JSON.stringify(diagnostics).includes("테스트 요약"), false);
  } finally {
    console.info = info;
    if (old === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = old;
    if (oldEnvironment === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldEnvironment;
  }
});
test("cost estimate charges total completion tokens once, including reasoning, with optional cache hits", () => {
  assert.equal(estimateAnalysisStandardCostUsd({ promptTokens: 2000, completionTokens: 4000, reasoningTokens: 2000 }), 0.044);
  assert.equal(estimateAnalysisStandardCostUsd({ promptTokens: 2000, completionTokens: 4000, cachedPromptTokens: 1000, reasoningTokens: 2000 }), 0.0421);
  assert.equal(estimateAnalysisStandardCostUsd({ promptTokens: 0, completionTokens: 0 }), 0);
  assert.equal(estimateAnalysisStandardCostUsd({ promptTokens: 2000, completionTokens: 25000 }), 0.254);
});
test("missing or malformed usage never produces a fabricated cost estimate", () => {
  for (const usage of [{}, { promptTokens: 100 }, { completionTokens: 100 },
    { promptTokens: -1, completionTokens: 100 }, { promptTokens: 10.5, completionTokens: 100 },
    { promptTokens: 100, completionTokens: NaN }, { promptTokens: Infinity, completionTokens: 100 },
    { promptTokens: "PRIVATE_USAGE_MARKER", completionTokens: 100 },
    { promptTokens: 100, completionTokens: 100, cachedPromptTokens: 101 },
    { promptTokens: 100, completionTokens: 100, cachedPromptTokens: null },
    { promptTokens: 100, completionTokens: 100, cachedPromptTokens: -1 }]) {
    assert.equal(estimateAnalysisStandardCostUsd(usage), undefined);
  }
});
test("exhausting the budget during reasoning rejects empty output without a second paid attempt", async () => {
  const s = service(async () => completion(undefined, { content: null, finishReason: "length",
    usage: { promptTokens: 2000, completionTokens: 25000, totalTokens: 27000, reasoningTokens: 25000, cachedPromptTokens: 0 } }));
  const response = await s.handler(request());
  assert.equal(response.status, 502);
  assert.equal((await response.json()).code, "ANALYSIS_RESPONSE_INVALID");
  assert.equal(s.calls.length, 1);
  assert.equal(s.diagnostics[0].validationReason, "output-interrupted");
  assert.equal(s.diagnostics[0].reasoningTokens, 25000);
  assert.equal(s.diagnostics[0].completionTokens, 25000);
});
test("usage availability does not replace complete stop/refusal/content validation", async () => {
  const valid = service(async () => completion(undefined, { usage: undefined }));
  const result = await valid.handler(request());
  assert.equal(result.status, 200);
  assert.equal((await result.json()).comments.length, 10);
  assert.equal(valid.diagnostics[0].reasoningTokens, undefined);
  const empty = service(async () => completion(undefined, { content: null, usage: { reasoningTokens: 5000 } }));
  assert.equal((await empty.handler(request())).status, 502);
  assert.equal(empty.calls.length, 2); // Existing stop + invalid JSON policy, never invented analyses.
});
test("reasoning and cost diagnostics are sanitized and remain development-only", () => {
  const old = process.env.NODE_ENV, info = console.info, logs = [];
  try {
    console.info = (...args) => logs.push(args[1]);
    process.env.NODE_ENV = "development";
    logAnalysisServerDiagnostic({ attempt: 1, outcome: "success", finishReason: "stop", expectedCount: 10,
      promptTokens: 100, completionTokens: 300, reasoningTokens: "PRIVATE_REASONING_MARKER", cachedPromptTokens: -1,
      estimatedStandardCostUsd: "PRIVATE_COST_MARKER", reasoning: "PRIVATE_CHAIN_MARKER", model: "PRIVATE_MODEL_MARKER" });
    assert.equal(logs[0].reasoningTokens, undefined);
    assert.equal(logs[0].cachedPromptTokens, undefined);
    assert.equal(logs[0].estimatedStandardCostUsd, undefined);
    assert.equal(JSON.stringify(logs).includes("PRIVATE_"), false);
    process.env.NODE_ENV = "production";
    logAnalysisServerDiagnostic({ attempt: 1, outcome: "success", finishReason: "stop", expectedCount: 10,
      promptTokens: 100, completionTokens: 300, reasoningTokens: 200, cachedPromptTokens: 0 });
    assert.equal(logs.length, 1);
  } finally { console.info = info; if (old === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = old; }
});
test("actual route keeps the requested model, reasoning and shared token budget on its one regeneration", async () => {
  const calls = [];
  class MockOpenAI {
    constructor(options) {
      assert.equal(options.maxRetries, 0);
      this.chat = { completions: { create: async params => {
        calls.push(params);
        const body = fixture();
        if (calls.length === 1) delete body.analyses.q10;
        return { choices: [{ finish_reason: "stop", message: { content: JSON.stringify(body), refusal: null } }] };
      } } };
    }
  }
  const oldKey = process.env.OPENAI_API_KEY, oldEnvironment = process.env.NODE_ENV;
  try {
    process.env.OPENAI_API_KEY = "unit-test-only";
    process.env.NODE_ENV = "production";
    const route = createModuleLoader({ openai: MockOpenAI, "../../../lib/server/security/api": { protectAI: (_feature, handler) => req => handler(req, { run: (_params, call) => call() }) } })("app/api/analyze/route.ts");
    const response = await route.POST(request());
    assert.equal(response.status, 200);
    assert.equal((await response.json()).comments.length, 10);
    assert.equal(calls.length, 2);
    for (const params of calls) {
      assert.equal(params.model, "gpt-6.1-sol");
      assert.equal(params.reasoning_effort, "medium");
      assert.equal(params.max_completion_tokens, 25000);
      assert.equal(Object.hasOwn(params, "temperature"), false);
      assert.deepEqual(params.response_format, ANALYSIS_RESPONSE_FORMAT);
    }
    assert.ok(calls[1].messages[1].content.includes("comments-count-mismatch"));
  } finally {
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey;
    if (oldEnvironment === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldEnvironment;
  }
});
test("real server handler and client controller interoperate on final failure and manual retry without losing Q10", async () => {
  let state = createQuestionnaireState();
  for (let step = 0; step < 9; step++) state = reduce(state, { type: "skip", step });
  state = reduce(state, { type: "closing-input", field: "authoredText", text: "서버 연결 검증용 승인 문장" });
  state = reduce(state, { type: "closing-approve", direct: true, approvedAt: "2026-10-15T00:00:00.000Z" });
  const original = structuredClone(state), prepared = prepareAuroraResult(state);
  assert.equal(prepared.ready, true);
  let attempt = 0;
  const partial = fixture(); partial.analyses = Object.fromEntries(Object.entries(partial.analyses).slice(0, 5));
  const s = service(async () => completion(++attempt <= 2 ? partial : fixture()));
  const client = new AuroraAnalysisRequestController(async (_url, options) => s.handler(new Request("http://localhost/api/analyze", options)));
  const errors = [], results = [];
  const hooks = { isCurrent: () => true, start: () => {}, settled: () => {}, failure: (code, diagnostic) => errors.push({ code, diagnostic }), success: result => results.push(result) };
  await client.analyze(prepared.snapshot, hooks);
  assert.equal(results.length, 0); assert.equal(client.busy, false);
  assert.equal(errors[0].code, "ANALYSIS_COMMENTS_COUNT_MISMATCH");
  assert.equal(errors[0].diagnostic.httpStatus, 502); assert.equal(errors[0].diagnostic.receivedCount, 5);
  assert.deepEqual(state, original);
  await client.analyze(prepared.snapshot, hooks);
  assert.equal(results.length, 1); assert.equal(results[0].snapshot, prepared.snapshot);
  assert.equal(results[0].comments.length, 10); assert.equal(s.calls.length, 3);
});
