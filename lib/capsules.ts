import type { KeywordSemanticWeight } from "./semantic-families";
import { QUESTION_DATA, type AnswerIntent, type QuestionId } from "./question-data";
import { KEYWORD_SEMANTICS } from "./keyword-semantics";
import type { RecommendationProvenance } from "./personalization-contract";

export { QUESTION_DATA } from "./question-data";

// Retain this name for the existing physics consumers: it is a UI profile only.
export type SemanticGroup = "calm" | "warm" | "depth" | "energy";

export type KeywordSource = "preset" | "custom" | "personalized";

export interface KeywordCapsule {
  id: string;
  label: string;
  group: SemanticGroup;
  // Optional fields keep previously created capsules compatible.
  questionId?: string;
  originalText?: string;
  source?: KeywordSource;
  semanticWeights?: readonly KeywordSemanticWeight[];
  answerIntent?: AnswerIntent;
  recommendation?: RecommendationProvenance;
}

export interface SelectedCapsule extends KeywordCapsule {
  selectionId: string;
}

export const SEMANTIC_PROFILES: Record<SemanticGroup, { color: string; duration: number }> = {
  calm: { color: "117, 217, 217", duration: 13 },
  warm: { color: "235, 161, 192", duration: 10 },
  depth: { color: "177, 157, 236", duration: 16 },
  energy: { color: "208, 182, 240", duration: 8 },
};

// Local, provisional classification: no external request or paid service is used.
export function classifyKeyword(label: string): SemanticGroup {
  if (/고요|휴식|안정|자연|숲|바다|산책|잠|평온|침묵|호흡|여유|명상|일상|차분|정리|균형/.test(label)) return "calm";
  if (/사람|친구|가족|대화|공감|사랑|온기|관계|함께|연결|배려|다정|웃음|위로|진심|경청|신뢰/.test(label)) return "warm";
  if (/도전|탐험|여행|변화|성장|용기|행동|실행|모험|자유|열정|시작|운동|새로움|호기심/.test(label)) return "energy";
  return "depth";
}

export const TARGET_KEYWORDS_PER_QUESTION = 14;

// Created once at module scope: changing response state never replaces keyword arrays.
export const QUESTION_FLOW = QUESTION_DATA.map((question) => ({
  questionId: question.id,
  allowSkip: question.allowSkip,
  keywordStatus: question.keywordMode === "personalized" ? "personalization-pending" as const : "confirmed" as const,
}));

export const QUESTIONS = QUESTION_DATA.map(({ category, prompt }) => `[${category}] ${prompt.replaceAll("\n", " ")}`);

export function createKeywordPools(): KeywordCapsule[][] {
  return QUESTION_DATA.map((question) => question.keywords.map(({ id, label }) => ({
    id,
    label,
    group: classifyKeyword(label),
    questionId: question.id,
    originalText: label,
    source: "preset",
    semanticWeights: KEYWORD_SEMANTICS[id].map(weight => ({ ...weight })),
    answerIntent: question.answerIntent,
  })));
}

export function createCustomKeyword(questionId: QuestionId, originalText: string, id: string): KeywordCapsule {
  const label = originalText.trim();
  const answerIntent = QUESTION_DATA.find(question => question.id === questionId)!.answerIntent;
  return { id, label, group: classifyKeyword(label), questionId, originalText, source: "custom", semanticWeights: [], answerIntent };
}

export function createSelectedCapsule(keyword: KeywordCapsule, questionId: QuestionId, selectionId: string): SelectedCapsule {
  return {
    ...keyword,
    questionId,
    originalText: keyword.originalText ?? keyword.label,
    semanticWeights: (keyword.semanticWeights ?? []).map(weight => ({ ...weight })),
    answerIntent: QUESTION_DATA.find(question => question.id === questionId)!.answerIntent,
    ...(keyword.recommendation ? { recommendation: {
      ...keyword.recommendation,
      evidence: keyword.recommendation.evidence.map(evidence => ({ ...evidence })),
      evidenceQuestionIds: [...keyword.recommendation.evidenceQuestionIds],
      evidenceSelectionIds: [...keyword.recommendation.evidenceSelectionIds],
    } } : {}),
    selectionId,
  };
}

// The existing API accepts text answers; repetition remains visible in this adapter.
export function serializeSelections(selections: SelectedCapsule[][]): string[] {
  return selections.map((items) => items.map(({ label }) => label).join(", "));
}
