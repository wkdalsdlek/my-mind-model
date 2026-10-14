import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInThisContext } from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadModule, createModuleLoader } from "./helpers/load-typescript.mjs";

const { prepareAuroraResult, readAuroraAnalysisComments, validateAuroraAnalysisResponse, logAuroraAnalysisDiagnostic,
  auroraAnalysisFailureMessage, AuroraAnalysisRequestController } = loadModule("lib/aurora-result.ts");
const { personalizeAuroraFromQuestionnaire } = loadModule("lib/aurora-personalization.ts");
const { createQuestionnaireState, questionnaireReducer: reduce, getApprovedClosingMessage } = loadModule("lib/questionnaire-state.ts");
const { createKeywordPools, createSelectedCapsule } = loadModule("lib/capsules.ts");
const { validateAuroraAppearance } = loadModule("lib/aurora-types.ts");
const { QUESTION_DATA, QUESTIONS } = loadModule("lib/capsules.ts");
const pools = createKeywordPools();
const title = "내 속도로\n천천히 걸어가는 오늘";
function complete(text = title) {
  let state = createQuestionnaireState();
  for (let step = 0; step < 9; step++) state = reduce(state, { type: "skip", step });
  state = reduce(state, { type: "closing-input", field: "authoredText", text });
  return reduce(state, { type: "closing-approve", direct: true, approvedAt: "2026-10-15T00:00:00.000Z" });
}
const choose = (state, step, number) => reduce(state, { type: "select", step, selection: createSelectedCapsule(pools[step][number - 1], QUESTION_DATA[step].id, `pick-${step}-${number}`) });
const approve = state => reduce(state, { type: "closing-approve", direct: true, approvedAt: "2026-10-15T00:00:00.000Z" });
const snapshot = state => { const prepared = prepareAuroraResult(state); assert.equal(prepared.ready, true); return prepared.snapshot; };
const payload = () => ({ title: "레거시 AI 제목 날씨: 맑음", colors: ["#FFFFFF", "#FFFFFF", "#FFFFFF"], speed: 8, distort: 1.2, scale: 1.2,
  comments: Array.from({ length: 10 }, (_, i) => ({ analysis: `요약 ${i + 1}`, detailedAnalysis: `상세 ${i + 1}`, effect: "레거시 시각 효과" })) });
