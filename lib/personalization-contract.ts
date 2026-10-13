import type { KeywordCapsule } from "./capsules";
import type { AnswerIntent, QuestionId } from "./question-data";

export interface RecommendationEvidence {
  questionId: QuestionId;
  keywordId: string;
  selectionId: string;
  label: string;
  originalText: string;
  answerIntent: AnswerIntent;
}

export interface RecommendationProvenance {
  kind: "direct" | "expanded" | "common";
  generator: "local" | "fallback";
  semanticStatus: "mapped" | "unclassified";
  evidence: readonly RecommendationEvidence[];
  evidenceQuestionIds: readonly QuestionId[];
  evidenceSelectionIds: readonly string[];
  reason: string;
  topicKey: string;
  basisFingerprint: string;
}

export interface PersonalizedKeyword extends KeywordCapsule {
  questionId: "q10";
  source: "personalized";
  recommendation: RecommendationProvenance;
}

export interface Q10PersonalizationDraft {
  questionId: "q10";
  recommendations: readonly PersonalizedKeyword[];
  basedOnSelectionIds: readonly string[];
  condensedSentence: string | null;
  approvedSentence: string | null;
  status: "not-started" | "draft" | "approved";
}

export const Q10_RECOMMENDATION_TARGET = { total: 14, direct: 6, expanded: 5, common: 3 } as const;

export interface Q10RecommendationResult {
  recommendations: readonly PersonalizedKeyword[];
  basisFingerprint: string;
  generator: "local" | "fallback";
}

export interface Q10RecommendationState extends Q10RecommendationResult {
  invalidationCount: number;
  notice: string;
  // Legacy phase 2 placeholders. Active drafts/approval live in QuestionnaireState.closing.
  condensedSentence: string | null;
  approvedSentence: string | null;
}
