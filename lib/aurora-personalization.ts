import { CORE_QUESTION_CONTRIBUTIONS, KEYWORD_SEMANTICS } from "./keyword-semantics";
import { QUESTION_DATA } from "./question-data";
import { SEMANTIC_FAMILIES, type KeywordSemanticWeight, type SemanticFamilyId } from "./semantic-families";
import type { AuroraColorShare, AuroraMotion } from "./aurora-types";
import { getApprovedClosingMessage, type QuestionnaireState } from "./questionnaire-state";
import { validFinalClosingText } from "./closing-message";
import type { AuroraAnswerQuestionId, AuroraEffectEvidence, AuroraPersonalizationInput, AuroraPersonalizationOptions,
  AuroraPersonalizationResult, AuroraQuestionTrace, AuroraSelectionTrace } from "./aurora-personalization-types";

// Artistic tuning constants; these are not psychological scores.
export const AURORA_CORE_QUESTION_WEIGHTS = CORE_QUESTION_CONTRIBUTIONS;
export const AURORA_REPETITION_EMPHASIS = [1, 1.3, 1.48, 1.6] as const;
export const auroraRepetitionMultiplier = (count: number): number =>
  count <= 1 ? 1 : AURORA_REPETITION_EMPHASIS[Math.min(3, Math.floor(count) - 1)];

type Landscape = { mistDensity: number; brightness: number; softness: number; spread: number };
const landscape = (mistDensity: number, brightness: number, softness: number, spread: number): Landscape =>
  ({ mistDensity, brightness, softness, spread });