const response = (body = payload(), status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function callbacks(isCurrent = () => true) {
  const events = [], results = [], diagnostics = [];
  return { events, results, diagnostics, hooks: { isCurrent, start: () => events.push("start"), success: result => { events.push("success"); results.push(result); },
    failure: (code, diagnostic) => { events.push(code); diagnostics.push(diagnostic); }, settled: () => events.push("settled") } };
}

test("result preparation blocks unapproved and outdated titles at Q10", () => {
  assert.deepEqual(prepareAuroraResult(createQuestionnaireState()), { ready: false, step: 9 });
  const state = complete();
  const stale = structuredClone(state);
  stale.closing.authoredText += " 변경";
  assert.deepEqual(prepareAuroraResult(stale), { ready: false, step: 9 });
  assert.deepEqual(prepareAuroraResult(reduce(state, { type: "closing-edit", text: "승인 전 수정" })), { ready: false, step: 9 });
});
test("an approved closing message still requires every earlier question answered or explicitly skipped", () => {
  let state = createQuestionnaireState();
  state = reduce(state, { type: "closing-input", field: "authoredText", text: title });
  state = approve(state);
  assert.deepEqual(prepareAuroraResult(state), { ready: false, step: 0 });
});
test("complete snapshot uses unchanged 5-A appearance, approved title and original legacy answer transport", () => {
  const state = complete(), before = structuredClone(state), prepared = snapshot(state);
  assert.deepEqual(prepared.personalization, personalizeAuroraFromQuestionnaire(state));
  assert.equal(prepared.personalization.approvedTitle.text, title);
  assert.equal(prepared.answers[9], title);
  assert.ok(prepared.answers.slice(0, 9).every(a => a.includes("건너뛴")));
  assert.deepEqual(validateAuroraAppearance(prepared.personalization.appearance), []);
  assert.deepEqual(state, before);
});
test("real core answers change appearance while Q3/Q7/Q8/Q9 preserve core color and motion", () => {
  const base = complete();
  const drive = snapshot(approve(choose(base, 0, 12)));
  const expression = snapshot(approve(choose(base, 0, 3)));
  assert.notDeepEqual(drive.personalization.appearance.palette, expression.personalization.appearance.palette);
  assert.notDeepEqual(drive.personalization.appearance.motion, expression.personalization.appearance.motion);
  assert.equal(drive.personalization.appearance.ribbonCount, 2);
  assert.equal(expression.personalization.appearance.ribbonCount, 3);
  let state = base;
  for (const step of [2, 6, 7, 8]) state = choose(state, step, 1);
  assert.deepEqual(snapshot(approve(state)).personalization.appearance, snapshot(base).personalization.appearance);
});
test("analysis boundary ignores all legacy title, visual parameters and effect prose", () => {
  const comments = readAuroraAnalysisComments(payload());
  assert.equal(comments.length, 10);
  assert.deepEqual(comments[0], { analysis: "요약 1", detailedAnalysis: "상세 1" });
  assert.equal(JSON.stringify(comments).includes("레거시"), false);
});
test("provided question IDs must match the canonical comment order without duplicates", () => {
  const body = payload();
  body.comments.forEach((comment, i) => { comment.questionId = QUESTION_DATA[i].id; });
  assert.equal(validateAuroraAnalysisResponse(body).valid, true);
  body.comments[1].questionId = "q1";
  assert.equal(validateAuroraAnalysisResponse(body).diagnostic.reason, "question-id-mismatch");
  body.comments[1].questionId = "unknown";
  assert.equal(validateAuroraAnalysisResponse(body).valid, false);
});
test("invalid or incomplete successful API data is not accepted as real analysis", () => {
  for (const value of [null, {}, { comments: [] }, { comments: [{}] }, { comments: Array(10).fill({ analysis: " " }) },
    { comments: Array(10).fill({ analysis: 3 }) }]) assert.equal(readAuroraAnalysisComments(value), null);
  const detailedOnly = readAuroraAnalysisComments({ comments: Array(10).fill({ detailedAnalysis: "상세만 존재" }) });
  assert.equal(detailedOnly[0].analysis, "");
});
test("reproduction: HTTP 200 with five comments stops at response validation before result transition", async () => {
  const state = complete(), before = structuredClone(state), prepared = snapshot(state);
  const incomplete = payload();
  incomplete.comments = incomplete.comments.slice(0, 5);
  assert.deepEqual(validateAuroraAppearance(prepared.personalization.appearance), []);
  assert.equal(readAuroraAnalysisComments(incomplete), null);
  const observed = callbacks();
  const request = new AuroraAnalysisRequestController(async () => response(incomplete, 200));
  await request.analyze(prepared, observed.hooks);
  assert.deepEqual(observed.events, ["start", "ANALYSIS_COMMENTS_COUNT_MISMATCH", "settled"]);
  assert.deepEqual(observed.diagnostics, [{ stage: "response-validation", code: "ANALYSIS_COMMENTS_COUNT_MISMATCH",
    reason: "comments-count-mismatch", expectedCount: 10, receivedCount: 5, httpStatus: 200 }]);
  assert.equal(observed.results.length, 0);
  assert.equal(request.busy, false);
  assert.deepEqual(state, before);
  assert.ok(getApprovedClosingMessage(state));
});
test("five-comment rejection keeps the same snapshot and succeeds only after a complete manual retry", async () => {
  const state = complete(), original = structuredClone(state), prepared = snapshot(state), observed = callbacks();
  let attempt = 0;
  const request = new AuroraAnalysisRequestController(async () => {
    const body = payload();
    if (!attempt++) body.comments = body.comments.slice(0, 5);
    return response(body);
  });
  await request.analyze(prepared, observed.hooks);
  assert.equal(attempt, 1); // No automatic paid retry.
  assert.equal(observed.results.length, 0);
  assert.equal(request.busy, false);
  assert.deepEqual(state, original);
  await request.analyze(prepared, observed.hooks);
  assert.equal(attempt, 2);
  assert.equal(observed.results[0].snapshot, prepared);
  assert.equal(observed.results[0].comments.length, 10);
});
test("response metadata distinguishes missing arrays, wrong count and an empty comment", () => {
  for (const count of [0, 5, 9, 11]) {
    const body = { comments: Array.from({ length: count }, () => ({ analysis: "synthetic" })) };
    assert.deepEqual(validateAuroraAnalysisResponse(body), { valid: false, diagnostic: {
      stage: "response-validation", code: "ANALYSIS_COMMENTS_COUNT_MISMATCH", reason: "comments-count-mismatch", expectedCount: 10, receivedCount: count,
    } });
  }
  assert.equal(validateAuroraAnalysisResponse({ comments: "PRIVATE_RAW_MARKER" }).diagnostic.reason, "comments-not-array");
  const body = payload(); body.comments[3] = {};
  const diagnostic = validateAuroraAnalysisResponse(body).diagnostic;
  assert.equal(diagnostic.reason, "empty-comment"); assert.equal(diagnostic.commentNumber, 4);
  body.comments[3] = null;
  assert.equal(validateAuroraAnalysisResponse(body).diagnostic.reason, "invalid-comment");
});
test("the retry message states actual count and explicitly preserves answers and approval", () => {
  const message = auroraAnalysisFailureMessage("ANALYSIS_COMMENTS_COUNT_MISMATCH", { stage: "response-validation",
    code: "ANALYSIS_COMMENTS_COUNT_MISMATCH", expectedCount: 10, receivedCount: 5 });
  for (const phrase of ["검증 오류", "10개", "5개", "승인한 문장", "오로라 만나기"]) assert.ok(message.includes(phrase));
});
test("snapshot exceptions and invalid appearance get a snapshot error without discarding questionnaire state", () => {
  for (const faulty of [() => { throw new Error("PRIVATE_SOURCE_MARKER"); }, () => ({ approvedTitle: { text: title }, appearance: { palette: [] } })]) {
    const loader = createModuleLoader({ "./aurora-personalization": { personalizeAuroraFromQuestionnaire: faulty } });
    const state = complete(), original = structuredClone(state);
    const prepared = loader("lib/aurora-result.ts").prepareAuroraResult(state);
    assert.deepEqual(prepared, { ready: false, step: 9, failure: { stage: "snapshot", code: "PERSONALIZATION_FAILED" } });
    assert.deepEqual(state, original);
    assert.equal(JSON.stringify(prepared).includes("PRIVATE_SOURCE_MARKER"), false);
  }
});
test("a synchronous result transition exception is never misreported as a network failure", async () => {
  const observed = callbacks();
  observed.hooks.success = () => { throw new Error("PRIVATE_UI_MARKER"); };
  const request = new AuroraAnalysisRequestController(async () => response());
  await request.analyze(snapshot(complete()), observed.hooks);
  assert.deepEqual(observed.events, ["start", "RESULT_TRANSITION_FAILED", "settled"]);
  assert.deepEqual(observed.diagnostics, [{ stage: "result-transition", code: "RESULT_TRANSITION_FAILED" }]);
  assert.equal(request.busy, false);
});
test("development logging contains only allowlisted scalar metadata; production logs nothing", () => {
  const previousEnvironment = process.env.NODE_ENV, previousWarn = console.warn, logged = [];
  try {
    console.warn = (...args) => logged.push(args);
    const diagnostic = { stage: "response-validation", code: "ANALYSIS_COMMENTS_COUNT_MISMATCH", reason: "comments-count-mismatch",
      httpStatus: 200, expectedCount: 10, receivedCount: 5, answers: ["PRIVATE_ANSWER_MARKER"], apiKey: "PRIVATE_KEY_MARKER",
      error: new Error("PRIVATE_ERROR_MARKER"), inputFingerprint: "PRIVATE_FINGERPRINT_MARKER" };
    process.env.NODE_ENV = "development";
    logAuroraAnalysisDiagnostic(diagnostic);
    assert.deepEqual(logged, [["[aurora-analysis]", { stage: "response-validation", code: "ANALYSIS_COMMENTS_COUNT_MISMATCH",
      httpStatus: 200, expectedCount: 10, receivedCount: 5, reason: "comments-count-mismatch" }]]);
    assert.equal(JSON.stringify(logged).includes("PRIVATE_"), false);
    logAuroraAnalysisDiagnostic({ ...diagnostic, stage: "PRIVATE_STAGE_MARKER" });
    assert.equal(logged.length, 1);
    process.env.NODE_ENV = "production";
    logAuroraAnalysisDiagnostic(diagnostic);
    assert.equal(logged.length, 1);
  } finally {
    console.warn = previousWarn;
    if (previousEnvironment === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousEnvironment;
  }
});
test("successful request preserves snapshot and sends only the existing API answers/questions contract", async () => {
  let sent;
  const request = new AuroraAnalysisRequestController(async (url, options) => { sent = { url, options }; return response(); });
  const state = complete(), prepared = snapshot(state), observed = callbacks();
  await request.analyze(prepared, observed.hooks);
  assert.deepEqual(observed.events, ["start", "success", "settled"]);
  assert.equal(observed.results[0].snapshot, prepared);
  assert.equal(observed.results[0].snapshot.personalization.approvedTitle.text, title);
  assert.deepEqual(observed.results[0].snapshot.personalization.appearance, snapshot(state).personalization.appearance);
  assert.equal(sent.url, "/api/analyze");
  assert.equal(sent.options.method, "POST");
  assert.deepEqual(JSON.parse(sent.options.body), { answers: prepared.answers, questions: QUESTIONS });
  assert.equal(request.busy, false);
});
test("synchronous request lock prevents repeated clicks before React loading state commits", async () => {
  const pending = deferred(); let calls = 0;
  const request = new AuroraAnalysisRequestController(async () => { calls++; return pending.promise; });
  const observed = callbacks(), prepared = snapshot(complete());
  const first = request.analyze(prepared, observed.hooks);
  assert.equal(request.busy, true);
  assert.deepEqual(observed.events, ["start"]);
  await request.analyze(prepared, observed.hooks);
  assert.equal(calls, 1);
  pending.resolve(response()); await first;
  assert.deepEqual(observed.events, ["start", "success", "settled"]);
});
for (const [name, fetcher, expected] of [
  ["API not configured", async () => response({ code: "AI_NOT_CONFIGURED" }, 503), "AI_NOT_CONFIGURED"],
  ["server failure", async () => response({ code: "ANALYSIS_FAILED" }, 500), "ANALYSIS_FAILED"],
  ["malformed success", async () => response({ comments: [] }), "ANALYSIS_COMMENTS_COUNT_MISMATCH"],
  ["network failure", async () => { throw new Error("private transport detail"); }, "CONNECTION_FAILED"],
  ["broken JSON", async () => new Response("invalid JSON", { status: 200 }), "ANALYSIS_RESPONSE_INVALID"],
]) test(`${name} preserves responses and approval, unlocks and allows retry`, async () => {
  const state = complete(), original = structuredClone(state); let attempt = 0;
  const request = new AuroraAnalysisRequestController((...args) => attempt++ ? Promise.resolve(response()) : fetcher(...args));
  const observed = callbacks(), prepared = snapshot(state);
  await request.analyze(prepared, observed.hooks);
  assert.deepEqual(observed.events, ["start", expected, "settled"]);
  assert.equal(request.busy, false); assert.equal(observed.results.length, 0);
  assert.deepEqual(state, original); assert.ok(getApprovedClosingMessage(state));
  await request.analyze(prepared, observed.hooks);
  assert.equal(observed.results.length, 1);
});
test("input changes while response JSON is delayed prevent old results from opening", async () => {
  const parsed = deferred(); let current = true;
  const request = new AuroraAnalysisRequestController(async () => ({ ok: true, json: () => parsed.promise }));
  const observed = callbacks(() => current);
  const promise = request.analyze(snapshot(complete()), observed.hooks);
  await Promise.resolve(); current = false;
  parsed.resolve(payload()); await promise;
  assert.deepEqual(observed.events, ["start", "settled"]);
  assert.equal(observed.results.length, 0);
  assert.deepEqual(observed.diagnostics, []);
});
test("cancel/reset cannot let late old responses replace or unlock a newer session", async () => {
  const old = deferred(), recent = deferred(); let calls = 0, signal;
  const request = new AuroraAnalysisRequestController(async (_, options) => { signal ??= options.signal; return calls++ ? recent.promise : old.promise; });
  const first = callbacks(), second = callbacks(), prepared = snapshot(complete());
  const pending = request.analyze(prepared, first.hooks);
  request.cancel(); assert.equal(signal.aborted, true);
  assert.equal(request.busy, false);
  const next = request.analyze(snapshot(complete("새 세션의 문장")), second.hooks);
  old.resolve(response()); await pending;
  assert.equal(request.busy, true);
  assert.deepEqual(first.events, ["start", "settled"]);
  assert.deepEqual(second.events, ["start"]);
  recent.resolve(response()); await next;
  assert.equal(second.results[0].snapshot.personalization.approvedTitle.text, "새 세션의 문장");
});
test("unmount cancellation suppresses even settled callbacks and stale errors", async () => {
  const pending = deferred(), observed = callbacks();
  const request = new AuroraAnalysisRequestController(async () => pending.promise);
  const promise = request.analyze(snapshot(complete()), observed.hooks);
  request.cancel(false);
  pending.resolve(response({}, 500)); await promise;
  assert.deepEqual(observed.events, ["start"]);
});
test("a stale snapshot cannot start a server request", async () => {
  const request = new AuroraAnalysisRequestController(async () => { throw new Error("must not be called"); });
  const observed = callbacks(() => false);
  await request.analyze(snapshot(complete()), observed.hooks);
  assert.deepEqual(observed.events, []);
});
test("default browser fetch is invoked on globalThis instead of the controller instance", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = function () { assert.equal(this, globalThis); return Promise.resolve(response()); };
    const observed = callbacks();
    await new AuroraAnalysisRequestController().analyze(snapshot(complete()), observed.hooks);
    assert.deepEqual(observed.events, ["start", "success", "settled"]);
  } finally { globalThis.fetch = original; }
});

