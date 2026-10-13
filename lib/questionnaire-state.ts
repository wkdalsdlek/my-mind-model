import { QUESTION_DATA, QUESTION_FLOW, serializeSelections, type SelectedCapsule } from "./capsules";

export type QuestionResponseStatus = "pending" | "answered" | "skipped";

export interface QuestionResponse {
  questionId: string;
  status: QuestionResponseStatus;
}

export interface QuestionnaireState {
  selections: SelectedCapsule[][];
  responses: QuestionResponse[];
}

export type QuestionnaireAction =
  | { type: "select"; step: number; selection: SelectedCapsule }
  | { type: "remove"; step: number; selectionId: string }
  | { type: "skip"; step: number }
  | { type: "reset" };

export function createQuestionnaireState(): QuestionnaireState {
  return {
    selections: QUESTION_DATA.map(() => []),
    responses: QUESTION_DATA.map(({ id }) => ({ questionId: id, status: "pending" })),
  };
}

/** Keep selections and response intent atomic without touching keyword pool references. */
export function questionnaireReducer(state: QuestionnaireState, action: QuestionnaireAction): QuestionnaireState {
  if (action.type === "reset") return createQuestionnaireState();
  const current = state.selections[action.step];
  if (!current) return state;
  if (action.type === "skip") {
    if (!QUESTION_FLOW[action.step].allowSkip || current.length) return state;
    return { ...state, responses: state.responses.map((response, i) => i === action.step ? { ...response, status: "skipped" } : response) };
  }
  const selected = action.type === "select"
    ? [...current, action.selection]
    : current.filter(({ selectionId }) => selectionId !== action.selectionId);
  if (action.type === "remove" && selected.length === current.length) return state;
  return {
    selections: state.selections.map((items, i) => i === action.step ? selected : items),
    responses: state.responses.map((response, i) => i === action.step ? { ...response, status: selected.length ? "answered" : "pending" } : response),
  };
}

export function firstIncompleteQuestion(state: QuestionnaireState): number {
  return state.selections.findIndex((items, i) => !items.length && !(QUESTION_FLOW[i].allowSkip && state.responses[i].status === "skipped"));
}

/** Temporary legacy transport: an explicit skip is not an inferred emotional answer. */
export function serializeLegacyAnswers(state: QuestionnaireState): string[] {
  return serializeSelections(state.selections).map((answer, i) =>
    !answer && state.responses[i].status === "skipped" ? "[사용자가 건너뛴 문항 — 선택한 키워드 없음]" : answer);
}
