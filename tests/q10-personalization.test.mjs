import assert from "node:assert/strict";
import test from "node:test";
import { loadModule } from "./helpers/load-typescript.mjs";

const { createKeywordPools, createCustomKeyword, createSelectedCapsule, serializeSelections } = loadModule("lib/capsules.ts");
const { QUESTION_DATA } = loadModule("lib/question-data.ts");
const { generateQ10Recommendations, validateQ10Recommendations, recommendationFingerprint, normalizeRecommendationLabel } = loadModule("lib/q10-recommendations.ts");
const { createQuestionnaireState, questionnaireReducer } = loadModule("lib/questionnaire-state.ts");
const pools = createKeywordPools();

function inputFor(entries = []) {
  const input = { selections: QUESTION_DATA.map(() => []), responses: QUESTION_DATA.map(q => ({ questionId: q.id, status: "pending" })) };
  entries.forEach(([step, index], count) => {
    input.selections[step].push(createSelectedCapsule(pools[step][index], QUESTION_DATA[step].id, `selection-${count}`));
    input.responses[step].status = "answered";
  });
  return input;
}
function assertResult(input, result) {
  assert.equal(result.recommendations.length, 14);
  assert.equal(new Set(result.recommendations.map(k => k.id)).size, 14);
  assert.equal(new Set(result.recommendations.map(k => normalizeRecommendationLabel(k.label))).size, 14);
  assert.equal(validateQ10Recommendations(input, result.recommendations), true);
  assert.deepEqual(generateQ10Recommendations(input), result);
  const familyCounts = new Map();
  result.recommendations.forEach(k => {
    const family = k.semanticWeights[0]?.familyId ?? "unclassified";
    familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1);
    assert.ok(familyCounts.get(family) <= 3);
    assert.equal(k.questionId, "q10");
    assert.equal(k.source, "personalized");
    assert.equal(k.recommendation.basisFingerprint, result.basisFingerprint);
    k.recommendation.evidence.forEach(e => {
      const step = QUESTION_DATA.findIndex(q => q.id === e.questionId);
      assert.ok(input.selections[step].some(s => s.selectionId === e.selectionId && s.id === e.keywordId));
      assert.equal(e.answerIntent, QUESTION_DATA[step].answerIntent);
    });
  });
}
const countKind = (result, kind) => result.recommendations.filter(k => k.recommendation.kind === kind).length;

test("no answers: 14 common choices, no fabricated evidence and no auto-selected answer", () => {
  const input = inputFor();
  const result = generateQ10Recommendations(input);
  assertResult(input, result);
  assert.equal(result.generator, "local");
  assert.equal(countKind(result, "common"), 14);
  result.recommendations.forEach(k => assert.deepEqual(k.recommendation.evidence, []));
  assert.deepEqual(createQuestionnaireState().selections[9], []);
});

test("one selected keyword: personal evidence remains sparse and common choices increase", () => {
  const input = inputFor([[0, 0]]);
  const result = generateQ10Recommendations(input);
  assertResult(input, result);
  assert.equal(countKind(result, "direct"), 1);
  assert.equal(countKind(result, "expanded"), 1);
  assert.equal(countKind(result, "common"), 12);
});

test("diverse answers: six direct, five expanded and three common with traceable source IDs", () => {
  const input = inputFor([[0, 2], [1, 0], [3, 0], [4, 1], [5, 7], [5, 13]]);
  const result = generateQ10Recommendations(input);
  assertResult(input, result);
  assert.deepEqual(["direct", "expanded", "common"].map(kind => countKind(result, kind)), [6, 5, 3]);
  assert.equal(serializeSelections(input.selections)[9], "");
});

test("three expressions across two questions use the medium balance and more common choices", () => {
  const input = inputFor([[0, 2], [0, 3], [1, 0]]);
  const result = generateQ10Recommendations(input);
  assertResult(input, result);
  assert.equal(result.generator, "local");
  assert.deepEqual(["direct", "expanded", "common"].map(kind => countKind(result, kind)), [3, 3, 8]);
});

