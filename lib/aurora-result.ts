import { QUESTION_DATA, QUESTIONS } from "./capsules";
import { personalizeAuroraFromQuestionnaire } from "./aurora-personalization";
import type { AuroraPersonalizationResult } from "./aurora-personalization-types";
import { validateAuroraAppearance } from "./aurora-types";
import { firstIncompleteQuestion, getApprovedClosingMessage, serializeLegacyAnswers, type QuestionnaireState } from "./questionnaire-state";

export interface AuroraResultSnapshot {
  personalization: AuroraPersonalizationResult & { approvedTitle: NonNullable<AuroraPersonalizationResult["approvedTitle"]> };
  answers: readonly string[];
  /** Local consistency check only; never displayed or logged. */
  inputFingerprint: string;
}
export interface AuroraAnalysisComment { analysis: string; detailedAnalysis: string }
export interface AuroraCompletedResult { snapshot: AuroraResultSnapshot; comments: readonly AuroraAnalysisComment[] }
export type AuroraAnalysisFailure = "AI_NOT_CONFIGURED" | "ANALYSIS_FAILED" | "CONNECTION_FAILED"
  | "ANALYSIS_RESPONSE_INVALID" | "ANALYSIS_COMMENTS_COUNT_MISMATCH" | "PERSONALIZATION_FAILED" | "RESULT_TRANSITION_FAILED";
export interface AuroraAnalysisDiagnostic {
  stage: "snapshot" | "request" | "response-validation" | "result-transition";
  code: AuroraAnalysisFailure;
  httpStatus?: number;
  expectedCount?: number;
  receivedCount?: number;
  commentNumber?: number;
  reason?: "comments-not-array" | "comments-count-mismatch" | "invalid-comment" | "empty-comment" | "invalid-json" | "question-id-mismatch";
}
const failureCodes: readonly AuroraAnalysisFailure[] = ["AI_NOT_CONFIGURED", "ANALYSIS_FAILED", "CONNECTION_FAILED",
  "ANALYSIS_RESPONSE_INVALID", "ANALYSIS_COMMENTS_COUNT_MISMATCH", "PERSONALIZATION_FAILED", "RESULT_TRANSITION_FAILED"];
/** Development only. Copy allowlisted scalar metadata; never log bodies/errors/fingerprints. */
export function logAuroraAnalysisDiagnostic(diagnostic: AuroraAnalysisDiagnostic): void {
  if (process.env.NODE_ENV !== "development" || !failureCodes.includes(diagnostic.code)
    || !["snapshot", "request", "response-validation", "result-transition"].includes(diagnostic.stage)) return;
  const safe: Record<string, string | number> = { stage: diagnostic.stage, code: diagnostic.code };
  for (const key of ["httpStatus", "expectedCount", "receivedCount", "commentNumber"] as const) {
    const value = diagnostic[key];
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) safe[key] = value;
  }
  if (diagnostic.reason && ["comments-not-array", "comments-count-mismatch", "invalid-comment", "empty-comment", "invalid-json", "question-id-mismatch"].includes(diagnostic.reason)) safe.reason = diagnostic.reason;
  console.warn("[aurora-analysis]", safe);
}
export function auroraAnalysisFailureMessage(code: AuroraAnalysisFailure, diagnostic?: AuroraAnalysisDiagnostic): string {
  const preserved = "선택한 답변과 승인한 문장은 그대로 유지됩니다.";
  const retry = "잠시 후 ‘오로라 만나기’를 다시 눌러 주세요.";
  if (code === "ANALYSIS_COMMENTS_COUNT_MISMATCH") {
    const count = diagnostic?.receivedCount;
    return `분석 응답 검증 오류: ${QUESTIONS.length}개 분석 항목이 필요하지만 ${typeof count === "number" && Number.isSafeInteger(count) && count >= 0 ? `${count}개가 도착했습니다.` : "개수가 맞지 않습니다."} ${preserved} ${retry}`;
  }
  const messages: Record<Exclude<AuroraAnalysisFailure, "ANALYSIS_COMMENTS_COUNT_MISMATCH">, string> = {
    AI_NOT_CONFIGURED: "AI 분석 서비스가 아직 설정되지 않았습니다. 관리자에게 문의해 주세요.",
    ANALYSIS_FAILED: "분석 서버가 요청을 완료하지 못했습니다.",
    CONNECTION_FAILED: "분석 서비스에 연결하지 못했습니다.",
    ANALYSIS_RESPONSE_INVALID: "분석 응답 검증 오류: 응답 형식이나 분석 내용을 확인하지 못했습니다.",
    PERSONALIZATION_FAILED: "개인화 오로라 설정을 준비하지 못했습니다.",
    RESULT_TRANSITION_FAILED: "결과 화면으로 이동하지 못했습니다.",
  };
  return `${messages[code]} ${preserved}${code === "AI_NOT_CONFIGURED" ? "" : ` ${retry}`}`;
}
export type AuroraResultPreparation = { ready: false; step: number; failure?: AuroraAnalysisDiagnostic } | { ready: true; snapshot: AuroraResultSnapshot };

