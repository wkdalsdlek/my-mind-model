import { prepareAuroraResult, type AuroraResultSnapshot } from "./aurora-result";
import { buildAuroraInterpretationRequest, prepareAuroraInterpretation, AuroraInterpretationError } from "./aurora-interpretation";
import type { AuroraInterpretationContext, AuroraInterpretationResult } from "./aurora-interpretation-types";
import { canonicalInterpretationValue, validateAuroraInterpretationResponse } from "./aurora-interpretation-validation";
import { createAuroraRibbonLayout } from "./aurora-ribbon-layout";
import type { AuroraQuality, AuroraFlowMode } from "./aurora-types";
import type { QuestionnaireState } from "./questionnaire-state";
import { AI_USAGE_MESSAGES, isAIUsageErrorCode, type AIUsageErrorCode } from "./ai-usage-errors";
import { INTERPRETATION_BROWSER_TIMEOUT_MS } from "./aurora-interpretation-timing";

export type AuroraUniverseResult = { version: "aurora-universe-v1"; snapshot: AuroraResultSnapshot; context: AuroraInterpretationContext } & (
  { status: "interpreted"; interpretation: AuroraInterpretationResult } |
  { status: "quote-unavailable"; interpretation: null });
export type AuroraUniverseFailure = AIUsageErrorCode | "AI_NOT_CONFIGURED" | "INVALID_INPUT" | "APPROVAL_MISMATCH" | "REQUEST_TOO_LARGE"
  | "AUTH_REQUIRED" | "ACCESS_DENIED" | "USAGE_LIMITED" | "SECURITY_UNAVAILABLE"
  | "INTERPRETATION_FAILED" | "INTERPRETATION_RESPONSE_INVALID" | "CONNECTION_FAILED" | "REQUEST_TIMEOUT" | "RESULT_TRANSITION_FAILED";
export type AuroraUniversePhase = "preparing" | "requesting" | "validating";
const failures: readonly AuroraUniverseFailure[] = ["AI_NOT_CONFIGURED", "INVALID_INPUT", "APPROVAL_MISMATCH", "REQUEST_TOO_LARGE", "INTERPRETATION_FAILED",
  "INTERPRETATION_RESPONSE_INVALID", "CONNECTION_FAILED", "REQUEST_TIMEOUT", "RESULT_TRANSITION_FAILED", "AUTH_REQUIRED", "ACCESS_DENIED", "USAGE_LIMITED", "SECURITY_UNAVAILABLE", ...Object.keys(AI_USAGE_MESSAGES) as AIUsageErrorCode[]];
export function auroraUniverseFailureMessage(code: AuroraUniverseFailure): string {
  const messages: Record<AuroraUniverseFailure, string> = {
    ...AI_USAGE_MESSAGES,
    AUTH_REQUIRED: "세션이 만료되었어요. 다시 로그인해 주세요.", ACCESS_DENIED: "계정 권한 또는 요청 출처를 확인해 주세요.",
    USAGE_LIMITED: "사용 한도에 도달했거나 생성이 진행 중이에요. 잠시 후 다시 시도해 주세요.", SECURITY_UNAVAILABLE: "보안 또는 예산 설정을 확인하지 못했어요. 관리자에게 문의해 주세요.",
    AI_NOT_CONFIGURED: "해석 서비스가 아직 설정되지 않았어요. 관리자에게 설정을 확인해 주세요.",
    INVALID_INPUT: "해석에 사용할 답변 상태를 확인하지 못했어요.", APPROVAL_MISMATCH: "지금 답변과 마지막 문장의 승인 상태를 다시 확인해 주세요.",
    REQUEST_TOO_LARGE: "해석할 표현이 너무 길어요. 입력을 조금 줄인 뒤 다시 승인해 주세요.",
    INTERPRETATION_FAILED: "해석 서버가 요청을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.",
    INTERPRETATION_RESPONSE_INVALID: "완성된 해석과 리본의 연결을 확인하지 못했어요. 다시 요청할 수 있어요.",
    CONNECTION_FAILED: "해석 서비스에 연결하지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.",
    REQUEST_TIMEOUT: "해석 요청의 제한 시간이 지났어요. 잠시 후 다시 요청할 수 있어요.",
    RESULT_TRANSITION_FAILED: "완성된 우주 화면으로 이동하지 못했어요. 다시 시도해 주세요.",
  };
  return `${messages[code]} 선택한 답변과 승인한 문장은 그대로 유지됩니다.`;
}
/** Quality changes subdivision/mist budget, never silently remap meanings or pay
 * for another interpretation. Refuse changes if core identity ever diverges. */
