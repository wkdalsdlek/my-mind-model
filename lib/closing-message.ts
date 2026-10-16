import { QUESTION_DATA, type AnswerIntent, type QuestionId } from "./question-data";
import type { SelectedCapsule } from "./capsules";

export const CLOSING_MESSAGE_LIMITS = { bodyBytes: 131072, selectionsPerQuestion: 100, totalSelections: 300, totalText: 24000, authoredText: 1000, authoredWord: 16, aiText: 80, finalText: 1000 } as const;
export type ClosingMessageSource = "ai" | "user-edited" | "user-authored";
export interface ApprovedClosingMessage {
  text: string;
  source: ClosingMessageSource;
  approvedAt: string;
  inputFingerprint: string;
}
export interface ClosingSelection {
  keywordId: string;
  selectionId: string;
  questionId: QuestionId;
  label: string;
  originalText: string;
  source: "preset" | "custom" | "personalized";
  answerIntent: AnswerIntent;
}
export interface ClosingMessageInput {
  q10Selections: ClosingSelection[];
  authoredText: string;
  authoredWord: string;
  context: { questionId: QuestionId; status: "pending" | "answered" | "skipped"; selections: ClosingSelection[] }[];
}
export type ClosingErrorCode = "INVALID_INPUT" | "REQUEST_TOO_LARGE" | "AI_NOT_CONFIGURED" | "CLOSING_FAILED" | "INVALID_AI_RESPONSE" | "RATE_LIMITED" | "REQUEST_FORBIDDEN" | "REQUEST_CANCELLED" | "AUTH_REQUIRED" | "SECURITY_UNAVAILABLE";
export const CLOSING_ERRORS: Record<ClosingErrorCode, string> = {
  AUTH_REQUIRED: "세션이 만료되었어요. 다시 로그인해 주세요.",
  SECURITY_UNAVAILABLE: "보안 또는 예산 설정을 확인하지 못했어요. 관리자에게 문의해 주세요. 작성한 원문은 유지됩니다.",
  INVALID_INPUT: "입력을 확인해 주세요. 담은 표현이나 직접 쓴 말이 필요하며, 한 질문에 최대 100개·전체 300개의 선택을 사용할 수 있어요.",
  REQUEST_TOO_LARGE: "입력이 너무 길어요. 담은 표현을 조금 줄여 주세요. 작성한 원문은 그대로 남아 있어요.",
  AI_NOT_CONFIGURED: "AI 문장 서비스가 아직 설정되지 않았어요. 직접 쓴 문장으로 결정할 수 있어요.",
  CLOSING_FAILED: "문장을 만들지 못했어요. 잠시 후 다시 시도하거나 직접 쓴 문장으로 결정해 주세요.",
  INVALID_AI_RESPONSE: "생성된 문장을 확인하지 못했어요. 다시 시도하거나 직접 문장을 작성해 주세요.",
  RATE_LIMITED: "요청이 잠시 몰렸어요. 조금 기다린 뒤 다시 시도해 주세요.",
  REQUEST_FORBIDDEN: "이 화면에서 문장 만들기를 다시 시도해 주세요.",
  REQUEST_CANCELLED: "문장 요청이 취소되었어요. 원문은 그대로 남아 있어요.",
};

export function buildClosingMessageInput(state: { selections: readonly (readonly SelectedCapsule[])[]; responses: readonly { status: "pending" | "answered" | "skipped" }[] }, authoredText: string, authoredWord: string): ClosingMessageInput {
  const project = (step: number): ClosingSelection[] => (state.selections[step] ?? []).map(s => ({
    keywordId: s.id, selectionId: s.selectionId, questionId: QUESTION_DATA[step].id,
    label: s.label, originalText: s.originalText ?? s.label, source: s.source ?? "custom", answerIntent: QUESTION_DATA[step].answerIntent,
  })).sort((a, b) => a.selectionId < b.selectionId ? -1 : a.selectionId > b.selectionId ? 1 : 0);
  return { q10Selections: project(9), authoredText, authoredWord, context: QUESTION_DATA.slice(0, 9).map((q, i) => ({ questionId: q.id, status: state.responses[i].status, selections: project(i) })) };
}