/** Snapshot only current, approved, complete answers. Reuses the unchanged 5-A engine. */
export function prepareAuroraResult(state: QuestionnaireState): AuroraResultPreparation {
  try {
    const approved = getApprovedClosingMessage(state);
    if (!approved) return { ready: false, step: 9 };
    const incomplete = firstIncompleteQuestion(state);
    if (incomplete !== -1) return { ready: false, step: incomplete };
    const personalization = personalizeAuroraFromQuestionnaire(state);
    if (!personalization.approvedTitle) return { ready: false, step: 9 };
    if (validateAuroraAppearance(personalization.appearance).length) throw new Error("INVALID_AURORA_APPEARANCE");
    return { ready: true, snapshot: {
      personalization: { ...personalization, approvedTitle: personalization.approvedTitle },
      answers: serializeLegacyAnswers(state), inputFingerprint: approved.inputFingerprint,
    } };
  } catch {
    return { ready: false, step: 9, failure: { stage: "snapshot", code: "PERSONALIZATION_FAILED" } };
  }
}
/** The legacy API remains unchanged. Only actual textual analysis crosses this boundary. */
export function validateAuroraAnalysisResponse(value: unknown): { valid: true; comments: AuroraAnalysisComment[] }
  | { valid: false; diagnostic: AuroraAnalysisDiagnostic } {
  if (!value || typeof value !== "object" || !("comments" in value) || !Array.isArray(value.comments))
    return { valid: false, diagnostic: { stage: "response-validation", code: "ANALYSIS_RESPONSE_INVALID", reason: "comments-not-array", expectedCount: QUESTIONS.length } };
  const counts = { expectedCount: QUESTIONS.length, receivedCount: value.comments.length };
  if (value.comments.length !== QUESTIONS.length) return { valid: false, diagnostic: {
    stage: "response-validation", code: "ANALYSIS_COMMENTS_COUNT_MISMATCH", reason: "comments-count-mismatch", ...counts,
  } };
  const comments: AuroraAnalysisComment[] = [];
  for (const [index, item] of value.comments.entries()) {
    if (!item || typeof item !== "object") return { valid: false, diagnostic: {
      stage: "response-validation", code: "ANALYSIS_RESPONSE_INVALID", reason: "invalid-comment", commentNumber: index + 1, ...counts,
    } };
    if (item.questionId !== undefined && item.questionId !== QUESTION_DATA[index].id) return { valid: false, diagnostic: {
      stage: "response-validation", code: "ANALYSIS_RESPONSE_INVALID", reason: "question-id-mismatch", commentNumber: index + 1, ...counts,
    } };
    const analysis = typeof item.analysis === "string" ? item.analysis : "";
    const detailedAnalysis = typeof item.detailedAnalysis === "string" ? item.detailedAnalysis : "";
    if (!analysis.trim() && !detailedAnalysis.trim()) return { valid: false, diagnostic: {
      stage: "response-validation", code: "ANALYSIS_RESPONSE_INVALID", reason: "empty-comment", commentNumber: index + 1, ...counts,
    } };
    comments.push({ analysis, detailedAnalysis });
  }
  return { valid: true, comments };
}
export function readAuroraAnalysisComments(value: unknown): AuroraAnalysisComment[] | null {
  const validation = validateAuroraAnalysisResponse(value);
  return validation.valid ? validation.comments : null;
}
export interface AuroraAnalysisCallbacks {
  isCurrent: () => boolean;
  start: () => void;
  success: (result: AuroraCompletedResult) => void;
  failure: (code: AuroraAnalysisFailure, diagnostic?: AuroraAnalysisDiagnostic) => void;
  settled: () => void;
}
type AnalysisToken = { controller: AbortController; snapshot: AuroraResultSnapshot; callbacks: AuroraAnalysisCallbacks };

