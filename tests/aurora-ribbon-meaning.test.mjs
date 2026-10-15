import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { loadModule } from "./helpers/load-typescript.mjs";

const { buildAuroraRibbonMeaningMap: map, buildAuroraRibbonMeaningFromResult: fromResult } = loadModule("lib/aurora-ribbon-meaning.ts");
const { createAuroraRibbonLayout: layout, auroraRibbonVisualParameters: visual } = loadModule("lib/aurora-ribbon-layout.ts");
const { personalizeAurora: engine } = loadModule("lib/aurora-personalization.ts");
const { auroraRibbonShapes, auroraLoopShapes, auroraCurtainMistShape, auroraLoopMistShape } = loadModule("lib/aurora-geometry.ts");
const { auroraEnergyProfiles } = loadModule("lib/aurora-energy.ts");
const { auroraFlowBudget, auroraQualityBudget, auroraPaletteColors } = loadModule("lib/aurora-types.ts");
const { SEMANTIC_FAMILIES } = loadModule("lib/semantic-families.ts");
const { QUESTION_DATA } = loadModule("lib/question-data.ts");
const { createKeywordPools, createSelectedCapsule, createCustomKeyword } = loadModule("lib/capsules.ts");
const { createQuestionnaireState, questionnaireReducer: reduce, serializeLegacyAnswers } = loadModule("lib/questionnaire-state.ts");
const { prepareAuroraResult } = loadModule("lib/aurora-result.ts");
const pools = createKeywordPools();
const empty = () => ({ selections: QUESTION_DATA.map(() => []), responses: QUESTION_DATA.map(q => ({ questionId: q.id, status: "pending" })) });
function fixed(input, id, number, selectionId = `${id}-pick-${number}`) {
  const i = QUESTION_DATA.findIndex(q => q.id === id);
  input.selections[i].push(createSelectedCapsule(pools[i][number - 1], id, selectionId));
  input.responses[i].status = "answered";
  return input;
}
function custom(input, id, raw, selectionId = `${id}-custom`) {
  const i = QUESTION_DATA.findIndex(q => q.id === id);
  input.selections[i].push(createSelectedCapsule(createCustomKeyword(id, raw, `custom-${selectionId}`), id, selectionId));
  input.responses[i].status = "answered";
  return input;
}
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);
function freeze(value) {
  Object.freeze(value);
  for (const v of Object.values(value)) if (v && typeof v === "object" && !Object.isFrozen(v)) freeze(v);
  return value;
}
function broad() {
  const source = empty();
  for (const id of ["q1", "q2", "q4", "q5", "q6"]) for (let n = 1; n <= 14; n++) fixed(source, id, n);
  return source;
}
function comments() { return QUESTION_DATA.map(q => ({ questionId: q.id, analysis: `기존 요약 ${q.id}`, detailedAnalysis: `기존 상세 ${q.id}` })); }

