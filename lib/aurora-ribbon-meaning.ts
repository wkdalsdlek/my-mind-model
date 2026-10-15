import { auroraEnergyProfiles } from "./aurora-energy";
import { createAuroraRibbonLayout } from "./aurora-ribbon-layout";
import { AURORA_CORE_QUESTION_WEIGHTS, auroraRepetitionMultiplier, personalizeAurora } from "./aurora-personalization";
import type { AuroraPersonalizationResult, AuroraSelectionTrace } from "./aurora-personalization-types";
import { validateAuroraAnalysisResponse, type AuroraCompletedResult } from "./aurora-result";
import { AURORA_DEFAULT_FLOW_MODE, validateAuroraAppearance } from "./aurora-types";
import { QUESTION_DATA } from "./question-data";
import { SEMANTIC_FAMILIES } from "./semantic-families";
import { getApprovedClosingMessage, serializeLegacyAnswers, type QuestionnaireState } from "./questionnaire-state";
import type { AuroraRibbonAnalysisReference, AuroraRibbonMeaning, AuroraRibbonMeaningMap,
  AuroraRibbonMeaningOptions, AuroraRibbonSelectionEvidence } from "./aurora-ribbon-meaning-types";

const copy = <T>(value: T): T => structuredClone(value);
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const positive = (n: number) => Number.isFinite(n) && n > 0;
/** Canonical equality is local only, never serialized into logs or UI. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, v]) => `${JSON.stringify(key)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}
const bindingData = (p: AuroraPersonalizationResult) => ({ appearance: p.appearance, coreShares: p.coreShares, trace: p.trace });
/** Defensively refuse missing/inconsistent provenance instead of interpreting palette colors. */
function hasProvenance(p: AuroraPersonalizationResult): boolean {
  try {
    const { questions, families, paletteOrigins } = p.trace;
    if (p.version !== "aurora-personalization-v1" || questions.length !== 9 || families.length !== p.coreShares.length
      || paletteOrigins.length !== p.appearance.palette.length || !Array.isArray(p.trace.repeatedTexts)) return false;
    if (p.coreShares.length && !near(p.coreShares.reduce((sum, s) => sum + s.weight, 0), 1)) return false;
    if (new Set(p.coreShares.map(s => s.familyId)).size !== p.coreShares.length) return false;
    if (new Set(families.map(f => f.familyId)).size !== families.length) return false;
    for (const [i, q] of questions.entries()) {
      const definition = QUESTION_DATA[i];
      if (q.questionId !== definition.id || q.answerIntent !== definition.answerIntent || q.visualRole !== definition.visualRole
        || !["answered", "skipped", "pending"].includes(q.status) || !Array.isArray(q.selections)) return false;
      if (q.configuredCoreWeight !== (AURORA_CORE_QUESTION_WEIGHTS[q.questionId] ?? 0)
        || !Number.isFinite(q.effectiveCoreWeight) || q.effectiveCoreWeight < 0 || q.effectiveCoreWeight > 1
        || q.status !== "answered" && q.selections.length) return false;
      const mappedCount = q.selections.filter(s => s.weights.length).length;
      for (const s of q.selections) {
        if (!Array.isArray(s.selectionIds) || !s.selectionIds.length || new Set(s.selectionIds).size !== s.selectionIds.length
          || !s.selectionIds.every((id: unknown) => typeof id === "string" && id.length) || !Array.isArray(s.coreContributions)
          || !["fixed", "exact-custom", "verified-custom", "unclassified"].includes(s.mapping)) return false;
        if (s.mapping === "unclassified" && (s.weights.length || s.coreContributions.length)) return false;
        if (q.effectiveCoreWeight > 0 && s.weights.length) {
          if (s.coreContributions.length !== s.weights.length) return false;
          for (const [index, c] of s.coreContributions.entries()) if (c.familyId !== s.weights[index].familyId || !positive(c.score)
            || !near(c.score, q.effectiveCoreWeight * s.weights[index].weight / mappedCount)) return false;
        } else if (s.coreContributions.length) return false;
      }
      if (["q3", "q7", "q8", "q9"].includes(q.questionId) && (q.effectiveCoreWeight !== 0 || q.selections.some(s => s.coreContributions.length))) return false;
    }
    const total = families.reduce((sum, f) => sum + f.emphasizedScore, 0);
    for (const share of p.coreShares) {
      const f = families.find(f => f.familyId === share.familyId);
      if (!f || !SEMANTIC_FAMILIES.some(f => f.id === share.familyId) || !positive(share.weight)
        || !positive(f.baseScore) || !positive(f.repetitionMultiplier) || !positive(f.emphasizedScore)
        || !near(f.emphasizedScore, f.baseScore * f.repetitionMultiplier) || !near(f.share, share.weight)
        || !near(f.emphasizedScore / total, share.weight)) return false;
      const evidenceIds = questions.filter(q => q.effectiveCoreWeight > 0 && q.selections.some(s => s.weights.some(w => w.familyId === share.familyId))).map(q => q.questionId);
      if (canonical(f.evidenceQuestionIds) !== canonical(evidenceIds) || f.repetitionMultiplier !== auroraRepetitionMultiplier(evidenceIds.length)) return false;
      const base = questions.reduce((sum, q) => sum + q.selections.reduce((sub, s) => sub + s.coreContributions
        .filter(c => c.familyId === share.familyId).reduce((sub, c) => sub + c.score, 0), 0), 0);
      if (!near(base, f.baseScore)) return false;
    }
    return p.appearance.palette.every((s, i) => paletteOrigins[i].familyId === s.familyId
      && (paletteOrigins[i].origin === "neutral-visual" || paletteOrigins[i].origin === "answer" && p.coreShares.some(c => c.familyId === s.familyId)));
  } catch { return false; }
}
/** Pure mapping. Callers may omit selection text; absent text never becomes invented evidence. */
export function buildAuroraRibbonMeaningMap(p: AuroraPersonalizationResult | null | undefined, options: AuroraRibbonMeaningOptions = {}): AuroraRibbonMeaningMap {
  const quality = options.quality ?? "balanced", flowMode = options.flowMode ?? AURORA_DEFAULT_FLOW_MODE;
  const result: AuroraRibbonMeaningMap = { version: "aurora-ribbon-meaning-v1", idScope: "result-snapshot", status: "unavailable",
    sourceBinding: "missing", issues: [], quality, flowMode, ribbons: [], activeRibbonCount: 0, activeMeshCount: 0,
    mountedMeshCount: 0, renderSequence: [], familiesWithoutActiveRibbonColor: [], globalMotionEvidence: [], globalMotionRepetitions: [],
    globalMotionAnalyses: [], unclassifiedSelections: [], nonCoreContext: [], contextualAnalyses: [] };
  if (!p) return { ...result, issues: ["personalization-missing"] };
  if (validateAuroraAppearance(p.appearance).length) return { ...result, issues: ["appearance-invalid"] };
  let layout: ReturnType<typeof createAuroraRibbonLayout>;
  try { layout = createAuroraRibbonLayout(p.appearance, quality, flowMode); }
  catch { return { ...result, issues: ["layout-invalid"] }; }
  const issues: AuroraRibbonMeaningMap["issues"][number][] = [];
  const provenance = hasProvenance(p);
  if (!provenance) issues.push("provenance-unavailable");
  let sourceBinding: AuroraRibbonMeaningMap["sourceBinding"] = "missing";
  if (options.source) {
    try {
      const replay = personalizeAurora(options.source, options.personalizationOptions);
      sourceBinding = canonical(bindingData(replay)) === canonical(bindingData(p)) ? "meaning-replay-matched" : "mismatch";
      if (sourceBinding === "mismatch") issues.push("source-mismatch");
    } catch { sourceBinding = "invalid"; issues.push("source-invalid"); }
  }
  const texts = (questionId: string, selection: Pick<AuroraSelectionTrace, "selectionIds">): AuroraRibbonSelectionEvidence["texts"] => {
    if (sourceBinding !== "meaning-replay-matched") return [];
    const index = QUESTION_DATA.findIndex(q => q.id === questionId);
    return selection.selectionIds.flatMap(id => {
      const item = options.source!.selections[index]?.find(s => s.selectionId === id);
      return item ? [{ selectionId: id, label: item.label, originalText: item.originalText ?? item.label, source: item.source ?? "unspecified" }] : [];
    });
  };
  const families = provenance ? p.trace.families : [];
  const totalEmphasized = families.reduce((sum, f) => sum + f.emphasizedScore, 0);
  const coreShares = provenance ? p.coreShares : [];
  const collectEvidence = (shares: AuroraPersonalizationResult["coreShares"], pairTotal: number) => {
    const evidence: AuroraRibbonSelectionEvidence[] = [];
    if (provenance) for (const q of p.trace.questions.filter(q => q.effectiveCoreWeight > 0 && q.status === "answered")) {
      for (const s of q.selections) {
        const contributions = s.coreContributions.filter(c => shares.some(share => share.familyId === c.familyId) && positive(c.score)).map(c => {
          const family = families.find(f => f.familyId === c.familyId)!;
          const emphasizedScore = c.score * family.repetitionMultiplier;
          return { familyId: c.familyId, baseScore: c.score, repetitionMultiplier: family.repetitionMultiplier, emphasizedScore,
            globalShareContribution: emphasizedScore / totalEmphasized, withinPairContribution: emphasizedScore / totalEmphasized / pairTotal };
        });
        if (contributions.length) evidence.push({ questionId: q.questionId, prompt: QUESTION_DATA.find(d => d.id === q.questionId)!.prompt,
          answerIntent: q.answerIntent, visualRole: q.visualRole, keywordId: s.keywordId, selectionIds: [...s.selectionIds], mapping: s.mapping,
          configuredCoreWeight: q.configuredCoreWeight, effectiveCoreWeight: q.effectiveCoreWeight, texts: texts(q.questionId, s), contributions });
      }
    }
    return evidence;
  };
  const globalMotionEvidence = collectEvidence(coreShares, 1).map(e => ({ ...e, contributions: e.contributions.map(c => ({
    familyId: c.familyId, baseScore: c.baseScore, repetitionMultiplier: c.repetitionMultiplier,
    emphasizedScore: c.emphasizedScore, globalShareContribution: c.globalShareContribution })) }));
  const ribbons = layout.ribbons.map((slot): AuroraRibbonMeaning => {
    const visual = slot.layers[0].visual;
    const pair = [visual.colorA, visual.colorB];
    const origins = pair.map(color => ({ paletteIndex: color.paletteIndex, familyId: color.familyId,
      origin: provenance ? p.trace.paletteOrigins[color.paletteIndex].origin : "unknown" as const }));
    const shares = coreShares.filter(s => origins.some(o => o.familyId === s.familyId && o.origin === "answer"));
    const pairTotal = shares.reduce((sum, s) => sum + s.weight, 0);
    const composition = shares.map(s => ({ familyId: s.familyId, label: SEMANTIC_FAMILIES.find(f => f.id === s.familyId)!.label,
      globalCoreShare: s.weight, withinPairShare: s.weight / pairTotal }));
    const evidence = collectEvidence(shares, pairTotal);
    const evidenceIds = new Set(evidence.flatMap(e => e.selectionIds));
    const repeatedTexts = provenance ? p.trace.repeatedTexts.map(repeat => ({
      questionIds: repeat.questionIds.filter(id => evidence.some(e => e.questionId === id && e.selectionIds.some(s => repeat.selectionIds.includes(s)))),
      selectionIds: repeat.selectionIds.filter(id => evidenceIds.has(id)),
    })).filter(r => r.questionIds.length > 1) : [];
    const role = slot.kind === "loop" ? "연결 루프" : "리본";
    return { ...slot, name: `${composition.length ? composition.map(s => s.label).join(" · ") : provenance ? "중립 빛" : "의미 미확인 빛"} ${role} ${slot.slot + 1}`,
      representativeFamily: composition[0]?.familyId ?? null, meaningStatus: composition.length ? "derived" : provenance ? "neutral" : "unavailable",
      compositionBasis: "core-shares-within-color-pair", composition, paletteOrigins: origins, evidenceScope: "direct-color-pair", evidence,
      repetitions: copy(families.filter(f => shares.some(s => s.familyId === f.familyId))), repeatedTexts,
      interpretation: { questionAnalyses: [], ribbonSynthesis: { status: "not-generated", requiresSeparateGeneration: true } },
      visualExplanation: { globalMotion: copy(p.appearance.motion), globalMotionFamilyShares: copy(coreShares), globalMotionEvidenceRef: "map.globalMotionEvidence",
        energySeed: slot.layers[0].shape.energySeed, energyProfiles: auroraEnergyProfiles(slot.layers[0].shape.energySeed),
        energyOrigin: "renderer-slot-seed", individualShapeOrigin: "phase-4-slot-design", colorAreaFractionsAvailable: false } };
  });
  return { ...result, status: "ready", sourceBinding, issues, quality: layout.quality, flowMode: layout.flowMode, ribbons,
    globalMotionEvidence, globalMotionRepetitions: copy(families),
    activeRibbonCount: layout.activeRibbonCount, activeMeshCount: layout.activeMeshCount, mountedMeshCount: layout.mountedMeshCount, renderSequence: layout.renderSequence,
    familiesWithoutActiveRibbonColor: coreShares.filter(s => !ribbons.some(r => r.active && r.composition.some(c => c.familyId === s.familyId))).map(s => s.familyId),
    unclassifiedSelections: provenance ? p.trace.questions.flatMap(q => q.selections.filter(s => s.mapping === "unclassified").map(s => ({
      questionId: q.questionId, selectionIds: [...s.selectionIds], texts: texts(q.questionId, s), meaning: "unclassified" as const }))) : [],
    nonCoreContext: provenance ? p.trace.questions.filter(q => ["q3", "q7", "q8", "q9"].includes(q.questionId)).map(q => ({
      questionId: q.questionId, answerIntent: q.answerIntent, visualRole: q.visualRole, status: q.status, rendererApplied: false as const })) : [] };
}