test("many answers in one meaning family increase common choices without failing generation", () => {
  const input = inputFor([[0, 0], [0, 4], [1, 0], [1, 4], [1, 7], [5, 11]]);
  const result = generateQ10Recommendations(input);
  assertResult(input, result);
  assert.equal(result.generator, "local");
  assert.deepEqual(["direct", "expanded", "common"].map(kind => countKind(result, kind)), [3, 0, 11]);
});

test("all 126 keywords selected: exactly 14 diverse candidates and repeatable ordering", () => {
  const input = inputFor(pools.slice(0, 9).flatMap((pool, step) => pool.map((_, index) => [step, index])));
  const result = generateQ10Recommendations(input);
  assertResult(input, result);
  assert.equal(result.generator, "local");
  assert.ok(new Set(result.recommendations.flatMap(k => k.recommendation.evidenceQuestionIds)).size >= 4);
  const reversed = { ...input, selections: input.selections.map(items => [...items].reverse()) };
  assert.deepEqual(generateQ10Recommendations(reversed), result);
});

test("100 repeated selections: no inflated confidence, one direct candidate, all evidence IDs retained", () => {
  const input = inputFor(Array.from({ length: 100 }, () => [0, 0]));
  const result = generateQ10Recommendations(input);
  assertResult(input, result);
  assert.equal(countKind(result, "direct"), 1);
  assert.equal(countKind(result, "common"), 12);
  assert.equal(result.recommendations.find(k => k.recommendation.kind === "direct").recommendation.evidenceSelectionIds.length, 100);
});

test("Q3/Q7/Q8/Q9 preserve atmosphere, wish, release and future intent in suggestions", () => {
  for (const [step, index, prefix, expansion] of [
    [2, 3, "지금의 풍경: 짙은 안개", "지금의 마음 풍경"],
    [6, 1, "바라는 마음: 따뜻한 위로", "마음을 알아주는 말"],
    [7, 1, "내려놓고 싶은 완벽주의", "부담을 조금 내려놓기"],
    [8, 1, "미래의 바람: 오래된 꿈 실현", "꿈을 향한 발걸음"],
  ]) {
    const input = inputFor([[step, index]]);
    const result = generateQ10Recommendations(input);
    assertResult(input, result);
    assert.equal(result.recommendations.find(k => k.recommendation.kind === "direct").label, prefix);
    assert.equal(result.recommendations.find(k => k.recommendation.kind === "expanded").label, expansion);
    assert.equal(result.recommendations.find(k => k.recommendation.kind === "direct").recommendation.evidence[0].answerIntent, QUESTION_DATA[step].answerIntent);
  }
});

test("all Q8 release targets: no positive-value expansion or unqualified release target", () => {
  const input = inputFor(pools[7].map((_, index) => [7, index]));
  const result = generateQ10Recommendations(input);
  assertResult(input, result);
  result.recommendations.filter(k => k.recommendation.kind === "direct").forEach(k => assert.ok(k.label.startsWith("내려놓고 싶은 ")));
  result.recommendations.filter(k => k.recommendation.kind === "expanded").forEach(k => assert.equal(k.label, "부담을 조금 내려놓기"));
  assert.ok(!result.recommendations.some(k => k.label === "완벽주의" || k.label === "모든 것을 통제하려는 마음"));
});

test("free input only: quote actual raw evidence without inventing unknown meanings or expansions", () => {
  const input = inputFor();
  input.selections[0].push(createSelectedCapsule(createCustomKeyword("q1", "  유리 너머의 작은 정원  ", "custom-garden"), "q1", "raw-selection"));
  input.responses[0].status = "answered";
  const result = generateQ10Recommendations(input);
  assertResult(input, result);
  const direct = result.recommendations.find(k => k.recommendation.kind === "direct");
  assert.equal(direct.label, "유리 너머의 작은 정원");
  assert.equal(direct.recommendation.evidence[0].originalText, "  유리 너머의 작은 정원  ");
  assert.equal(direct.recommendation.semanticStatus, "unclassified");
  assert.deepEqual(direct.semanticWeights, []);
  assert.equal(countKind(result, "expanded"), 0);
  assert.equal(countKind(result, "common"), 13);
});