test("one answer-derived family remains genuine; neutral accent never becomes personality evidence", () => {
  const source = fixed(empty(), "q1", 12), p = engine(source), output = map(p, { source });
  assert.equal(output.sourceBinding, "meaning-replay-matched");
  assert.equal(output.activeRibbonCount, 3); // two primary ribbons + one supporting loop
  for (const ribbon of output.ribbons) {
    assert.equal(ribbon.meaningStatus, "derived");
    assert.equal(ribbon.representativeFamily, "drive");
    assert.deepEqual(ribbon.composition.map(s => s.familyId), ["drive"]);
    close(ribbon.composition[0].withinPairShare, 1);
    assert.equal(ribbon.paletteOrigins.filter(o => o.origin === "neutral-visual").length, 1);
    assert.ok(ribbon.evidence.every(e => e.questionId === "q1"));
    assert.equal(ribbon.evidence[0].texts[0].originalText, pools[0][11].label);
    assert.equal(ribbon.name.includes("균형"), false);
  }
});
test("seven equally represented meanings do not invent seven physical ribbons", () => {
  const source = empty(), verifiedCustomMeanings = [];
  SEMANTIC_FAMILIES.forEach(f => {
    custom(source, "q1", `검증된 ${f.id}`, f.id);
    verifiedCustomMeanings.push({ questionId: "q1", selectionId: f.id, originalText: `검증된 ${f.id}`,
      weights: [{ familyId: f.id, role: "primary", weight: 1 }] });
  });
  const options = { verifiedCustomMeanings }, p = engine(source, options);
  const output = map(p, { source, personalizationOptions: options });
  assert.equal(output.sourceBinding, "meaning-replay-matched");
  assert.equal(p.coreShares.length, 7);
  p.coreShares.forEach(s => close(s.weight, 1 / 7));
  assert.equal(output.ribbons.length, 6); // 4 primary + 2 mounted loops
  assert.equal(output.activeRibbonCount, 5);
  assert.deepEqual(output.familiesWithoutActiveRibbonColor, p.coreShares.slice(5).map(s => s.familyId));
});
test("mixed ribbon composition copies the two endpoints' core shares, not shader pixel percentages", () => {
  const source = fixed(empty(), "q1", 3), p = engine(source), output = map(p, { source });
  const ribbon = output.ribbons[0];
  assert.deepEqual(ribbon.composition.map(s => s.familyId), ["expression", "exploration"]);
  close(ribbon.composition[0].withinPairShare, .8);
  close(ribbon.composition[1].withinPairShare, .2);
  assert.equal(ribbon.evidence[0].contributions.length, 2);
  assert.equal(ribbon.compositionBasis, "core-shares-within-color-pair");
  assert.equal(ribbon.visualExplanation.colorAreaFractionsAvailable, false);
  assert.equal(ribbon.layers[0].visual.blendModel, "spatial-noise-iridescence");
});
test("all seven meanings retain global motion contributions even when absent from ribbon colors", () => {
  const source = broad(), p = engine(source), output = map(p, { source });
  assert.equal(p.coreShares.length, 7);
  assert.equal(output.familiesWithoutActiveRibbonColor.length, 2);
  close(output.globalMotionEvidence.flatMap(e => e.contributions).reduce((s, c) => s + c.globalShareContribution, 0), 1);
  assert.deepEqual(output.globalMotionRepetitions, p.trace.families);
  for (const id of output.familiesWithoutActiveRibbonColor) {
    assert.ok(output.globalMotionEvidence.some(e => e.contributions.some(c => c.familyId === id)));
  }
  for (const r of output.ribbons) {
    assert.deepEqual(r.visualExplanation.globalMotionFamilyShares, p.coreShares);
    assert.deepEqual(r.visualExplanation.globalMotion, p.appearance.motion);
    assert.equal(r.visualExplanation.globalMotionEvidenceRef, "map.globalMotionEvidence");
    assert.equal(r.evidenceScope, "direct-color-pair");
    assert.equal(r.composition.length, 2);
    assert.ok(r.composition.every(c => r.layers[0].visual.colorA.familyId === c.familyId || r.layers[0].visual.colorB.familyId === c.familyId));
    close(r.evidence.flatMap(e => e.contributions).reduce((s, c) => s + c.withinPairContribution, 0), 1);
  }
});
test("same original input has deterministic IDs and output without time, random or network", () => {
  const source = freeze(broad()), p = freeze(engine(source));
  const old = { now: Date.now, random: Math.random, fetch: globalThis.fetch };
  try {
    Date.now = Math.random = globalThis.fetch = () => { throw new Error("Unexpected side effect"); };
    assert.deepEqual(map(p, { source }), map(p, { source }));
  } finally { Date.now = old.now; Math.random = old.random; globalThis.fetch = old.fetch; }
});
test("selection and response order changes retain identity, selected text order and semantic mapping", () => {
  const source = broad(), expected = map(engine(source), { source });
  source.selections.forEach(row => row.reverse()); source.responses.reverse();
  assert.deepEqual(map(engine(source), { source }), expected);
});
test("duplicate picks within one question keep 5-A's single contribution and all original identities", () => {
  const source = fixed(fixed(empty(), "q1", 12), "q6", 2), before = map(engine(source), { source });
  fixed(source, "q1", 12, "second-pick");
  const after = map(engine(source), { source });
  assert.deepEqual(after.ribbons[0].composition, before.ribbons[0].composition);
  assert.deepEqual(after.ribbons[0].repetitions, before.ribbons[0].repetitions);
  const selected = after.ribbons[0].evidence.find(e => e.questionId === "q1");
  assert.equal(selected.selectionIds.length, 2);
  assert.equal(selected.texts.length, 2);
  assert.deepEqual(selected.contributions, before.ribbons[0].evidence.find(e => e.questionId === "q1").contributions);
});
test("family repetition and repeated actual wording preserve distinct-question emphasis without a new multiplier", () => {
  const source = fixed(fixed(empty(), "q4", 12), "q5", 1), p = engine(source), output = map(p, { source });
  for (const r of output.ribbons) {
    assert.equal(r.repetitions.find(f => f.familyId === "grounding").repetitionMultiplier, 1.3);
    assert.deepEqual(r.repeatedTexts[0].questionIds, ["q4", "q5"]);
    assert.ok(r.evidence.every(e => e.contributions.every(c => c.repetitionMultiplier === p.trace.families.find(f => f.familyId === c.familyId).repetitionMultiplier)));
    close(r.evidence.flatMap(e => e.contributions).reduce((s, c) => s + c.globalShareContribution, 0), 1);
  }
});
for (const [id, n, intent] of [["q3", 4, "currentAtmosphere"], ["q7", 14, "emotionalWish"], ["q8", 13, "releaseTarget"], ["q9", 10, "futureAspiration"]]) {
  test(`${id} remains ${intent}, with stored-only context and no core ribbon evidence`, () => {
    const source = fixed(empty(), "q1", 12), before = map(engine(source), { source });
    fixed(source, id, n);
    const output = map(engine(source), { source });
    assert.deepEqual(output.ribbons, before.ribbons);
    const context = output.nonCoreContext.find(q => q.questionId === id);
    assert.equal(context.answerIntent, intent);
    assert.equal(context.rendererApplied, false);
    assert.ok(output.ribbons.every(r => r.evidence.every(e => e.questionId !== id)));
  });
}
test("unknown custom keyword keeps exact original wording but has no asserted meaning or color evidence", () => {
  const raw = "  私のことば\n별도의 내 표현  ", source = custom(fixed(empty(), "q1", 12), "q1", raw);
  source.selections[0][1].semanticWeights = [{ familyId: "serenity", role: "primary", weight: 1 }];
  const p = engine(source), output = map(p, { source });
  assert.equal(output.unclassifiedSelections.length, 1);
  assert.equal(output.unclassifiedSelections[0].meaning, "unclassified");
  assert.equal(output.unclassifiedSelections[0].texts[0].originalText, raw);
  assert.ok(output.ribbons.every(r => r.evidence.every(e => !e.selectionIds.includes("q1-custom"))));
  assert.deepEqual(p.coreShares.map(s => s.familyId), ["drive"]);
});
test("exact custom label and verified custom meaning reuse 5-A trace rather than guessing a new classification", () => {
  const source = custom(empty(), "q1", "  혼자만의 시간  "), p = engine(source), output = map(p, { source });
  assert.equal(output.ribbons[0].evidence[0].mapping, "exact-custom");
  assert.equal(output.ribbons[0].evidence[0].texts[0].originalText, "  혼자만의 시간  ");
  assert.deepEqual(output.ribbons[0].composition.map(s => s.familyId), p.coreShares.map(s => s.familyId));
  assert.equal(output.ribbons[0].representativeFamily, "serenity");
});
test("missing raw selections retain trace IDs but never replace them with invented selected words", () => {
  const p = engine(fixed(empty(), "q1", 12)), output = map(p);
  assert.equal(output.sourceBinding, "missing");
  assert.equal(output.ribbons[0].evidence[0].texts.length, 0);
  assert.deepEqual(output.ribbons[0].evidence[0].selectionIds, ["q1-pick-12"]);
});
test("a changed or invalid selection source cannot bind stale raw answers even when selection IDs match", () => {
  const source = fixed(empty(), "q1", 12), p = engine(source), changed = structuredClone(source);
  changed.selections[0][0].label = "선택하지 않은 위조 단어";
  const output = map(p, { source: changed });
  assert.equal(output.sourceBinding, "mismatch");
  assert.ok(output.issues.includes("source-mismatch"));
  assert.equal(JSON.stringify(output).includes("위조 단어"), false);
  assert.ok(output.ribbons.every(r => r.evidence.every(e => e.texts.length === 0)));
  const invalid = map(p, { source: { selections: null, responses: null } });
  assert.equal(invalid.sourceBinding, "invalid");
});
test("neutral fallback has visible geometry and colors but no invented semantic representatives", () => {
  const source = empty(), p = engine(source), output = map(p, { source });
  assert.equal(output.status, "ready");
  assert.equal(output.activeRibbonCount, 4);
  for (const r of output.ribbons) {
    assert.equal(r.meaningStatus, "neutral");
    assert.equal(r.representativeFamily, null);
    assert.deepEqual(r.composition, []);
    assert.deepEqual(r.evidence, []);
    assert.ok(r.name.startsWith("중립 빛"));
    assert.ok(r.paletteOrigins.every(o => o.origin === "neutral-visual"));
  }
});
test("missing personalization and invalid appearance yield no fabricated renderable identity", () => {
  assert.equal(map(null).status, "unavailable");
  assert.deepEqual(map(undefined).issues, ["personalization-missing"]);
  const p = engine(empty()); p.appearance.palette = [];
  assert.deepEqual(map(p).issues, ["appearance-invalid"]);
  assert.equal(map(p).ribbons.length, 0);
});
test("missing or inconsistent trace retains actual visuals while withholding semantic claims", () => {
  const p = engine(fixed(empty(), "q1", 12)), broken = structuredClone(p);
  delete broken.trace;
  const output = map(broken);
  assert.equal(output.status, "ready");
  assert.ok(output.issues.includes("provenance-unavailable"));
  assert.ok(output.ribbons.every(r => r.meaningStatus === "unavailable" && r.composition.length === 0));
  assert.deepEqual(output.ribbons[0].layers[0].visual, map(p).ribbons[0].layers[0].visual);
  const wrong = structuredClone(p); wrong.trace.families[0].share = .5;
  assert.ok(map(wrong).issues.includes("provenance-unavailable"));
});
test("changing palette hex never reclassifies meaning by the perceived color", () => {
  const p = engine(fixed(empty(), "q1", 12)); p.appearance.palette[0].color = "#0000ff";
  const output = map(p);
  assert.equal(output.ribbons[0].representativeFamily, "drive");
  assert.equal(output.ribbons[0].layers[0].visual.colorA.color, "#0000ff");
});
test("mapping and output mutations leave 5-A result, selected originals and renderer geometry inputs unchanged", () => {
  const source = broad(), p = engine(source), beforeP = structuredClone(p), beforeSource = structuredClone(source);
  const output = map(freeze(p), { source: freeze(source) });
  output.ribbons[0].layers[0].shape.position[0] = 999;
  output.ribbons[0].visualExplanation.globalMotion.speed = 99;
  output.ribbons[0].repetitions[0].baseScore = 999;
  output.ribbons[0].evidence[0].texts[0].originalText = "changed";
  assert.deepEqual(p, beforeP);
  assert.deepEqual(source, beforeSource);
  assert.deepEqual(engine(source), beforeP);
});