/** Reuse only snapshot-bound Q1–Q10 analysis. Whole-question text is never relabeled as ribbon-specific AI output. */
export function buildAuroraRibbonMeaningFromResult(completed: AuroraCompletedResult,
  options: Omit<AuroraRibbonMeaningOptions, "source"> & { source?: QuestionnaireState } = {}): AuroraRibbonMeaningMap {
  let map = buildAuroraRibbonMeaningMap(completed.snapshot.personalization, options);
  if (options.source && map.sourceBinding === "meaning-replay-matched") {
    let snapshotMatches = false;
    try {
      const approved = getApprovedClosingMessage(options.source);
      snapshotMatches = !!approved && approved.inputFingerprint === completed.snapshot.inputFingerprint
        && approved.text === completed.snapshot.personalization.approvedTitle?.text
        && canonical(serializeLegacyAnswers(options.source)) === canonical(completed.snapshot.answers);
    } catch { /* Missing approval never establishes exact original-text provenance. */ }
    map = snapshotMatches ? { ...map, sourceBinding: "snapshot-verified" } : { ...map, sourceBinding: "mismatch",
      issues: [...map.issues, "source-mismatch"], ribbons: map.ribbons.map(r => ({ ...r, evidence: r.evidence.map(e => ({ ...e, texts: [] })) })),
      globalMotionEvidence: map.globalMotionEvidence.map(e => ({ ...e, texts: [] })),
      unclassifiedSelections: map.unclassifiedSelections.map(s => ({ ...s, texts: [] })) };
  }
  const validated = validateAuroraAnalysisResponse({ comments: completed.comments });
  const answers = completed.snapshot.answers;
  if (!validated.valid || !Array.isArray(answers) || answers.length !== 10 || answers.some(a => typeof a !== "string")) return { ...map, issues: [...map.issues, "analysis-unavailable"] };
  const analyses: AuroraRibbonAnalysisReference[] = validated.comments.map((comment, i) => ({ questionId: QUESTION_DATA[i].id,
    prompt: QUESTION_DATA[i].prompt, answerIntent: QUESTION_DATA[i].answerIntent, actualAnswer: answers[i], ...comment,
    scope: "whole-question", origin: "existing-analysis" }));
  return { ...map, ribbons: map.ribbons.map(r => ({ ...r, interpretation: { ...r.interpretation,
    questionAnalyses: analyses.filter(a => r.evidence.some(e => e.questionId === a.questionId)) } })),
    globalMotionAnalyses: analyses.filter(a => map.globalMotionEvidence.some(e => e.questionId === a.questionId)),
    contextualAnalyses: analyses.filter(a => ["q3", "q7", "q8", "q9", "q10"].includes(a.questionId)) };
}
