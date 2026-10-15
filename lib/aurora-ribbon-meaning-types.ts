import type { AuroraAppearance } from "./aurora-types";
import type { AuroraRibbonSlot } from "./aurora-ribbon-layout";
import type { AuroraEnergyProfile } from "./aurora-energy";
import type { AuroraAnswerQuestionId, AuroraFamilyTrace, AuroraPersonalizationInput, AuroraPersonalizationOptions,
  AuroraPersonalizationResult, AuroraQuestionTrace, AuroraSelectionTrace } from "./aurora-personalization-types";
import type { SemanticFamilyId } from "./semantic-families";
import type { QuestionId } from "./question-data";
import type { KeywordSource } from "./capsules";

export interface AuroraRibbonMeaningOptions {
  quality?: "low" | "balanced" | "high";
  flowMode?: "independent" | "hybrid" | "loop-emphasis";
  /** Caller-supplied selection records, matched to the unchanged 5-A meaning trace.
   * This replay alone cannot prove original whitespace/unclassified text. The completed
   * result adapter additionally verifies the existing approval fingerprint. */
  source?: AuroraPersonalizationInput;
  personalizationOptions?: AuroraPersonalizationOptions;
}
export interface AuroraRibbonMeaningShare {
  familyId: SemanticFamilyId;
  label: string;
  globalCoreShare: number;
  /** Renormalized core shares within the two actual color endpoints. NOT pixel area. */
  withinPairShare: number;
}
export interface AuroraRibbonSelectionEvidence {
  questionId: AuroraAnswerQuestionId;
  prompt: string;
  answerIntent: AuroraQuestionTrace["answerIntent"];
  visualRole: AuroraQuestionTrace["visualRole"];
  keywordId: string;
  selectionIds: readonly string[];
  mapping: AuroraSelectionTrace["mapping"];
  configuredCoreWeight: number;
  effectiveCoreWeight: number;
  texts: readonly { selectionId: string; label: string; originalText: string; source: KeywordSource | "unspecified" }[];
  contributions: readonly { familyId: SemanticFamilyId; baseScore: number; repetitionMultiplier: number;
    emphasizedScore: number; globalShareContribution: number; withinPairContribution: number }[];
}
export interface AuroraRibbonAnalysisReference {
  questionId: QuestionId;
  prompt: string;
  answerIntent: string;
  actualAnswer: string;
  analysis: string;
  detailedAnalysis: string;
  scope: "whole-question";
  /** Reuse the existing analysis verbatim; it is not a generated ribbon-specific claim. */
  origin: "existing-analysis";
}
export type AuroraGlobalMotionEvidence = Omit<AuroraRibbonSelectionEvidence, "contributions"> & {
  contributions: readonly Omit<AuroraRibbonSelectionEvidence["contributions"][number], "withinPairContribution">[];
};
export interface AuroraRibbonMeaning extends AuroraRibbonSlot {
  name: string;
  representativeFamily: SemanticFamilyId | null;
  meaningStatus: "derived" | "neutral" | "unavailable";
  compositionBasis: "core-shares-within-color-pair";
  composition: readonly AuroraRibbonMeaningShare[];
  paletteOrigins: readonly { paletteIndex: number; familyId: SemanticFamilyId; origin: "answer" | "neutral-visual" | "unknown" }[];
  evidenceScope: "direct-color-pair";
  evidence: readonly AuroraRibbonSelectionEvidence[];
  repetitions: readonly AuroraFamilyTrace[];
  repeatedTexts: readonly { questionIds: readonly AuroraAnswerQuestionId[]; selectionIds: readonly string[] }[];
  interpretation: {
    questionAnalyses: readonly AuroraRibbonAnalysisReference[];
    ribbonSynthesis: { status: "not-generated"; requiresSeparateGeneration: true };
  };
  visualExplanation: {
    globalMotion: AuroraAppearance["motion"];
    globalMotionFamilyShares: AuroraPersonalizationResult["coreShares"];
    globalMotionEvidenceRef: "map.globalMotionEvidence";
    energySeed: number;
    energyProfiles: readonly AuroraEnergyProfile[];
    energyOrigin: "renderer-slot-seed";
    individualShapeOrigin: "phase-4-slot-design";
    colorAreaFractionsAvailable: false;
  };
}
export type AuroraRibbonMeaningIssue = "personalization-missing" | "appearance-invalid" | "provenance-unavailable"
  | "source-mismatch" | "source-invalid" | "analysis-unavailable" | "layout-invalid";
export interface AuroraRibbonMeaningMap {
  version: "aurora-ribbon-meaning-v1";
  status: "ready" | "unavailable";
  /** IDs are scoped to a result snapshot. Reusing a slot ID across new answers is not a match. */
  idScope: "result-snapshot";
  sourceBinding: "meaning-replay-matched" | "snapshot-verified" | "missing" | "mismatch" | "invalid";
  issues: readonly AuroraRibbonMeaningIssue[];
  quality: NonNullable<AuroraRibbonMeaningOptions["quality"]>;
  flowMode: NonNullable<AuroraRibbonMeaningOptions["flowMode"]>;
  ribbons: readonly AuroraRibbonMeaning[];
  activeRibbonCount: number;
  activeMeshCount: number;
  mountedMeshCount: number;
  renderSequence: readonly string[];
  /** Honest gap: these families do not occur in any currently active ribbon's color pair. */
  familiesWithoutActiveRibbonColor: readonly SemanticFamilyId[];
  /** Shared motion affects every ribbon, including families outside a ribbon's color pair. */
  globalMotionEvidence: readonly AuroraGlobalMotionEvidence[];
  globalMotionRepetitions: readonly AuroraFamilyTrace[];
  globalMotionAnalyses: readonly AuroraRibbonAnalysisReference[];
  unclassifiedSelections: readonly { questionId: AuroraAnswerQuestionId; selectionIds: readonly string[];
    texts: AuroraRibbonSelectionEvidence["texts"]; meaning: "unclassified" }[];
  nonCoreContext: readonly { questionId: AuroraAnswerQuestionId; answerIntent: AuroraQuestionTrace["answerIntent"];
    visualRole: AuroraQuestionTrace["visualRole"]; status: AuroraQuestionTrace["status"]; rendererApplied: false }[];
  contextualAnalyses: readonly AuroraRibbonAnalysisReference[];
}