for (const quality of ["low", "balanced", "high"]) for (const mode of ["independent", "hybrid", "loop-emphasis"]) {
  test(`${quality}/${mode}: logical identities, mounted/active counts, geometry and mist match the existing renderer`, () => {
    const p = engine(broad()), output = map(p, { quality, flowMode: mode }), plan = layout(p.appearance, quality, mode);
    const budget = auroraQualityBudget(quality), flow = auroraFlowBudget(mode, budget);
    assert.equal(output.activeRibbonCount, p.appearance.ribbonCount + flow.loopCount);
    assert.equal(output.ribbons.length, p.appearance.ribbonCount + 2);
    assert.equal(output.mountedMeshCount, p.appearance.ribbonCount * 2 + 2 * (1 + flow.mistLayers));
    assert.equal(output.activeMeshCount, p.appearance.ribbonCount * 2 + flow.loopCount * (1 + flow.mistLayers));
    assert.equal(new Set(output.ribbons.map(r => r.ribbonId)).size, output.ribbons.length);
    const primary = auroraRibbonShapes(p.appearance), loops = auroraLoopShapes(p.appearance);
    for (const r of output.ribbons) {
      const shape = (r.kind === "curtain" ? primary : loops)[r.slot];
      assert.deepEqual(r.layers[0].shape, shape);
      assert.deepEqual(r.layers[0].visual, visual(p.appearance.palette, shape));
      r.layers.slice(1).forEach((l, i) => {
        assert.deepEqual(l.shape, r.kind === "curtain" ? auroraCurtainMistShape(shape) : auroraLoopMistShape(shape, i));
        assert.deepEqual(l.visual, visual(p.appearance.palette, l.shape, true));
        assert.equal(l.mist, true);
      });
      assert.deepEqual(r.visualExplanation.energyProfiles, auroraEnergyProfiles(shape.energySeed));
    }
    assert.deepEqual(output.renderSequence, plan.renderSequence);
    assert.deepEqual(output.renderSequence.slice(0, primary.length), primary.map((_, i) => `curtain-${i}`));
  });
}
test("quality and flow switches retain slot IDs and meaning; hidden loops retain identity for fades", () => {
  const p = engine(broad()), low = map(p, { quality: "low", flowMode: "independent" }), high = map(p, { quality: "high", flowMode: "loop-emphasis" });
  assert.deepEqual(low.ribbons.map(r => r.ribbonId), high.ribbons.map(r => r.ribbonId));
  assert.deepEqual(low.ribbons.map(r => r.composition), high.ribbons.map(r => r.composition));
  assert.ok(low.ribbons.filter(r => r.kind === "loop").every(r => !r.active));
  assert.ok(high.ribbons.every(r => r.active));
});
test("shared visual helper preserves Phase 4 formula, and the renderer consumes it without interaction changes", () => {
  const p = engine(broad()), colors = auroraPaletteColors(p.appearance.palette);
  for (const shape of [...auroraRibbonShapes(p.appearance), ...auroraLoopShapes(p.appearance)]) for (const mist of [false, true]) {
    const v = visual(p.appearance.palette, shape, mist), a = shape.colorIndex, b = (a + 1) % colors.length;
    assert.equal(v.colorA.color, colors[a]); assert.equal(v.colorB.color, colors[b]);
    assert.equal(v.baseMix, p.appearance.palette[b].weight);
    const share = mist ? shape.kind === "loop" ? .58 * .34 : .24 : shape.kind === "loop" ? .58 : .95;
    assert.equal(v.targetOpacity, (.24 + p.appearance.palette[a].weight * .24) * share);
  }
  const source = readFileSync(new URL("../components/aurora/AuroraRibbons.tsx", import.meta.url), "utf8");
  assert.ok(source.includes("auroraRibbonVisualParameters(appearance.palette, shape, mist)"));
  assert.equal(/onClick|onPointer|userData/.test(source), false);
});
test("completed-result adapter reuses snapshot-bound whole-question analysis verbatim, never generates ribbon interpretation", () => {
  let state = createQuestionnaireState();
  state = reduce(state, { type: "select", step: 0, selection: createSelectedCapsule(pools[0][11], "q1", "actual-q1") });
  for (let step = 1; step < 9; step++) state = reduce(state, { type: "skip", step });
  state = reduce(state, { type: "closing-input", field: "authoredText", text: "승인한 나의 문장" });
  state = reduce(state, { type: "closing-approve", direct: true, approvedAt: "2026-10-14T00:00:00Z" });
  const prepared = prepareAuroraResult(state);
  assert.equal(prepared.ready, true);
  const completed = freeze({ snapshot: prepared.snapshot, comments: comments() }), before = structuredClone(completed);
  const output = fromResult(completed, { source: state });
  assert.equal(output.sourceBinding, "snapshot-verified");
  for (const r of output.ribbons) {
    assert.equal(r.interpretation.questionAnalyses.length, 1);
    const a = r.interpretation.questionAnalyses[0];
    assert.equal(a.questionId, "q1");
    assert.equal(a.analysis, completed.comments[0].analysis);
    assert.equal(a.actualAnswer, serializeLegacyAnswers(state)[0]);
    assert.equal(a.scope, "whole-question");
    assert.deepEqual(r.interpretation.ribbonSynthesis, { status: "not-generated", requiresSeparateGeneration: true });
  }
  assert.deepEqual(output.contextualAnalyses.map(a => a.questionId), ["q3", "q7", "q8", "q9", "q10"]);
  assert.equal(output.contextualAnalyses.at(-1).actualAnswer, "승인한 나의 문장");
  assert.deepEqual(completed, before);
});
test("missing, incomplete and wrong-ID analyses cannot attach partial or misordered interpretation", () => {
  const p = engine(fixed(empty(), "q1", 12)), snapshot = { personalization: p, answers: Array(10).fill("actual answer") };
  for (const items of [[], comments().slice(0, 5), comments().map((c, i) => i === 0 ? { ...c, questionId: "q9" } : c), Array(10).fill({ analysis: "", detailedAnalysis: "" })]) {
    const output = fromResult({ snapshot, comments: items });
    assert.ok(output.issues.includes("analysis-unavailable"));
    assert.ok(output.ribbons.every(r => r.interpretation.questionAnalyses.length === 0));
  }
  assert.ok(fromResult({ snapshot: { ...snapshot, answers: undefined }, comments: comments() }).issues.includes("analysis-unavailable"));
});
test("approval fingerprint rejects stale original text even when replay produces exactly the same meaning trace", () => {
  let state = createQuestionnaireState();
  state = reduce(state, { type: "select", step: 0, selection: createSelectedCapsule(pools[0][11], "q1", "fixed") });
  state = reduce(state, { type: "select", step: 0, selection: createSelectedCapsule(createCustomKeyword("q1", "  별도의 원문  ", "unknown"), "q1", "custom") });
  for (let step = 1; step < 9; step++) state = reduce(state, { type: "skip", step });
  state = reduce(state, { type: "closing-input", field: "authoredText", text: "그대로 보존하는 승인 문장" });
  state = reduce(state, { type: "closing-approve", direct: true, approvedAt: "2026-10-14T00:00:00Z" });
  const snapshot = prepareAuroraResult(state).snapshot, completed = { snapshot, comments: comments() };
  const changed = structuredClone(state);
  changed.selections[0].find(s => s.selectionId === "custom").originalText += " ";
  assert.equal(map(snapshot.personalization, { source: changed }).sourceBinding, "meaning-replay-matched");
  const output = fromResult(completed, { source: changed });
  assert.equal(output.sourceBinding, "mismatch");
  assert.ok(output.issues.includes("source-mismatch"));
  assert.equal(output.unclassifiedSelections[0].texts.length, 0);
  assert.ok(output.globalMotionEvidence.every(e => e.texts.length === 0));
  assert.ok(output.ribbons.every(r => r.evidence.every(e => e.texts.length === 0)));
});
test("corrupted contribution/repetition evidence and invalid layout options withhold misleading output", () => {
  const p = engine(fixed(fixed(empty(), "q1", 12), "q6", 2));
  for (const corrupt of [
    p => { p.trace.questions[0].selections[0].coreContributions[0].score *= 2; },
    p => { p.trace.families[0].evidenceQuestionIds = ["q3"]; },
    p => { p.trace.questions[0].selections[0].selectionIds = []; },
    p => { p.trace.questions[0].configuredCoreWeight = 1; },
  ]) {
    const broken = structuredClone(p); corrupt(broken);
    const output = map(broken);
    assert.ok(output.issues.includes("provenance-unavailable"));
    assert.ok(output.ribbons.every(r => r.composition.length === 0 && r.evidence.length === 0));
  }
  assert.deepEqual(map(p, { quality: "device-auto-low" }).issues, ["layout-invalid"]);
  assert.deepEqual(map(p, { flowMode: "unexpected" }).issues, ["layout-invalid"]);
});
test("all possible main ribbon counts agree with active contracts at every explicit quality/mode", () => {
  for (const p of [engine(fixed(empty(), "q1", 12)), engine(empty()), engine(broad())]) {
    for (const quality of ["low", "balanced", "high"]) for (const flowMode of ["independent", "hybrid", "loop-emphasis"]) {
      const output = map(p, { quality, flowMode });
      assert.equal(output.status, "ready");
      assert.equal(output.quality, quality);
      assert.equal(output.ribbons.filter(r => r.kind === "curtain").length, p.appearance.ribbonCount);
      assert.equal(output.ribbons.filter(r => r.active).length, output.activeRibbonCount);
    }
  }
});
