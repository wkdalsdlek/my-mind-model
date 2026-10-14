import assert from "node:assert/strict";
import test from "node:test";
import { loadModule } from "./helpers/load-typescript.mjs";

const { personalizeAurora: engine, personalizeAuroraFromQuestionnaire: fromState, auroraRepetitionMultiplier,
  AURORA_CORE_QUESTION_WEIGHTS, AURORA_ATMOSPHERE_BY_KEYWORD } = loadModule("lib/aurora-personalization.ts");
const { QUESTION_DATA } = loadModule("lib/question-data.ts");
const { createKeywordPools, createCustomKeyword, createSelectedCapsule } = loadModule("lib/capsules.ts");
const { createQuestionnaireState, questionnaireReducer: reduce } = loadModule("lib/questionnaire-state.ts");
const { buildClosingMessageInput, closingInputFingerprint } = loadModule("lib/closing-message.ts");
const { validateAuroraAppearance } = loadModule("lib/aurora-types.ts");
const { AURORA_PRESETS } = loadModule("lib/aurora-presets.ts");
const { generateQ10Recommendations } = loadModule("lib/q10-recommendations.ts");
const pools = createKeywordPools();
const copy = value => structuredClone(value);
const empty = () => ({ selections: QUESTION_DATA.map(() => []), responses: QUESTION_DATA.map(q => ({ questionId: q.id, status: "pending" })) });
function fixed(input, questionId, keywordNumber, selectionId = `${questionId}-${keywordNumber}`) {
  const index = QUESTION_DATA.findIndex(q => q.id === questionId);
  input.selections[index].push(createSelectedCapsule(pools[index][keywordNumber - 1], questionId, selectionId));
  input.responses[index].status = "answered";
  return input;
}
function custom(input, questionId, raw, selectionId = `custom-${questionId}`, keywordId = `custom-key-${selectionId}`) {
  const index = QUESTION_DATA.findIndex(q => q.id === questionId);
  input.selections[index].push(createSelectedCapsule(createCustomKeyword(questionId, raw, keywordId), questionId, selectionId));
  input.responses[index].status = "answered";
  return input;
}
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
const ratio = (result, familyId) => result.coreShares.find(s => s.familyId === familyId)?.weight ?? 0;
const qTrace = (result, id) => result.trace.questions.find(q => q.questionId === id);
const primary = familyId => [{ familyId, role: "primary", weight: 1 }];
function variedCore() {
  return fixed(fixed(fixed(fixed(fixed(empty(), "q1", 12), "q2", 1), "q4", 3), "q5", 12), "q6", 3);
}
function deepFreeze(value) {
  Object.freeze(value);
  for (const child of Object.values(value)) if (child && typeof child === "object" && !Object.isFrozen(child)) deepFreeze(child);
  return value;
}
test("same immutable input gives completely deterministic output without clocks, randomness or network", () => {
  const input = deepFreeze(variedCore());
  const previous = { random: Math.random, now: Date.now, fetch: globalThis.fetch };
  try {
    Math.random = Date.now = globalThis.fetch = () => { throw new Error("Unexpected side effect"); };
    assert.deepEqual(engine(input), engine(input));
  } finally { Math.random = previous.random; Date.now = previous.now; globalThis.fetch = previous.fetch; }
});
test("all five existing core question weights are reused, normalized and independently visible", () => {
  assert.deepEqual(AURORA_CORE_QUESTION_WEIGHTS, { q1: .18, q2: .13, q4: .20, q5: .20, q6: .29 });
  const result = engine(variedCore());
  for (const [id, family, weight] of [["q1", "drive", .18], ["q2", "serenity", .13], ["q4", "connection", .20], ["q5", "reflection", .20], ["q6", "exploration", .29]]) {
    close(qTrace(result, id).effectiveCoreWeight, weight);
    close(ratio(result, family), weight);
  }
  assert.equal(result.inputState.coreData, "complete");
});
test("only answered AND mapped core questions participate; partial core weights are renormalized", () => {
  const input = fixed(fixed(empty(), "q1", 12), "q6", 3);
  input.responses[1].status = "skipped";
  custom(input, "q4", "뜻을 추측하지 않는 말");
  const result = engine(input);
  close(ratio(result, "drive"), .18 / .47);
  close(ratio(result, "exploration"), .29 / .47);
  assert.deepEqual(result.inputState.participatingCoreQuestionIds, ["q1", "q6"]);
  assert.equal(qTrace(result, "q4").status, "answered");
  assert.equal(qTrace(result, "q4").effectiveCoreWeight, 0);
  assert.equal(result.inputState.coreData, "partial");
});
test("primary and secondary meanings retain their existing fractions", () => {
  const result = engine(fixed(empty(), "q1", 3));
  close(ratio(result, "expression"), .8);
  close(ratio(result, "exploration"), .2);
  assert.deepEqual(qTrace(result, "q1").selections[0].weights, pools[0][2].semanticWeights);
});
test("many mapped keywords split a single question budget rather than increasing that question's influence", () => {
  const input = fixed(fixed(fixed(empty(), "q1", 12), "q1", 8), "q6", 2);
  const result = engine(input);
  close(ratio(result, "drive"), .18 / .47 / 2);
  close(ratio(result, "exploration"), .18 / .47 / 2);
  close(ratio(result, "connection"), .29 / .47);
});
for (const [id, number, key, intent] of [["q3", 4, "atmosphere", "currentAtmosphere"], ["q7", 14, "innerPulse", "emotionalWish"],
  ["q8", 13, "releaseFragments", "releaseTarget"], ["q9", 10, "outerExpansion", "futureAspiration"]]) {
  test(`${id} is isolated as ${key}, never counted as current core characteristics`, () => {
    const input = variedCore();
    const before = engine(input);
    fixed(input, id, number);
    const after = engine(input);
    assert.deepEqual(after.appearance, before.appearance);
    assert.deepEqual(after.coreShares, before.coreShares);
    assert.deepEqual(after.trace.families, before.trace.families);
    assert.equal(after[key].active, true);
    assert.equal(after[key].answerIntent, intent);
    assert.equal(qTrace(after, id).effectiveCoreWeight, 0);
    assert.deepEqual(qTrace(after, id).selections[0].coreContributions, []);
  });
}
test("Q3 landscape parameters come only from explicit question-specific identities and average unique landscapes", () => {
  const input = fixed(fixed(empty(), "q3", 4), "q3", 8);
  const result = engine(input);
  close(result.atmosphere.mistDensity, (.78 + .25) / 2);
  close(result.atmosphere.brightness, (.35 + .67) / 2);
  assert.equal(result.atmosphere.parametersOrigin, "explicit-landscape");
  assert.deepEqual(Object.keys(AURORA_ATMOSPHERE_BY_KEYWORD).sort(), QUESTION_DATA[2].keywords.map(k => k.id).sort());
});
test("unknown custom words cannot forge Q3 landscape effects by using a fixed keyword ID", () => {
  const input = custom(empty(), "q3", "새로운 풍경", "pick", "q3-04");
  const result = engine(input);
  assert.equal(result.atmosphere.active, false);
  assert.equal(result.atmosphere.parametersOrigin, "neutral-visual");
  assert.deepEqual(result.atmosphere.shares, []);
});
test("Q10 selections and client meaning values have no influence on Q1–Q9 engine", () => {
  const input = variedCore();
  const before = engine(input);
  custom(input, "q10", "최종 문장이 아닌 입력");
  input.selections[9][0].semanticWeights = primary("drive");
  assert.deepEqual(engine(input), before);
});
test("family repetition counts distinct core questions and caps at 1.6", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 100].map(auroraRepetitionMultiplier), [1, 1.3, 1.48, 1.6, 1.6, 1.6]);
  const input = fixed(fixed(fixed(fixed(empty(), "q1", 1), "q2", 1), "q4", 7), "q6", 12);
  const result = engine(input), family = result.trace.families.find(f => f.familyId === "serenity");
  assert.equal(family.repetitionMultiplier, 1.6);
  assert.deepEqual(family.evidenceQuestionIds, ["q1", "q2", "q4", "q6"]);
  close(family.emphasizedScore, family.baseScore * 1.6);
  close(result.coreShares.reduce((sum, s) => sum + s.weight, 0), 1);
});
test("repeated family evidence is distinct from repeated wording and no string multiplier double counts it", () => {
  const input = fixed(fixed(empty(), "q4", 12), "q5", 1); // same label 안정감
  const result = engine(input);
  assert.equal(result.trace.repeatedTexts.length, 1);
  assert.deepEqual(result.trace.repeatedTexts[0].questionIds, ["q4", "q5"]);
  assert.equal(result.trace.families.find(f => f.familyId === "grounding").repetitionMultiplier, 1.3);
  const before = engine(fixed(fixed(empty(), "q1", 1), "q2", 1)); // different words, same family
  assert.equal(before.trace.repeatedTexts.length, 0);
  assert.equal(before.trace.families.find(f => f.familyId === "serenity").repetitionMultiplier, 1.3);
});
test("duplicate selections within a question do not inflate scores or repetition", () => {
  const input = fixed(fixed(empty(), "q1", 12), "q6", 2);
  const before = engine(input);
  fixed(input, "q1", 12, "another-pick");
  custom(input, "q1", pools[0][11].label, "third-pick");
  const after = engine(input);
  assert.deepEqual(after.appearance, before.appearance);
  assert.deepEqual(after.trace.families, before.trace.families);
  assert.equal(qTrace(after, "q1").selections.length, 1);
  assert.equal(qTrace(after, "q1").selections[0].selectionIds.length, 3);
});
test("same family from several different words in one question counts as one repetition evidence", () => {
  const result = engine(fixed(fixed(fixed(empty(), "q2", 1), "q2", 5), "q2", 8));
  assert.equal(result.trace.families[0].repetitionMultiplier, 1);
  assert.deepEqual(result.trace.families[0].evidenceQuestionIds, ["q2"]);
});
test("pending, skipped and answered-empty remain distinguishable from zero scores", () => {
  const input = empty();
  input.responses[0].status = "skipped";
  input.responses[1].status = "answered";
  const result = engine(input);
  assert.deepEqual(result.inputState.skippedQuestionIds, ["q1"]);
  assert.deepEqual(result.inputState.answeredQuestionIds, ["q2"]);
  assert.equal(result.inputState.pendingQuestionIds.length, 7);
  assert.ok(qTrace(result, "q2").issues.includes("answered-without-selections"));
  assert.deepEqual(result.coreShares, []);
  assert.deepEqual(validateAuroraAppearance(result.appearance), []);
});
test("all skips yield an explicitly neutral palette without user-derived meaning evidence", () => {
  const input = empty();
  input.responses.forEach(r => { r.status = "skipped"; });
  const result = engine(input);
  assert.deepEqual(result.coreShares, []);
  assert.deepEqual(result.trace.families, []);
  assert.equal(result.inputState.coreData, "none");
  assert.equal(result.trace.visualFallback, "neutral-palette");
  assert.ok(result.trace.paletteOrigins.every(p => p.origin === "neutral-visual"));
  assert.ok(result.appearance.palette.every(p => p.color));
  assert.deepEqual(validateAuroraAppearance(result.appearance), []);
});
test("only special-role answers retain their own effects while core uses neutral fallback", () => {
  const input = fixed(fixed(fixed(fixed(empty(), "q3", 4), "q7", 14), "q8", 13), "q9", 10);
  const result = engine(input);
  assert.equal(result.trace.visualFallback, "neutral-palette");
  assert.deepEqual(result.coreShares, []);
  assert.ok([result.atmosphere, result.innerPulse, result.releaseFragments, result.outerExpansion].every(e => e.active));
  assert.equal(result.releaseFragments.direction, "radial-outward");
  assert.equal(result.outerExpansion.direction, "outward");
});
test("one real family stays a single core share; the second renderer color is explicitly a neutral accent", () => {
  for (const [question, keyword] of [["q1", 12], ["q5", 1]]) {
    const result = engine(fixed(empty(), question, keyword));
    assert.equal(result.coreShares.length, 1);
    assert.equal(result.coreShares[0].weight, 1);
    assert.equal(result.trace.visualFallback, "neutral-accent");
    assert.equal(result.appearance.palette.length, 2);
    assert.equal(result.appearance.palette[1].weight, .08);
    assert.equal(result.trace.paletteOrigins[1].origin, "neutral-visual");
    assert.deepEqual(validateAuroraAppearance(result.appearance), []);
  }
});
test("exact custom wording only inherits mapping in the same question, preserving original text", () => {
  const raw = "  혼자만의 시간  ";
  const input = custom(custom(empty(), "q1", raw), "q2", raw);
  const before = copy(input);
  const result = engine(input);
  assert.equal(qTrace(result, "q1").selections[0].mapping, "exact-custom");
  assert.equal(qTrace(result, "q2").selections[0].mapping, "unclassified");
  assert.deepEqual(input, before);
  assert.equal(input.selections[0][0].originalText, raw);
});
test("unknown custom wording is not classified by capsule physics or unverified client weights", () => {
  const input = custom(empty(), "q1", "새로운 자유의 세계");
  input.selections[0][0].group = "energy";
  input.selections[0][0].semanticWeights = primary("drive");
  const result = engine(input);
  assert.deepEqual(result.coreShares, []);
  assert.equal(result.inputState.unclassified.length, 1);
  assert.ok(qTrace(result, "q1").issues.includes("unverified-client-weights-ignored"));
  assert.equal(JSON.stringify(result.trace).includes("새로운 자유의 세계"), false);
});
test("all custom-only unknown answers remain answered but create neither core meaning nor special effects", () => {
  const input = empty();
  for (const question of QUESTION_DATA.slice(0, 9)) custom(input, question.id, `매핑 없는 원문 ${question.id}`);
  const result = engine(input);
  assert.equal(result.inputState.answeredQuestionIds.length, 9);
  assert.equal(result.inputState.unclassified.length, 9);
  assert.equal(result.inputState.coreData, "none");
  assert.deepEqual(result.coreShares, []);
  assert.ok([result.atmosphere, result.innerPulse, result.releaseFragments, result.outerExpansion].every(effect => !effect.active));
  assert.deepEqual(validateAuroraAppearance(result.appearance), []);
});
test("unclassified text is preserved without diluting a question's mapped meaning budget", () => {
  const input = fixed(empty(), "q1", 3), before = engine(input);
  custom(input, "q1", "의미를 모르는 별도 입력");
  const after = engine(input);
  assert.deepEqual(after.appearance, before.appearance);
  assert.deepEqual(after.coreShares, before.coreShares);
  assert.equal(after.inputState.unclassified.length, 1);
});
test("explicit curated custom evidence must match question, selection ID and exact original text", () => {
  const input = custom(empty(), "q1", "  검증된 표현  ", "verified");
  const record = { questionId: "q1", selectionId: "verified", originalText: "  검증된 표현  ", weights: primary("expression") };
  const options = { verifiedCustomMeanings: [record] };
  const result = engine(input, deepFreeze(copy(options)));
  assert.equal(qTrace(result, "q1").selections[0].mapping, "verified-custom");
  close(ratio(result, "expression"), 1);
  for (const mismatch of [{ questionId: "q2" }, { selectionId: "other" }, { originalText: "검증된 표현" }]) {
    assert.deepEqual(engine(input, { verifiedCustomMeanings: [{ ...record, ...mismatch }] }).coreShares, []);
  }
});
test("invalid and duplicate curated evidence is ignored rather than producing NaN or order-dependent meanings", () => {
  const input = custom(empty(), "q1", "별도 표현", "pick");
  const record = { questionId: "q1", selectionId: "pick", originalText: "별도 표현", weights: primary("drive") };
  const invalidWeights = [[], [{ familyId: "other", role: "primary", weight: 1 }], [{ familyId: "drive", role: "primary", weight: NaN }],
    [{ familyId: "drive", role: "secondary", weight: 1 }], [{ familyId: "drive", role: "primary", weight: .5 }],
    [{ familyId: "drive", role: "primary", weight: .7 }, { familyId: "drive", role: "secondary", weight: .3 }]];
  for (const weights of invalidWeights) assert.deepEqual(engine(input, { verifiedCustomMeanings: [{ ...record, weights }] }).coreShares, []);
  assert.deepEqual(engine(input, { verifiedCustomMeanings: [record, record] }).coreShares, []);
});
test("curated weights are copied as canonical fields so equivalent property order does not create a false conflict", () => {
  const input = custom(custom(empty(), "q1", "같은 검증 표현", "a"), "q1", "같은 검증 표현", "b");
  const options = { verifiedCustomMeanings: [
    { questionId: "q1", selectionId: "a", originalText: "같은 검증 표현", weights: primary("drive") },
    { questionId: "q1", selectionId: "b", originalText: "같은 검증 표현", weights: [{ weight: 1, role: "primary", familyId: "drive", extra: "not-output" }] },
  ] };
  const result = engine(input, deepFreeze(copy(options)));
  close(ratio(result, "drive"), 1);
  assert.equal(qTrace(result, "q1").selections.length, 1);
  assert.equal(JSON.stringify(result).includes("not-output"), false);
  input.selections[0].reverse();
  assert.deepEqual(engine(input, options), result);
});
test("fixed canonical meaning cannot be overridden by raw or curated client values", () => {
  const input = fixed(empty(), "q1", 3);
  input.selections[0][0].semanticWeights = primary("drive");
  const result = engine(input, { verifiedCustomMeanings: [{ questionId: "q1", selectionId: "q1-3", originalText: pools[0][2].label, weights: primary("drive") }] });
  close(ratio(result, "expression"), .8);
  close(ratio(result, "exploration"), .2);
  close(ratio(result, "drive"), 0);
});
test("forged fixed IDs, labels, contexts and intentions are ignored and traced", () => {
  for (const mismatch of [{ label: pools[0][7].label }, { id: "q2-01" }, { questionId: "q8" }, { answerIntent: "releaseTarget" }, { originalText: "변조 원문" }]) {
    const input = fixed(empty(), "q1", 3);
    Object.assign(input.selections[0][0], mismatch);
    const result = engine(input);
    assert.deepEqual(result.coreShares, []);
    assert.ok(qTrace(result, "q1").issues.length > 0);
    assert.deepEqual(validateAuroraAppearance(result.appearance), []);
  }
});
test("conflicting duplicate custom meanings and duplicate selection IDs cannot create ordering bias", () => {
  const input = custom(custom(empty(), "q1", "같은 말", "a"), "q1", "같은 말", "b");
  const options = { verifiedCustomMeanings: [
    { questionId: "q1", selectionId: "a", originalText: "같은 말", weights: primary("drive") },
    { questionId: "q1", selectionId: "b", originalText: "같은 말", weights: primary("serenity") },
  ] };
  const before = engine(input, options);
  assert.deepEqual(before.coreShares, []);
  input.selections[0].reverse();
  assert.deepEqual(engine(input, options), before);
  input.selections[0][1].selectionId = "b";
  assert.ok(qTrace(engine(input), "q1").issues.includes("duplicate-selection-identity"));
});
test("selection and response order changes preserve complete output and stable ties", () => {
  const input = variedCore();
  fixed(input, "q1", 8, "additional");
  fixed(input, "q3", 4);
  const before = engine(input);
  input.responses.reverse();
  input.selections.forEach(row => row.reverse());
  assert.deepEqual(engine(input), before);
  assert.deepEqual(engine(variedCore()).coreShares.slice(1, 3).map(s => s.familyId), ["connection", "reflection"]);
});
test("missing or conflicting response records never silently reinterpret answered selections", () => {
  const input = fixed(empty(), "q1", 12);
  input.responses.push({ questionId: "q1", status: "answered" });
  assert.ok(qTrace(engine(input), "q1").issues.includes("response-conflict"));
  assert.deepEqual(engine(input).coreShares, []);
  assert.deepEqual(engine({ selections: [], responses: [] }).inputState.pendingQuestionIds, QUESTION_DATA.slice(0, 9).map(q => q.id));
  const stale = fixed(empty(), "q1", 12);
  stale.responses[0].status = "skipped";
  assert.deepEqual(engine(stale).coreShares, []);
  assert.ok(qTrace(engine(stale), "q1").issues.includes("selections-ignored-for-response-status"));
});
test("all fixed keywords and broad mixtures produce valid bounded renderer-compatible appearances", () => {
  const inputs = [empty(), variedCore()];
  for (const question of QUESTION_DATA.slice(0, 9)) {
    for (let number = 1; number <= 14; number++) inputs.push(fixed(empty(), question.id, number));
    const many = empty();
    for (let number = 1; number <= 14; number++) fixed(many, question.id, number);
    inputs.push(many);
  }
  const all = empty();
  for (const question of QUESTION_DATA.slice(0, 9)) for (let number = 1; number <= 14; number++) fixed(all, question.id, number);
  inputs.push(all);
  for (const input of inputs) {
    const { appearance, coreShares } = engine(input);
    assert.deepEqual(validateAuroraAppearance(appearance), []);
    close(appearance.palette.reduce((sum, p) => sum + p.weight, 0), 1);
    if (coreShares.length) close(coreShares.reduce((sum, p) => sum + p.weight, 0), 1);
    assert.ok(appearance.motion.speed >= .28 - 1e-12 && appearance.motion.speed <= .42 + 1e-12);
    assert.ok(appearance.motion.amplitude >= .48 - 1e-12 && appearance.motion.amplitude <= .76 + 1e-12);
    assert.ok(appearance.motion.flow >= .35 - 1e-12 && appearance.motion.flow <= .65 + 1e-12);
  }
});
test("engine and output mutations do not change original selections, preset data or Q10 recommendations", () => {
  const input = variedCore(), before = copy(input), presets = copy(AURORA_PRESETS), recommendations = generateQ10Recommendations(input);
  const result = engine(deepFreeze(input));
  result.appearance.palette[0].weight = 0;
  result.trace.questions[0].selections[0].weights[0].weight = 0;
  assert.deepEqual(input, before);
  assert.deepEqual(AURORA_PRESETS, presets);
  assert.deepEqual(generateQ10Recommendations(input), recommendations);
});
test("Q10 title adapter admits only current approved messages, never drafts or stale approvals", () => {
  let state = createQuestionnaireState();
  state = reduce(state, { type: "closing-input", field: "authoredText", text: "오늘도 나의 속도로 걷고 싶다" });
  assert.equal(fromState(state).approvedTitle, null);
  const inputFingerprint = closingInputFingerprint(buildClosingMessageInput(state, state.closing.authoredText, state.closing.authoredWord));
  state = reduce(state, { type: "closing-start", id: "test", inputFingerprint });
  state = reduce(state, { type: "closing-success", id: "test", inputFingerprint, text: "내 마음의 속도를 믿으며 오늘을 걸어가고 싶다" });
  assert.equal(fromState(state).approvedTitle, null);
  state = reduce(state, { type: "closing-approve", approvedAt: "2026-10-14T00:00:00.000Z" });
  const approved = fromState(state);
  assert.deepEqual(approved.approvedTitle, { text: "내 마음의 속도를 믿으며 오늘을 걸어가고 싶다", source: "ai" });
  assert.deepEqual(approved.appearance, engine(state).appearance);
  const edited = reduce(state, { type: "closing-edit", text: "내가 고쳐 결정한 문장" });
  assert.equal(fromState(edited).approvedTitle, null);
  assert.deepEqual(fromState(reduce(edited, { type: "closing-approve", approvedAt: "2026-10-14T00:00:00.000Z" })).approvedTitle,
    { text: "내가 고쳐 결정한 문장", source: "user-edited" });
  const stale = copy(state);
  stale.closing.authoredText += " 달라진 입력";
  assert.equal(fromState(stale).approvedTitle, null);
  const changed = reduce(state, { type: "select", step: 0, selection: createSelectedCapsule(pools[0][0], "q1", "changed") });
  assert.equal(fromState(changed).approvedTitle, null);
});
test("approved authored and edited titles preserve source without transporting full input fingerprints", () => {
  let state = reduce(createQuestionnaireState(), { type: "closing-input", field: "authoredText", text: "  내가 정한 문장  " });
  state = reduce(state, { type: "closing-approve", direct: true, approvedAt: "2026-10-14T00:00:00.000Z" });
  assert.deepEqual(fromState(state).approvedTitle, { text: "내가 정한 문장", source: "user-authored" });
  assert.equal(JSON.stringify(fromState(state)).includes("closing-v1:"), false);
  state = reduce(state, { type: "closing-edit", text: "새로 결정한 말" });
  assert.equal(fromState(state).approvedTitle, null);
  state = reduce(state, { type: "closing-approve", approvedAt: "2026-10-14T00:00:00.000Z" });
  assert.equal(fromState(state).approvedTitle.text, "새로 결정한 말");
});
test("meaning results are independent of quality and device rendering budgets", () => {
  const input = variedCore(), expected = engine(input);
  for (const device of ["mobile", "tablet", "desktop"]) for (const quality of ["low", "balanced", "high"]) {
    assert.deepEqual(engine({ ...input, device, quality }), expected);
  }
});