/** One synchronous lock, identity-guarded completion and cancellation per page session. */
export class AuroraAnalysisRequestController {
  private active: AnalysisToken | null = null;
  constructor(private readonly fetcher: typeof fetch = (...args) => globalThis.fetch(...args)) {}
  get busy(): boolean { return this.active !== null; }
  get fingerprint(): string | null { return this.active?.snapshot.inputFingerprint ?? null; }
  cancel(notify = true): void {
    const active = this.active;
    if (!active) return;
    this.active = null;
    active.controller.abort();
    if (notify) active.callbacks.settled();
  }
  async analyze(snapshot: AuroraResultSnapshot, callbacks: AuroraAnalysisCallbacks): Promise<void> {
    if (this.active || !callbacks.isCurrent()) return;
    const token: AnalysisToken = { controller: new AbortController(), snapshot, callbacks };
    this.active = token;
    const current = () => this.active === token && !token.controller.signal.aborted && callbacks.isCurrent();
    const fail = (diagnostic: AuroraAnalysisDiagnostic) => {
      if (!current()) return;
      logAuroraAnalysisDiagnostic(diagnostic);
      callbacks.failure(diagnostic.code, diagnostic);
    };
    let stage: AuroraAnalysisDiagnostic["stage"] = "result-transition";
    try {
      callbacks.start();
      stage = "request";
      const response = await this.fetcher("/api/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: token.controller.signal,
        body: JSON.stringify({ answers: snapshot.answers, questions: QUESTIONS }),
      });
      if (!current()) return;
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        if (error?.code === "ANALYSIS_COMMENTS_COUNT_MISMATCH" || error?.code === "ANALYSIS_RESPONSE_INVALID") {
          fail({ stage: "response-validation", code: error.code, httpStatus: response.status,
            expectedCount: QUESTIONS.length, receivedCount: typeof error.receivedCount === "number" && Number.isSafeInteger(error.receivedCount) && error.receivedCount >= 0 ? error.receivedCount : undefined });
        } else fail({ stage: "request", code: error?.code === "AI_NOT_CONFIGURED" ? "AI_NOT_CONFIGURED" : "ANALYSIS_FAILED", httpStatus: response.status });
        return;
      }
      stage = "response-validation";
      let body: unknown;
      try { body = await response.json(); }
      catch { fail({ stage, code: "ANALYSIS_RESPONSE_INVALID", reason: "invalid-json", httpStatus: response.status }); return; }
      if (!current()) return;
      const validation = validateAuroraAnalysisResponse(body);
      if (!validation.valid) { fail({ ...validation.diagnostic, httpStatus: response.status }); return; }
      stage = "result-transition";
      callbacks.success({ snapshot, comments: validation.comments });
    } catch {
      fail({ stage, code: stage === "result-transition" ? "RESULT_TRANSITION_FAILED"
        : stage === "response-validation" ? "ANALYSIS_RESPONSE_INVALID" : "CONNECTION_FAILED" });
    } finally {
      if (this.active === token) { this.active = null; callbacks.settled(); }
    }
  }
}
