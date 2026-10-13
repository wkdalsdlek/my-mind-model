import { QUESTION_DATA, QUESTION_FLOW, serializeSelections, type SelectedCapsule } from "./capsules";
import { generateQ10Recommendations, recommendationFingerprint } from "./q10-recommendations";
import type { Q10RecommendationState } from "./personalization-contract";
import { buildClosingMessageInput, closingInputFingerprint, type ApprovedClosingMessage } from "./closing-message";
import { closingMessageReducer, createClosingMessageState, invalidateClosingMessage, type ClosingMessageAction, type ClosingMessageState } from "./closing-message-state";

export type QuestionResponseStatus = "pending" | "answered" | "skipped";

export interface QuestionResponse {
  questionId: string;
  status: QuestionResponseStatus;
}

export interface QuestionnaireState {
  selections: SelectedCapsule[][];
  responses: QuestionResponse[];
  personalization: Q10RecommendationState;
  closing: ClosingMessageState;
}

export type QuestionnaireAction =
  | ClosingMessageAction
  | { type: "select"; step: number; selection: SelectedCapsule }
  | { type: "remove"; step: number; selectionId: string }
  | { type: "skip"; step: number }
  | { type: "reset" };

export function createQuestionnaireState(): QuestionnaireState {
  const answers = {
    selections: QUESTION_DATA.map(() => []),
    responses: QUESTION_DATA.map(({ id }) => ({ questionId: id, status: "pending" as const })),
  };
  return { ...answers, closing: createClosingMessageState(), personalization: { ...generateQ10Recommendations(answers), invalidationCount: 0, notice: "", condensedSentence: null, approvedSentence: null } };
}

function refreshPersonalization(state: QuestionnaireState): QuestionnaireState {
  if (recommendationFingerprint(state) === state.personalization.basisFingerprint) return state;
  // Invalidate recommendation-derived answers even if the same label is recommended again.
  // User authored words/sentences, their raw text and individual selection IDs stay intact.
  const previous = state.selections[9];
  const preserved = previous.filter(selection => selection.source !== "personalized");
  const removed = previous.length - preserved.length;
  return {
    ...state,
    selections: removed ? state.selections.map((items, i) => i === 9 ? preserved : items) : state.selections,
    responses: state.responses.map((response, i) => i === 9 ? { ...response, status: preserved.length ? "answered" : "pending" } : response),
    personalization: {
      ...generateQ10Recommendations(state), invalidationCount: state.personalization.invalidationCount + 1,
      notice: removed ? "앞선 답변이 바뀌어 추천을 새로 준비하고, 이전 추천에서 고른 캡슐은 비웠어요. 직접 남긴 말은 그대로 유지됩니다." : state.personalization.notice,
      condensedSentence: null, approvedSentence: null,
    },
  };
}

/** Keep selections and response intent atomic without touching keyword pool references. */
export function questionnaireReducer(state: QuestionnaireState, action: QuestionnaireAction): QuestionnaireState {
  if (action.type === "reset") return createQuestionnaireState();
  if (action.type === "closing-input") {
    if (state.closing[action.field] === action.text || action.text.length > (action.field === "authoredText" ? 1000 : 16)) return state;
    return { ...state, closing: invalidateClosingMessage({ ...state.closing, [action.field]: action.text }) };
  }
  if (!("step" in action)) {
    const input = buildClosingMessageInput(state, state.closing.authoredText, state.closing.authoredWord);
    const closing = closingMessageReducer(state.closing, action, input);
    return closing === state.closing ? state : { ...state, closing };
  }
  const current = state.selections[action.step];
  if (!current) return state;
  if (action.type === "select" && action.step === 9 && action.selection.source === "personalized"
    && (action.selection.recommendation?.basisFingerprint !== state.personalization.basisFingerprint
      || !state.personalization.recommendations.some(keyword => keyword.id === action.selection.id))) return state;
  if (action.type === "skip") {
    if (!QUESTION_FLOW[action.step].allowSkip || current.length) return state;
    if (state.responses[action.step].status === "skipped") return state;
    return refreshPersonalization({ ...state, closing: invalidateClosingMessage(state.closing), responses: state.responses.map((response, i) => i === action.step ? { ...response, status: "skipped" } : response) });
  }
  const selected = action.type === "select"
    ? [...current, action.selection]
    : current.filter(({ selectionId }) => selectionId !== action.selectionId);
  if (action.type === "remove" && selected.length === current.length) return state;
  const next: QuestionnaireState = {
    ...state,
    closing: invalidateClosingMessage(state.closing),
    selections: state.selections.map((items, i) => i === action.step ? selected : items),
    responses: state.responses.map((response, i) => i === action.step ? { ...response, status: selected.length ? "answered" : "pending" } : response),
  };
  return action.step < 9 ? refreshPersonalization(next) : next;
}

export function firstIncompleteQuestion(state: QuestionnaireState): number {
  return state.selections.findIndex((items, i) => !items.length && !(i === 9 && (state.closing.authoredText.trim() || state.closing.authoredWord.trim() || getApprovedClosingMessage(state))) && !(QUESTION_FLOW[i].allowSkip && state.responses[i].status === "skipped"));
}

/** Phase 4 can consume this typed approval without mistaking raw input for a final title. */
export function getApprovedClosingMessage(state: QuestionnaireState): ApprovedClosingMessage | null {
  const approved = state.closing.approved;
  if (!approved) return null;
  return approved.inputFingerprint === closingInputFingerprint(buildClosingMessageInput(state, state.closing.authoredText, state.closing.authoredWord)) ? approved : null;
}

/** Temporary legacy transport: an explicit skip is not an inferred emotional answer. */
export function serializeLegacyAnswers(state: QuestionnaireState): string[] {
  const approved = getApprovedClosingMessage(state);
  return serializeSelections(state.selections).map((answer, i) =>
    i === 9 && approved ? approved.text : !answer && state.responses[i].status === "skipped" ? "[사용자가 건너뛴 문항 — 선택한 키워드 없음]" : answer);
}