export function universeRibbonLayout(result: AuroraUniverseResult, quality: AuroraQuality) {
  const layout = createAuroraRibbonLayout(result.snapshot.personalization.appearance, quality, result.context.binding.flowMode);
  const active = layout.ribbons.filter(r => r.active), facts = result.context.facts.ribbons;
  if (active.length !== facts.length || active.some(r => {
    const f = facts.find(f => f.ribbonId === r.ribbonId);
    return !f || canonicalInterpretationValue([r.layers[0].shape, r.layers[0].visual, r.layers[0].identityProfile])
      !== canonicalInterpretationValue([f.layers[0].shape, f.layers[0].visual, f.layers[0].identityProfile]);
  })) return null;
  return facts.map(f => ({ ...f, layers: active.find(r => r.ribbonId === f.ribbonId)!.layers }));
}
interface UniverseCallbacks {
  isCurrent: () => boolean;
  start: () => void;
  phase?: (phase: AuroraUniversePhase) => void;
  success: (result: AuroraUniverseResult) => void;
  failure: (code: AuroraUniverseFailure) => void;
  settled: () => void;
}
interface Token { controller: AbortController; fingerprint: string; callbacks: UniverseCallbacks; timer: ReturnType<typeof setTimeout> | null; timedOut: boolean }
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error("REQUEST_ABORTED"));
    if (signal.aborted) { promise.catch(() => {}); abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
/** Single lock includes async local digest preparation, JSON parsing and transition.
 * No automatic client retries or legacy analyze call. Nothing is stored globally. */
export class AuroraUniverseRequestController {
  private active: Token | null = null;
  constructor(private readonly fetcher: typeof fetch = (...args) => globalThis.fetch(...args), private readonly timeoutMs: number = INTERPRETATION_BROWSER_TIMEOUT_MS) {}
  get busy(): boolean { return this.active !== null; }
  get fingerprint(): string | null { return this.active?.fingerprint ?? null; }
  cancel(notify = true): void {
    const token = this.active;
    if (!token) return;
    this.active = null;
    if (token.timer) clearTimeout(token.timer);
    token.controller.abort();
    if (notify) token.callbacks.settled();
  }
  async generate(state: QuestionnaireState, callbacks: UniverseCallbacks, quality: AuroraQuality = "balanced", flowMode: AuroraFlowMode = "hybrid", situation?: string): Promise<void> {
    if (this.active || !callbacks.isCurrent()) return;
    const prepared = prepareAuroraResult(state);
    if (!prepared.ready) { callbacks.failure("APPROVAL_MISMATCH"); return; }
    const token: Token = { controller: new AbortController(), fingerprint: prepared.snapshot.inputFingerprint, callbacks, timer: null, timedOut: false };
    this.active = token;
    const current = () => this.active === token && callbacks.isCurrent();
    let stage: AuroraUniversePhase | "transition" = "preparing";
    try {
      callbacks.start(); callbacks.phase?.("preparing");
      token.timer = setTimeout(() => { token.timedOut = true; token.controller.abort(); }, this.timeoutMs);
      const payload = buildAuroraInterpretationRequest(state, quality, flowMode, situation);
      const context = await abortable(prepareAuroraInterpretation(payload), token.controller.signal);
      if (!current()) return;
      stage = "requesting"; callbacks.phase?.(stage);
      const response = await abortable(this.fetcher("/api/aurora-interpretation", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload), signal: token.controller.signal }), token.controller.signal);
      if (!current()) return;
      stage = "validating"; callbacks.phase?.(stage);
      const body: unknown = await abortable(response.json(), token.controller.signal);
      if (!current()) return;
      let result: AuroraUniverseResult;
      if (!response.ok) {
        const code = body && typeof body === "object" && "code" in body ? body.code : undefined;
        if (response.status === 422 && code === "QUOTE_CANDIDATES_INSUFFICIENT") {
          result = { version: "aurora-universe-v1", snapshot: prepared.snapshot, context, status: "quote-unavailable", interpretation: null };
        } else {
          callbacks.failure(response.status === 401 ? "AUTH_REQUIRED" : response.status === 403 ? "ACCESS_DENIED" : response.status === 429 ? isAIUsageErrorCode(code) ? code : "USAGE_LIMITED" : response.status === 503 && code !== "AI_NOT_CONFIGURED" ? "SECURITY_UNAVAILABLE" : response.status === 408 ? "REQUEST_TIMEOUT" : typeof code === "string" && failures.includes(code as AuroraUniverseFailure)
            ? code as AuroraUniverseFailure : "INTERPRETATION_FAILED"); return;
        }
      } else result = { version: "aurora-universe-v1", snapshot: prepared.snapshot, context, status: "interpreted", interpretation: validateAuroraInterpretationResponse(body, context) };
      if (!current() || token.controller.signal.aborted) return;
      stage = "transition"; callbacks.success(result);
    } catch (error) {
      if (current()) callbacks.failure(token.timedOut ? "REQUEST_TIMEOUT" : stage === "transition" ? "RESULT_TRANSITION_FAILED"
        : error instanceof AuroraInterpretationError ? failures.includes(error.code as AuroraUniverseFailure) ? error.code as AuroraUniverseFailure : "INTERPRETATION_RESPONSE_INVALID"
          : stage === "requesting" ? "CONNECTION_FAILED" : "INTERPRETATION_RESPONSE_INVALID");
    } finally {
      if (token.timer) clearTimeout(token.timer);
      if (this.active === token) { this.active = null; callbacks.settled(); }
    }
  }
}
