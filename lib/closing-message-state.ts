import { closingInputFingerprint, directClosingText, hasClosingInput, validAIClosingText, validFinalClosingText, type ApprovedClosingMessage, type ClosingErrorCode, type ClosingMessageInput, type ClosingMessageSource } from "./closing-message";

export interface ClosingSentenceDraft { text: string; inputFingerprint: string }
export interface ClosingMessageState {
  authoredText: string;
  authoredWord: string;
  aiDraft: ClosingSentenceDraft | null;
  editedDraft: (ClosingSentenceDraft & { source: "user-edited" | "user-authored" }) | null;
  approved: ApprovedClosingMessage | null;
  request: { id: string; inputFingerprint: string } | null;
  error: ClosingErrorCode | null;
  notice: string;
}
export const createClosingMessageState = (): ClosingMessageState => ({ authoredText: "", authoredWord: "", aiDraft: null, editedDraft: null, approved: null, request: null, error: null, notice: "" });
export type ClosingMessageAction =
  | { type: "closing-input"; field: "authoredText" | "authoredWord"; text: string }
  | { type: "closing-start"; id: string; inputFingerprint: string }
  | { type: "closing-success"; id: string; inputFingerprint: string; text: string }
  | { type: "closing-failure"; id: string; inputFingerprint: string; code: ClosingErrorCode }
  | { type: "closing-cancel" }
  | { type: "closing-edit"; text: string }
  | { type: "closing-approve"; direct?: boolean; approvedAt: string };

export function invalidateClosingMessage(state: ClosingMessageState): ClosingMessageState {
  return { ...state, approved: null, request: null, error: null,
    notice: state.approved || state.aiDraft || state.editedDraft || state.request ? "입력이 바뀌어 이전 문장의 승인을 해제했어요. 이전 초안과 직접 쓴 원문은 남아 있어요. 새로 만들거나 직접 수정해 결정해 주세요." : state.notice };
}
export function closingMessageReducer(state: ClosingMessageState, action: ClosingMessageAction, input: ClosingMessageInput): ClosingMessageState {
  const fingerprint = closingInputFingerprint(input);
  switch (action.type) {
    case "closing-input": return state; // Atomic input changes are handled by the questionnaire reducer.
    case "closing-start":
      if (state.request || action.inputFingerprint !== fingerprint || !hasClosingInput(input)) return state;
      return { ...state, request: { id: action.id, inputFingerprint: fingerprint }, approved: null, error: null, notice: "" };
    case "closing-success":
    case "closing-failure":
      if (state.request?.id !== action.id || state.request.inputFingerprint !== action.inputFingerprint || fingerprint !== action.inputFingerprint) return state;
      if (action.type === "closing-failure") return { ...state, request: null, error: action.code };
      if (!validAIClosingText(action.text)) return { ...state, request: null, error: "INVALID_AI_RESPONSE" };
      return { ...state, request: null, aiDraft: { text: action.text, inputFingerprint: fingerprint }, editedDraft: null, approved: null, error: null, notice: "" };
    case "closing-cancel": return state.request ? { ...state, request: null, error: null } : state;
    case "closing-edit":
      if (action.text.length > 1000) return state;
      return { ...state, editedDraft: { text: action.text, inputFingerprint: fingerprint, source: state.aiDraft ? "user-edited" : "user-authored" }, approved: null, request: null, error: null, notice: "" };
    case "closing-approve": {
      if (state.request || !Number.isFinite(Date.parse(action.approvedAt))) return state;
      const draft = state.editedDraft ?? state.aiDraft;
      const text = action.direct ? directClosingText(input) : draft?.text;
      if (!text || !validFinalClosingText(text) || (!action.direct && draft?.inputFingerprint !== fingerprint)) return state;
      const source: ClosingMessageSource = action.direct ? "user-authored" : state.editedDraft?.source ?? "ai";
      return { ...state, approved: { text: text.trim(), source, approvedAt: action.approvedAt, inputFingerprint: fingerprint }, error: null, notice: "" };
    }
  }
}
