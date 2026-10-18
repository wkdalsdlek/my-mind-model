import type { ClosingMessageInput, ApprovedClosingMessage } from "./closing-message";
import type { AuroraPersonalizationResult } from "./aurora-personalization-types";
import type { AuroraRibbonMeaning } from "./aurora-ribbon-meaning-types";
import type { AuroraFlowMode, AuroraQuality } from "./aurora-types";
import type { AnswerIntent, QuestionId } from "./question-data";
import type { InspiredPhilosophyLine, VerifiedPhilosophyQuote } from "./philosophy-quotes";
import type { AuroraSelectionTrace } from "./aurora-personalization-types";

/** No appearance, weights, prompt, model, quote content, or computed meaning accepted from clients. */
export interface AuroraInterpretationRequest {
  version: "aurora-interpretation-request-v1" | "aurora-interpretation-request-v2";
  /** Required for v2, forbidden for v1 by boundary validation. */
  situation?: string;
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
  situation?: { ref: "situation:intro"; rawText: string };
  binding: AuroraInterpretationBinding;
  approvedClosing: { text: string; source: ApprovedClosingMessage["source"] };
  facts: AuroraInterpretationFacts;
}
export interface GroundedAuroraText {
  origin: "ai-interpretation" | "deterministic-insufficient-evidence";
  /** Contextual reference, never a core meaning contribution. Required in v2. */
  contextRefs?: readonly "situation:intro"[];
  text: string;
  evidenceRefs: readonly string[];
  basis: "answer-grounded" | "insufficient-evidence";
}
/** Text is AI interpretation; citations, names, quotes, IDs, colors and parameters are server facts. */
export interface AuroraInterpretationResult extends AuroraInterpretationContext {
  version: "aurora-interpretation-v1" | "aurora-interpretation-v2";
  generated: {
    origin: "ai-interpretation";
    auroraName: string;
    philosophy: { line: VerifiedPhilosophyQuote | InspiredPhilosophyLine; reason: readonly string[]; q10Anchor: string };
    overall: GroundedAuroraText;
    report?: Record<AuroraReportSection, GroundedAuroraText>;
    ribbons: readonly {
      ribbonId: AuroraRibbonMeaning["ribbonId"];
      psychological: GroundedAuroraText;
      philosophical: GroundedAuroraText;
      currentMind?: GroundedAuroraText;
      reportSummary?: GroundedAuroraText;
      reflectionQuestion: string;
    }[];
  };
}

export const AURORA_REPORT_SECTIONS = ["interplay", "present", "direction", "relationships", "selfCare", "letter"] as const;
export type AuroraReportSection = typeof AURORA_REPORT_SECTIONS[number];
export const AURORA_REPORT_HEADINGS: Record<AuroraReportSection, string> = {
  interplay: "여러 리본이 함께 보여주는 당신", present: "현재의 마음에 대한 이해", direction: "앞으로의 삶을 위한 방향",
  relationships: "인간관계에 대한 조언", selfCare: "마음을 돌보는 방법", letter: "당신에게 전하는 편지",
};