test("custom text matching a preset inherits only that question's contextual meaning", () => {
  const input = inputFor();
  input.selections[7].push(createSelectedCapsule(createCustomKeyword("q8", "완벽주의", "custom-release"), "q8", "custom-id"));
  input.responses[7].status = "answered";
  const result = generateQ10Recommendations(input);
  assertResult(input, result);
  const direct = result.recommendations.find(k => k.recommendation.kind === "direct");
  assert.equal(direct.label, "내려놓고 싶은 완벽주의");
  assert.equal(direct.semanticWeights[0].familyId, "grounding");
  assert.equal(direct.recommendation.evidence[0].keywordId, "custom-release");
});

test("generation throw and malformed result both return the same deterministic 14-choice fallback", () => {
  const input = inputFor([[0, 0]]);
  const failed = generateQ10Recommendations(input, () => { throw new Error("Simulated failure"); });
  const invalid = generateQ10Recommendations(input, () => []);
  assert.deepEqual(failed, invalid);
  assert.equal(failed.generator, "fallback");
  assert.equal(failed.recommendations.length, 14);
  assert.equal(countKind(failed, "common"), 14);
  assert.equal(validateQ10Recommendations(input, failed.recommendations), true);
  failed.recommendations.forEach(k => assert.equal(k.recommendation.generator, "fallback"));
  assert.deepEqual(generateQ10Recommendations(input, () => Array.from({ length: 14 }, () => null)), failed);
  assert.equal(generateQ10Recommendations({ selections: [null], responses: [] }).generator, "fallback");
});

test("invalid free-input semantic data falls back without claiming personal evidence", () => {
  const input = inputFor();
  const custom = createSelectedCapsule(createCustomKeyword("q1", "새 원문", "bad-weights"), "q1", "bad-selection");
  custom.semanticWeights = [{ familyId: "not-a-family", role: "primary", weight: 1 }];
  input.selections[0].push(custom);
  const result = generateQ10Recommendations(input);
  assert.equal(result.generator, "fallback");
  assert.equal(countKind(result, "common"), 14);
});

test("output validator rejects duplicated choices and fabricated selection evidence", () => {
  const input = inputFor([[0, 0]]);
  const result = generateQ10Recommendations(input);
  const duplicated = [...result.recommendations]; duplicated[1] = duplicated[0];
  assert.equal(validateQ10Recommendations(input, duplicated), false);
  const fabricated = structuredClone(result.recommendations);
  fabricated[0].recommendation.evidence[0].selectionId = "never-selected";
  assert.equal(validateQ10Recommendations(input, fabricated), false);
});

test("output validator rejects repeated topics and family concentration, then falls back", () => {
  const input = inputFor();
  const result = generateQ10Recommendations(input);
  const repeatedTopic = structuredClone(result.recommendations);
  repeatedTopic[1].recommendation.topicKey = repeatedTopic[0].recommendation.topicKey;
  const concentrated = structuredClone(result.recommendations);
  concentrated.forEach(k => { k.semanticWeights = [{ familyId: "serenity", role: "primary", weight: 1 }]; });
  for (const malformed of [repeatedTopic, concentrated]) {
    assert.equal(validateQ10Recommendations(input, malformed), false);
    const fallback = generateQ10Recommendations(input, () => malformed);
    assert.equal(fallback.generator, "fallback");
    assert.equal(countKind(fallback, "common"), 14);
    assert.equal(validateQ10Recommendations(input, fallback.recommendations), true);
  }
});

