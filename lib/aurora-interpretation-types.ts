import type { ClosingMessageInput, ApprovedClosingMessage } from "./closing-message";
import type { AuroraPersonalizationResult } from "./aurora-personalization-types";
import type { AuroraRibbonMeaning } from "./aurora-ribbon-meaning-types";
import type { AuroraFlowMode, AuroraQuality } from "./aurora-types";
import type { AnswerIntent, QuestionId } from "./question-data";
import type { InspiredPhilosophyLine, VerifiedPhilosophyQuote } from "./philosophy-quotes";
import type { AuroraSelectionTrace } from "./aurora-personalization-types";

/** No appearance, weights, prompt, model, quote content, or computed meaning accepted from clients. */
export interface AuroraInterpretationRequest {
  version: "aurora-interpretation-request-v1";
  closingInput: ClosingMessageInput;
  approval: ApprovedClosingMessage;
  quality: AuroraQuality;
  flowMode: AuroraFlowMode;
}
export interface AuroraInterpretationEvidence {
  ref: string;
  questionId: QuestionId;
  role: "core" | "currentAtmosphere" | "emotionalWish" | "releaseTarget" | "futureAspiration" | "closingMessage";
  answerIntent: AnswerIntent;
  keywordId: string | null;
  selectionId: string | null;
  label: string;
  originalText: string;
  mapping: "fixed" | "exact-custom" | "unclassified" | "approved-sentence";
  /** Non-core weights describe the question's context, never a current trait. */
  semanticWeights: AuroraSelectionTrace["weights"];
  coreContributions: AuroraSelectionTrace["coreContributions"];
}
export interface AuroraRibbonInterpretationFacts extends Pick<AuroraRibbonMeaning,
  "ribbonId" | "name" | "kind" | "representativeFamily" | "meaningStatus" | "composition" | "paletteOrigins" | "repetitions" | "repeatedTexts" | "layers" | "visualExplanation"> {
  evidence: readonly AuroraInterpretationEvidence[];
  visualExplanationText: { origin: "deterministic-code"; semantic: string; artistic: string; limitations: string };
}
export interface AuroraInterpretationFacts {
  origin: "deterministic-engines";
  coreShares: AuroraPersonalizationResult["coreShares"];
  familyTrace: AuroraPersonalizationResult["trace"]["families"];
  repeatedTexts: AuroraPersonalizationResult["trace"]["repeatedTexts"];
  context: Pick<AuroraPersonalizationResult, "atmosphere" | "innerPulse" | "releaseFragments" | "outerExpansion"> & { rendererApplied: false };
  questions: readonly { questionId: QuestionId; prompt: string; answerIntent: AnswerIntent; status: "answered" | "skipped"; evidence: readonly AuroraInterpretationEvidence[] }[];
  unclassified: readonly AuroraInterpretationEvidence[];
  ribbons: readonly AuroraRibbonInterpretationFacts[];
  familiesWithoutActiveRibbonColor: readonly string[];
}
export interface AuroraInterpretationBinding {
  requestDigest: string;
  quality: AuroraQuality;
  flowMode: AuroraFlowMode;
  catalogVersion: "philosophy-quotes-v1";
}
export interface AuroraInterpretationContext {
  binding: AuroraInterpretationBinding;
  approvedClosing: { text: string; source: ApprovedClosingMessage["source"] };
  facts: AuroraInterpretationFacts;
}
export interface GroundedAuroraText {
  origin: "ai-interpretation" | "deterministic-insufficient-evidence";
  text: string;
  evidenceRefs: readonly string[];
  basis: "answer-grounded" | "insufficient-evidence";
}
/** Text is AI interpretation; citations, names, quotes, IDs, colors and parameters are server facts. */
export interface AuroraInterpretationResult extends AuroraInterpretationContext {
  version: "aurora-interpretation-v1";
  generated: {
    origin: "ai-interpretation";
    auroraName: string;
    philosophy: { line: VerifiedPhilosophyQuote | InspiredPhilosophyLine; reason: readonly string[]; q10Anchor: string };
    overall: GroundedAuroraText;
    ribbons: readonly {
      ribbonId: AuroraRibbonMeaning["ribbonId"];
      psychological: GroundedAuroraText;
      philosophical: GroundedAuroraText;
      reflectionQuestion: string;
    }[];
  };
}
