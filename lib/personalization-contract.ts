import type { KeywordCapsule } from "./capsules";

/** Contract only. No recommendations, AI summary or approval flow run in phase 1. */
export interface PersonalizedKeyword extends KeywordCapsule {
  questionId: "q10";
  source: "personalized";
  recommendationKind: "direct" | "expanded" | "common";
  evidenceSelectionIds: readonly string[];
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