test("Q10 supports duplicate choice/deletion, and its own edits never regenerate recommendations", () => {
  let state = createQuestionnaireState();
  const recommendations = state.personalization.recommendations;
  const keyword = recommendations[0];
  state = questionnaireReducer(state, { type: "select", step: 9, selection: createSelectedCapsule(keyword, "q10", "pick-1") });
  state = questionnaireReducer(state, { type: "select", step: 9, selection: createSelectedCapsule(keyword, "q10", "pick-2") });
  assert.equal(state.selections[9].length, 2);
  assert.equal(state.personalization.recommendations, recommendations);
  assert.notEqual(state.selections[9][0].recommendation, keyword.recommendation);
  state = questionnaireReducer(state, { type: "remove", step: 9, selectionId: "pick-1" });
  assert.equal(state.selections[9][0].selectionId, "pick-2");
  assert.equal(state.personalization.recommendations, recommendations);
});

test("upstream edits invalidate old recommended choices and reserved approval, but preserve authored originals", () => {
  let state = createQuestionnaireState();
  const oldKeyword = state.personalization.recommendations[0];
  state = questionnaireReducer(state, { type: "select", step: 9, selection: createSelectedCapsule(oldKeyword, "q10", "old-auto") });
  const raw = "  나는 내 속도를 믿고 싶어.\n조금 천천히 가도 괜찮아.  ";
  const manual = createSelectedCapsule(createCustomKeyword("q10", raw, "manual-sentence"), "q10", "manual-picked");
  state = questionnaireReducer(state, { type: "select", step: 9, selection: manual });
  const oldFingerprint = state.personalization.basisFingerprint;
  state = { ...state, personalization: { ...state.personalization, condensedSentence: "reserved draft", approvedSentence: "reserved approval" } };
  state = questionnaireReducer(state, { type: "select", step: 0, selection: createSelectedCapsule(pools[0][2], "q1", "new-upstream") });
  assert.notEqual(state.personalization.basisFingerprint, oldFingerprint);
  assert.deepEqual(state.selections[9].map(k => k.selectionId), ["manual-picked"]);
  assert.equal(state.selections[9][0], manual);
  assert.equal(state.selections[9][0].originalText, raw);
  assert.equal(state.personalization.condensedSentence, null);
  assert.equal(state.personalization.approvedSentence, null);
  assert.match(state.personalization.notice, /직접 남긴 말/);
  assert.equal(state.responses[9].status, "answered");
  const staleSelection = createSelectedCapsule(oldKeyword, "q10", "stale-pick");
  assert.equal(questionnaireReducer(state, { type: "select", step: 9, selection: staleSelection }), state);
});

test("deleting upstream evidence clears an exclusively recommended answer and sets Q10 pending", () => {
  let state = createQuestionnaireState();
  state = questionnaireReducer(state, { type: "select", step: 0, selection: createSelectedCapsule(pools[0][0], "q1", "upstream") });
  state = questionnaireReducer(state, { type: "select", step: 9, selection: createSelectedCapsule(state.personalization.recommendations[0], "q10", "auto") });
  state = questionnaireReducer(state, { type: "remove", step: 0, selectionId: "upstream" });
  assert.deepEqual(state.selections[9], []);
  assert.equal(state.responses[9].status, "pending");
  assert.equal(countKind(state.personalization, "common"), 14);
  const unchanged = questionnaireReducer(state, { type: "remove", step: 0, selectionId: "missing-id" });
  assert.equal(unchanged, state);
});

test("skip changes regenerate the snapshot once, while reset clears only by explicit action", () => {
  let state = createQuestionnaireState();
  const fingerprint = recommendationFingerprint(state);
  state = questionnaireReducer(state, { type: "skip", step: 0 });
  assert.notEqual(state.personalization.basisFingerprint, fingerprint);
  assert.equal(state.personalization.invalidationCount, 1);
  assert.equal(questionnaireReducer(state, { type: "skip", step: 0 }), state);
  assert.deepEqual(questionnaireReducer(state, { type: "reset" }), createQuestionnaireState());
});
