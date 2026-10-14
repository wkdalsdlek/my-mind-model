import type { AuroraAppearance, AuroraColorShare } from "./aurora-types";
import type { SelectedCapsule } from "./capsules";
import type { ClosingMessageSource } from "./closing-message";
import type { AnswerIntent, QuestionId, VisualRole } from "./question-data";
import type { QuestionResponseStatus } from "./questionnaire-state";
import type { KeywordSemanticWeight, SemanticFamilyId } from "./semantic-families";

export type AuroraAnswerQuestionId = Exclude<QuestionId, "q10">;
export interface AuroraPersonalizationInput {
  /** Existing questionnaire layout: row 0 is Q1, row 8 is Q9. Q10 is ignored. */
  selections: readonly (readonly SelectedCapsule[])[];
  responses: readonly { questionId: string; status: QuestionResponseStatus }[];
}
/** Optional caller-curated evidence, NOT a transport for unverified client weights.
 * Verification must bind question, selection identity and exact original text.
 * Structural validation by this engine does not verify psychological meaning. */
export interface VerifiedAuroraCustomMeaning {
  questionId: AuroraAnswerQuestionId;
  selectionId: string;
  originalText: string;
  weights: readonly KeywordSemanticWeight[];
}
export interface AuroraPersonalizationOptions {
  verifiedCustomMeanings?: readonly VerifiedAuroraCustomMeaning[];
}
export interface AuroraSelectionTrace {
  keywordId: string;
  selectionIds: readonly string[];
  mapping: "fixed" | "exact-custom" | "verified-custom" | "unclassified";
  weights: readonly KeywordSemanticWeight[];
  /** Before repetition emphasis and final normalization; empty for non-core roles. */
  coreContributions: readonly { familyId: SemanticFamilyId; score: number }[];
}
export interface AuroraQuestionTrace {
  questionId: AuroraAnswerQuestionId;
  status: QuestionResponseStatus;
  answerIntent: AnswerIntent;
  visualRole: VisualRole;
  configuredCoreWeight: number;
  effectiveCoreWeight: number;
  selections: readonly AuroraSelectionTrace[];
  issues: readonly string[];
}
export interface AuroraFamilyTrace {
  familyId: SemanticFamilyId;
  baseScore: number;
  evidenceQuestionIds: readonly AuroraAnswerQuestionId[];
  repetitionMultiplier: number;
  emphasizedScore: number;
  share: number;
}
export interface AuroraEffectEvidence {
  questionId: AuroraAnswerQuestionId;
  answerIntent: AnswerIntent;
  status: QuestionResponseStatus;
  active: boolean;
  /** Meaning within this question's role, NEVER current trait scores. */
  shares: readonly AuroraColorShare[];
  mappedSelectionCount: number;
  unclassifiedSelectionCount: number;
}
export interface AuroraAtmosphere extends AuroraEffectEvidence {
  questionId: "q3";
  parametersOrigin: "explicit-landscape" | "neutral-visual";
  mistDensity: number;
  brightness: number;
  softness: number;
  spread: number;
}
export interface AuroraInnerPulse extends AuroraEffectEvidence {
  questionId: "q7";
  glow: number;
  breathAmplitude: number;
  periodSeconds: number;
}
export interface AuroraReleaseFragments extends AuroraEffectEvidence {
  questionId: "q8";
  direction: "radial-outward";
  outwardSpeed: number;
  fadeRate: number;
  spread: number;
}
export interface AuroraOuterExpansion extends AuroraEffectEvidence {
  questionId: "q9";
  direction: "outward";
  rate: number;
  reach: number;
  coherence: number;
}
export interface AuroraPersonalizationResult {
  version: "aurora-personalization-v1";
  appearance: AuroraAppearance;
  /** Genuine answer-derived ratios. May be empty or a single family. */
  coreShares: readonly AuroraColorShare[];
  atmosphere: AuroraAtmosphere;
  innerPulse: AuroraInnerPulse;
  releaseFragments: AuroraReleaseFragments;
  outerExpansion: AuroraOuterExpansion;
  /** Only the questionnaire adapter can populate this via getApprovedClosingMessage. */
  approvedTitle: { text: string; source: ClosingMessageSource } | null;
  inputState: {
    answeredQuestionIds: readonly AuroraAnswerQuestionId[];
    skippedQuestionIds: readonly AuroraAnswerQuestionId[];
    pendingQuestionIds: readonly AuroraAnswerQuestionId[];
    participatingCoreQuestionIds: readonly AuroraAnswerQuestionId[];
    coreData: "none" | "partial" | "complete";
    unclassified: readonly { questionId: AuroraAnswerQuestionId; selectionIds: readonly string[] }[];
  };
  trace: {
    questions: readonly AuroraQuestionTrace[];
    families: readonly AuroraFamilyTrace[];
    /** Same normalized wording across DISTINCT core questions. No extra score multiplier. */
    repeatedTexts: readonly { questionIds: readonly AuroraAnswerQuestionId[]; selectionIds: readonly string[] }[];
    visualFallback: "none" | "neutral-palette" | "neutral-accent";
    paletteOrigins: readonly { familyId: SemanticFamilyId; origin: "answer" | "neutral-visual" }[];
  };
}