// Lossless snapshot: raw whitespace, repeated selection identities and skips matter.
export function closingInputFingerprint(input: ClosingMessageInput): string { return `closing-v1:${JSON.stringify(input)}`; }
export function hasClosingInput(input: ClosingMessageInput): boolean { return !!(input.q10Selections.length || input.authoredText.trim() || input.authoredWord.trim()); }
export function directClosingText(input: ClosingMessageInput): string {
  return input.authoredText.trim() || input.authoredWord.trim() || input.q10Selections.find(s => s.source === "custom")?.originalText.trim() || "";
}
export function validFinalClosingText(text: string): boolean { return typeof text === "string" && !!text.trim() && text.length <= CLOSING_MESSAGE_LIMITS.finalText && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text); }
export function validAIClosingText(text: unknown): text is string {
  return typeof text === "string" && text === text.trim() && text.length >= 2 && [...text].length <= CLOSING_MESSAGE_LIMITS.aiText
    && /[가-힣]/.test(text) && !/[\r\n\u0000-\u001f\u007f`#*]|\[[^\]]*\]\(|^(?:문장|설명|결과|제목|출력)\s*:|^[-+>]\s/.test(text);
}
export class ClosingInputError extends Error {
  constructor(public readonly code: "INVALID_INPUT" | "REQUEST_TOO_LARGE" = "INVALID_INPUT") { super(code); }
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const exactKeys = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const boundedString = (v: unknown, max: number, nonempty = false): v is string => typeof v === "string" && v.length <= max && (!nonempty || !!v.trim()) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v);

/** Only actual selections and authored input enter the model; no candidate pool or client prompt. */
export function validateClosingMessageInput(value: unknown): ClosingMessageInput {
  if (!object(value) || !exactKeys(value, ["q10Selections", "authoredText", "authoredWord", "context"])) throw new ClosingInputError();
  if (!boundedString(value.authoredText, 1000) || !boundedString(value.authoredWord, 16) || !Array.isArray(value.context) || value.context.length !== 9) throw new ClosingInputError();
  const selectionIds = new Set<string>();
  let totalText = value.authoredText.length + value.authoredWord.length;
  const parseSelections = (items: unknown, questionId: QuestionId): ClosingSelection[] => {
    if (!Array.isArray(items) || items.length > CLOSING_MESSAGE_LIMITS.selectionsPerQuestion) throw new ClosingInputError();
    const intent = QUESTION_DATA.find(q => q.id === questionId)!.answerIntent;
    return items.map(s => {
      if (!object(s) || !exactKeys(s, ["keywordId", "selectionId", "questionId", "label", "originalText", "source", "answerIntent"])
        || !boundedString(s.keywordId, 256, true) || !boundedString(s.selectionId, 256, true) || selectionIds.has(s.selectionId)
        || s.questionId !== questionId || s.answerIntent !== intent || !boundedString(s.label, 1000, true) || !boundedString(s.originalText, 1000, true)
        || (questionId === "q10" ? !["custom", "personalized"].includes(String(s.source)) : !["preset", "custom"].includes(String(s.source)))) throw new ClosingInputError();
      selectionIds.add(s.selectionId);
      totalText += s.label.length + s.originalText.length;
      if (selectionIds.size > CLOSING_MESSAGE_LIMITS.totalSelections || totalText > CLOSING_MESSAGE_LIMITS.totalText) throw new ClosingInputError("REQUEST_TOO_LARGE");
      return { keywordId: s.keywordId, selectionId: s.selectionId, questionId, label: s.label, originalText: s.originalText, source: s.source as ClosingSelection["source"], answerIntent: intent };
    });
  };
  const q10Selections = parseSelections(value.q10Selections, "q10");
  const seenQuestions = new Set<string>();
  const context = value.context.map(q => {
    if (!object(q) || !exactKeys(q, ["questionId", "status", "selections"]) || typeof q.questionId !== "string"
      || !QUESTION_DATA.slice(0, 9).some(item => item.id === q.questionId) || seenQuestions.has(q.questionId)
      || !["pending", "answered", "skipped"].includes(String(q.status))) throw new ClosingInputError();
    seenQuestions.add(q.questionId);
    const questionId = q.questionId as QuestionId;
    const selections = parseSelections(q.selections, questionId);
    if ((q.status === "answered") !== (selections.length > 0)) throw new ClosingInputError();
    return { questionId, status: q.status as ClosingMessageInput["context"][number]["status"], selections };
  });
  const input = { q10Selections, authoredText: value.authoredText, authoredWord: value.authoredWord, context };
  if (!hasClosingInput(input)) throw new ClosingInputError();
  return input;
}