// Actual result JSX with only WebGL/browser hooks stubbed; no replacement app logic.
const nodeRequire = createRequire(import.meta.url);
let rendererProps;
const source = readFileSync(new URL("../components/result/AuroraResultScreen.tsx", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
  jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } });
const exports = {};
const externals = {
  react: React, "react/jsx-runtime": nodeRequire("react/jsx-runtime"),
  "@/components/aurora/GlassNebulaAurora": props => { rendererProps = props; return React.createElement("div", { "data-aurora-test": true }); },
  "@/components/aurora/useAuroraBrowserSignals": { useAuroraBrowserSignals: () => ({ reduced: false }) },
  "@/lib/question-data": { QUESTION_DATA }, "./AuroraResultScreen.module.css": {},
};
runInThisContext(`(function(require, exports) { ${outputText}\n})`)(id => { assert.ok(Object.hasOwn(externals, id), id); return externals[id]; }, exports);
function markup(state) { return renderToStaticMarkup(React.createElement(exports.default, { result: { snapshot: snapshot(state), comments: readAuroraAnalysisComments(payload()) }, onReset: () => {} })); }
test("real result JSX forwards only 5-A appearance and camera/quality props, not legacy or special effect values", () => {
  const state = approve(choose(complete(), 0, 3)), html = markup(state);
  assert.deepEqual(rendererProps.appearance, snapshot(state).personalization.appearance);
  assert.equal(rendererProps.quality, "balanced"); assert.equal(rendererProps.cameraMode, "front");
  for (const key of ["title", "colors", "speed", "distort", "atmosphere", "innerPulse", "releaseFragments", "outerExpansion"]) assert.equal(Object.hasOwn(rendererProps, key), false);
  assert.ok(html.includes(title));
  assert.equal(html.includes("날씨:"), false); assert.equal(html.includes("레거시"), false);
  for (const label of ["정면 감상", "자유 탐색", "느린 자동 공전", "정면으로 돌아오기", "다시 성찰하기", "요약 분석", "심층 분석"]) assert.ok(html.includes(label));
});
test("neutral visual fallback is explained as neutral light without claiming an inferred trait", () => {
  assert.ok(markup(complete()).includes("중립적인 빛"));
  const single = markup(approve(choose(complete(), 0, 12)));
  assert.ok(single.includes("중립적인 보조색"));
});
test("multiline and long approved titles are preserved and rendered safely as text", () => {
  const text = "<script>\n" + "내가 직접 남긴 긴 문장".repeat(60);
  const html = markup(complete(text));
  assert.ok(html.includes("&lt;script&gt;\n"));
  assert.ok(html.includes("내가 직접 남긴 긴 문장".repeat(60)));
  assert.equal(html.includes("<script>"), false);
});