/** Explicit landscape art direction only: no symptom, risk or personality interpretation. */
export const AURORA_ATMOSPHERE_BY_KEYWORD: Readonly<Record<string, Landscape>> = {
  "q3-01": landscape(.40, .50, .80, .65), "q3-02": landscape(.60, .38, .75, .55),
  "q3-03": landscape(.30, .68, .78, .60), "q3-04": landscape(.78, .35, .90, .72),
  "q3-05": landscape(.65, .43, .60, .70), "q3-06": landscape(.35, .40, .72, .78),
  "q3-07": landscape(.58, .48, .58, .73), "q3-08": landscape(.25, .67, .76, .80),
  "q3-09": landscape(.48, .38, .86, .66), "q3-10": landscape(.42, .58, .82, .72),
  "q3-11": landscape(.34, .55, .68, .78), "q3-12": landscape(.38, .60, .80, .62),
  "q3-13": landscape(.43, .52, .76, .70), "q3-14": landscape(.50, .62, .84, .75),
};
const NEUTRAL_ATMOSPHERE = landscape(.45, .50, .80, .65);
const NEUTRAL_MOTION: AuroraMotion = { speed: .32, amplitude: .58, flow: .45, intensity: .90 };
const MOTION_BY_FAMILY: Readonly<Record<SemanticFamilyId, AuroraMotion>> = {
  serenity: { speed: .28, amplitude: .48, flow: .35, intensity: .88 },
  connection: { speed: .34, amplitude: .62, flow: .45, intensity: .94 },
  exploration: { speed: .42, amplitude: .76, flow: .65, intensity: 1.02 },
  expression: { speed: .38, amplitude: .70, flow: .58, intensity: .98 },
  drive: { speed: .40, amplitude: .72, flow: .62, intensity: 1.04 },
  grounding: { speed: .30, amplitude: .52, flow: .38, intensity: .90 },
  reflection: { speed: .29, amplitude: .56, flow: .40, intensity: .90 },
};
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const normalizeText = (text: string) => text.normalize("NFC").trim().replace(/\s+/g, " ");
const familyOrder = (id: SemanticFamilyId) => SEMANTIC_FAMILIES.findIndex(f => f.id === id);
const emptyScores = (): Record<SemanticFamilyId, number> => Object.fromEntries(SEMANTIC_FAMILIES.map(f => [f.id, 0])) as Record<SemanticFamilyId, number>;
const sortShares = (shares: AuroraColorShare[]) => shares.sort((a, b) => b.weight - a.weight || familyOrder(a.familyId) - familyOrder(b.familyId));
function sharesOf(scores: Record<SemanticFamilyId, number>): AuroraColorShare[] {
  const total = SEMANTIC_FAMILIES.reduce((sum, f) => sum + scores[f.id], 0);
  return total > 0 ? sortShares(SEMANTIC_FAMILIES.filter(f => scores[f.id] > 0).map(f => ({ familyId: f.id, weight: scores[f.id] / total }))) : [];
}
function validWeights(weights: readonly KeywordSemanticWeight[]): boolean {
  return Array.isArray(weights) && weights.length >= 1 && weights.length <= 2
    && weights.every((w, i) => w && SEMANTIC_FAMILIES.some(f => f.id === w.familyId)
      && w.role === (i === 0 ? "primary" : "secondary") && Number.isFinite(w.weight) && w.weight > 0 && w.weight <= 1)
    && new Set(weights.map(w => w.familyId)).size === weights.length
    && Math.abs(weights.reduce((sum, w) => sum + w.weight, 0) - 1) < 1e-9;
}
interface Collected { trace: AuroraQuestionTrace; textBySelection: Map<AuroraSelectionTrace, string> }
function collectQuestion(input: AuroraPersonalizationInput, options: AuroraPersonalizationOptions, index: number): Collected {
  const question = QUESTION_DATA[index];
  const responses = input.responses.filter(r => r.questionId === question.id);
  const issues = new Set<string>();
  const status = responses.length === 1 && ["answered", "skipped", "pending"].includes(responses[0].status) ? responses[0].status : "pending";
  if (responses.length !== 1) issues.add(responses.length ? "response-conflict" : "response-missing");
  if (responses.length === 1 && responses[0].status !== status) issues.add("invalid-response-status");
  const trace: AuroraQuestionTrace = { questionId: question.id as AuroraAnswerQuestionId, status, answerIntent: question.answerIntent,
    visualRole: question.visualRole, configuredCoreWeight: AURORA_CORE_QUESTION_WEIGHTS[question.id] ?? 0,
    effectiveCoreWeight: 0, selections: [], issues: [] };
  const groups = new Map<string, { selection: AuroraSelectionTrace; text: string; conflict: boolean }>();
  const items = input.selections[index] ?? [];
  if (status !== "answered") {
    if (items.length) issues.add("selections-ignored-for-response-status");
  } else {
    if (!items.length) issues.add("answered-without-selections");
    // Identity collisions are rejected rather than depending on the input order.
    const idCounts = new Map<string, number>();
    for (const item of items) idCounts.set(item.selectionId, (idCounts.get(item.selectionId) ?? 0) + 1);
    for (const item of items) {
      if (!item.id || !item.selectionId || typeof item.label !== "string" || !item.label.trim()
        || (item.originalText !== undefined && typeof item.originalText !== "string")
        || (item.questionId !== undefined && item.questionId !== question.id)
        || (item.answerIntent !== undefined && item.answerIntent !== question.answerIntent)
        || ![undefined, "preset", "custom"].includes(item.source)) { issues.add("invalid-selection-context"); continue; }
      if (idCounts.get(item.selectionId)! > 1) { issues.add("duplicate-selection-identity"); continue; }
      const originalText = item.originalText ?? item.label;
      const fixedById = question.keywords.find(k => k.id === item.id);
      const isFixed = item.source === "preset" || (item.source === undefined && !!fixedById);
      if (isFixed && (!fixedById || fixedById.label !== item.label || originalText !== fixedById.label)) {
        issues.add("fixed-keyword-integrity"); continue;
      }
      const exactCustom = !isFixed && originalText.trim() === item.label.trim()
        ? question.keywords.find(k => k.label === item.label.trim()) : undefined;
      const fixed = isFixed ? fixedById : exactCustom;
      let mapping: AuroraSelectionTrace["mapping"] = fixed ? isFixed ? "fixed" : "exact-custom" : "unclassified";
      let weights: readonly KeywordSemanticWeight[] = fixed ? KEYWORD_SEMANTICS[fixed.id] : [];
      if (!fixed) {
        const verified = (options.verifiedCustomMeanings ?? []).filter(v => v.questionId === question.id && v.selectionId === item.selectionId && v.originalText === originalText);
        if (verified.length === 1 && validWeights(verified[0].weights)) { mapping = "verified-custom"; weights = verified[0].weights; }
        else if (verified.length) issues.add("invalid-verified-custom-meaning");
        // Raw client semanticWeights never establish verified meaning.
        if (item.semanticWeights?.length) issues.add("unverified-client-weights-ignored");
      }
      const canonicalWeights = weights.map(w => ({ familyId: w.familyId, role: w.role, weight: w.weight }));
      const text = normalizeText(item.label);
      const key = fixed ? `fixed:${fixed.id}` : `custom:${text}`;
      const prior = groups.get(key);
      if (prior) {
        prior.selection.selectionIds = [...prior.selection.selectionIds, item.selectionId].sort(compare);
        prior.selection.keywordId = [prior.selection.keywordId, fixed?.id ?? item.id].sort(compare)[0];
        if (JSON.stringify(prior.selection.weights) !== JSON.stringify(canonicalWeights)) prior.conflict = true;
        if (mapping === "fixed") prior.selection.mapping = "fixed";
      } else groups.set(key, { text, conflict: false, selection: { keywordId: fixed?.id ?? item.id, selectionIds: [item.selectionId], mapping,
        weights: canonicalWeights, coreContributions: [] } });
    }
  }
  const selections = [...groups.entries()].sort(([a], [b]) => compare(a, b)).map(([, group]) => {
    if (group.conflict) { group.selection.mapping = "unclassified"; group.selection.weights = []; issues.add("conflicting-duplicate-meaning"); }
    return group;
  });
  trace.selections = selections.map(g => g.selection);
  trace.issues = [...issues].sort(compare);
  return { trace, textBySelection: new Map(selections.map(g => [g.selection, g.text])) };
}
function effectEvidence(question: AuroraQuestionTrace): AuroraEffectEvidence {
  const mapped = question.selections.filter(s => s.weights.length);
  const scores = emptyScores();
  for (const selection of mapped) for (const w of selection.weights) scores[w.familyId] += w.weight / mapped.length;
  return { questionId: question.questionId, answerIntent: question.answerIntent, status: question.status,
    active: mapped.length > 0, shares: sharesOf(scores), mappedSelectionCount: mapped.length,
    unclassifiedSelectionCount: question.selections.length - mapped.length };
}
/** Pure Q1–Q9 engine. No clocks, network, device hints, inference or input mutation. */
export function personalizeAurora(input: AuroraPersonalizationInput, options: AuroraPersonalizationOptions = {}): AuroraPersonalizationResult {
  const collected = QUESTION_DATA.slice(0, 9).map((_, i) => collectQuestion(input, options, i));
  const questions = collected.map(c => c.trace);
  const core = questions.filter(q => q.configuredCoreWeight > 0 && q.selections.some(s => s.weights.length));
  const weightTotal = core.reduce((sum, q) => sum + q.configuredCoreWeight, 0);
  const base = emptyScores();
  for (const question of core) {
    question.effectiveCoreWeight = question.configuredCoreWeight / weightTotal;
    const mapped = question.selections.filter(s => s.weights.length);
    for (const selection of mapped) {
      selection.coreContributions = selection.weights.map(w => ({ familyId: w.familyId, score: question.effectiveCoreWeight * w.weight / mapped.length }));
      for (const contribution of selection.coreContributions) base[contribution.familyId] += contribution.score;
    }
  }
  const emphasized = emptyScores();
  const families = SEMANTIC_FAMILIES.filter(f => base[f.id] > 0).map(f => {
    const evidenceQuestionIds = core.filter(q => q.selections.some(s => s.weights.some(w => w.familyId === f.id))).map(q => q.questionId);
    const repetitionMultiplier = auroraRepetitionMultiplier(evidenceQuestionIds.length);
    emphasized[f.id] = base[f.id] * repetitionMultiplier;
    return { familyId: f.id, baseScore: base[f.id], evidenceQuestionIds, repetitionMultiplier, emphasizedScore: emphasized[f.id], share: 0 };
  });
  const coreShares = sharesOf(emphasized);
  for (const family of families) family.share = coreShares.find(s => s.familyId === family.familyId)!.weight;
  let palette: AuroraColorShare[] = coreShares.map(s => ({ ...s }));
  let visualFallback: AuroraPersonalizationResult["trace"]["visualFallback"] = "none";
  const paletteOrigins: AuroraPersonalizationResult["trace"]["paletteOrigins"][number][] = palette.map(s => ({ familyId: s.familyId, origin: "answer" }));
  if (!palette.length) {
    visualFallback = "neutral-palette";
    palette = [{ familyId: "grounding", weight: .5, color: "#AEB9CC" }, { familyId: "reflection", weight: .5, color: "#91A6BE" }];
    paletteOrigins.push(...palette.map(s => ({ familyId: s.familyId, origin: "neutral-visual" as const })));
  } else if (palette.length === 1) {
    visualFallback = "neutral-accent";
    palette[0].weight = .92;
    const familyId = palette[0].familyId === "grounding" ? "serenity" : "grounding";
    palette.push({ familyId, weight: .08, color: "#AEB9CC" });
    paletteOrigins.push({ familyId, origin: "neutral-visual" });
  }
  const motion = { ...NEUTRAL_MOTION };
  if (coreShares.length) for (const key of ["speed", "amplitude", "flow", "intensity"] as const)
    motion[key] = coreShares.reduce((sum, share) => sum + share.weight * MOTION_BY_FAMILY[share.familyId][key]!, 0);
  const atmosphereEvidence = effectEvidence(questions[2]);
  const landscapes = questions[2].selections.filter(s => s.mapping === "fixed" || s.mapping === "exact-custom")
    .map(s => AURORA_ATMOSPHERE_BY_KEYWORD[s.keywordId]).filter(Boolean);
  const atmosphereParameters = { ...NEUTRAL_ATMOSPHERE };
  if (landscapes.length) for (const key of ["mistDensity", "brightness", "softness", "spread"] as const)
    atmosphereParameters[key] = landscapes.reduce((sum, p) => sum + p[key] / landscapes.length, 0);
  const pulse = effectEvidence(questions[6]), release = effectEvidence(questions[7]), expansion = effectEvidence(questions[8]);
  const share = (effect: AuroraEffectEvidence, familyId: SemanticFamilyId) => effect.shares.find(s => s.familyId === familyId)?.weight ?? 0;
  const texts = new Map<string, { questionIds: AuroraAnswerQuestionId[]; selectionIds: string[] }>();
  for (const c of collected.filter(c => c.trace.effectiveCoreWeight > 0)) for (const s of c.trace.selections.filter(s => s.weights.length)) {
    const text = c.textBySelection.get(s)!;
    const entry = texts.get(text) ?? { questionIds: [], selectionIds: [] };
    if (!entry.questionIds.includes(c.trace.questionId)) entry.questionIds.push(c.trace.questionId);
    entry.selectionIds.push(...s.selectionIds);
    texts.set(text, entry);
  }
  return {
    version: "aurora-personalization-v1", coreShares,
    appearance: { palette, motion, ribbonCount: !coreShares.length ? 3 : coreShares.length === 1 ? 2 : coreShares.length >= 4 ? 4 : 3 },
    atmosphere: { ...atmosphereEvidence, questionId: "q3", active: atmosphereEvidence.active && landscapes.length > 0,
      parametersOrigin: landscapes.length ? "explicit-landscape" : "neutral-visual", ...atmosphereParameters },
    innerPulse: { ...pulse, questionId: "q7", glow: pulse.active ? .16 + .06 * share(pulse, "connection") : 0,
      breathAmplitude: pulse.active ? .06 + .04 * share(pulse, "serenity") : 0, periodSeconds: 14 + 4 * share(pulse, "serenity") },
    releaseFragments: { ...release, questionId: "q8", direction: "radial-outward", outwardSpeed: release.active ? .06 + .04 * share(release, "drive") : 0,
      fadeRate: release.active ? .05 + .02 * share(release, "reflection") : 0, spread: release.active ? .35 + .15 * share(release, "grounding") : 0 },
    outerExpansion: { ...expansion, questionId: "q9", direction: "outward", rate: expansion.active ? .08 + .06 * share(expansion, "drive") : 0,
      reach: expansion.active ? .30 + .20 * share(expansion, "exploration") : 0, coherence: expansion.active ? .50 + .15 * share(expansion, "reflection") : 0 },
    approvedTitle: null,
    inputState: {
      answeredQuestionIds: questions.filter(q => q.status === "answered").map(q => q.questionId),
      skippedQuestionIds: questions.filter(q => q.status === "skipped").map(q => q.questionId),
      pendingQuestionIds: questions.filter(q => q.status === "pending").map(q => q.questionId),
      participatingCoreQuestionIds: core.map(q => q.questionId), coreData: core.length === 5 ? "complete" : core.length ? "partial" : "none",
      unclassified: questions.flatMap(q => q.selections.filter(s => !s.weights.length).map(s => ({ questionId: q.questionId, selectionIds: [...s.selectionIds] }))),
    },
    trace: { questions, families, visualFallback, paletteOrigins,
      repeatedTexts: [...texts.entries()].sort(([a], [b]) => compare(a, b)).filter(([, e]) => e.questionIds.length > 1)
        .map(([, e]) => ({ questionIds: e.questionIds, selectionIds: e.selectionIds.sort(compare) })) },
  };
}
/** Future 5-B entry point; never accepts an arbitrary title or an unapproved draft. */
export function personalizeAuroraFromQuestionnaire(state: QuestionnaireState, options: AuroraPersonalizationOptions = {}): AuroraPersonalizationResult {
  const result = personalizeAurora(state, options);
  const approved = getApprovedClosingMessage(state);
  if (approved && validFinalClosingText(approved.text)) result.approvedTitle = { text: approved.text, source: approved.source };
  return result;
}
