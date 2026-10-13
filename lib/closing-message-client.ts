import { closingInputFingerprint, CLOSING_ERRORS, validAIClosingText, validateClosingMessageInput, type ClosingErrorCode, type ClosingMessageInput } from "./closing-message";

interface RequestCallbacks {
  start: (id: string, inputFingerprint: string) => void;
  success: (id: string, inputFingerprint: string, text: string) => void;
  failure: (id: string, inputFingerprint: string, code: ClosingErrorCode) => void;
}
type DiagnosticStage = "input" | "fetch" | "response-json" | "response";
type DiagnosticCode = "INPUT_INVALID" | "FETCH_CONTEXT_INVALID" | "FETCH_FAILED" | "REQUEST_TIMEOUT" | "RESPONSE_JSON_INVALID" | "RESPONSE_INVALID" | "SERVER_ERROR" | "CLIENT_ERROR";
function reportDevelopmentFailure(code: ClosingErrorCode, diagnostic: DiagnosticCode, stage: DiagnosticStage, status?: number): void {
  if (process.env.NODE_ENV === "development") {
    // Only fixed categories and HTTP status: never log errors, payloads, IDs or fingerprints.
    console.warn("[q10-closing-message]", { code, diagnostic, stage, ...(status === undefined ? {} : { status }) });
  }
}
/** Synchronous single-flight lock, cancellation and identity checks outside React render timing. */
export class ClosingMessageRequestController {
  private active: { id: string; fingerprint: string; controller: AbortController } | null = null;
  constructor(private readonly fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init), private readonly nextId: () => string = () => crypto.randomUUID()) {}
  get fingerprint(): string | null { return this.active?.fingerprint ?? null; }
  cancel(): void {
    const request = this.active;
    this.active = null;
    request?.controller.abort();
  }
  async generate(input: ClosingMessageInput, previousText: string | undefined, callbacks: RequestCallbacks): Promise<void> {
    if (this.active) return;
    const request = { id: this.nextId(), fingerprint: closingInputFingerprint(input), controller: new AbortController() };
    this.active = request;
    callbacks.start(request.id, request.fingerprint);
    let timeout = false;
    let stage: DiagnosticStage = "input";
    let status: number | undefined;
    const timer = setTimeout(() => { timeout = true; request.controller.abort(); }, 35000);
    try {
      validateClosingMessageInput(input);
      stage = "fetch";
      const response = await this.fetcher("/api/closing-message", { method: "POST", headers: { "Content-Type": "application/json" }, signal: request.controller.signal,
        body: JSON.stringify({ requestId: request.id, input, ...(previousText ? { previousText } : {}) }) });
      status = response.status;
      stage = "response-json";
      const body: unknown = await response.json();
      if (this.active !== request) return;
      stage = "response";
      if (!response.ok) {
        const code = body && typeof body === "object" && "code" in body && typeof body.code === "string" && Object.hasOwn(CLOSING_ERRORS, body.code) ? body.code as ClosingErrorCode : "CLOSING_FAILED";
        reportDevelopmentFailure(code, "SERVER_ERROR", stage, status);
        callbacks.failure(request.id, request.fingerprint, code);
      } else if (body && typeof body === "object" && "requestId" in body && body.requestId === request.id && "text" in body && validAIClosingText(body.text)) {
        callbacks.success(request.id, request.fingerprint, body.text);
      } else {
        reportDevelopmentFailure("INVALID_AI_RESPONSE", "RESPONSE_INVALID", stage, status);
        callbacks.failure(request.id, request.fingerprint, "INVALID_AI_RESPONSE");
      }
    } catch (error) {
      if (this.active === request) {
        const code: ClosingErrorCode = error && typeof error === "object" && "code" in error && (error.code === "INVALID_INPUT" || error.code === "REQUEST_TOO_LARGE") ? error.code : "CLOSING_FAILED";
        const failureCode = timeout ? "CLOSING_FAILED" : code;
        const diagnostic: DiagnosticCode = timeout ? "REQUEST_TIMEOUT" : stage === "input" ? "INPUT_INVALID"
          : stage === "response-json" ? "RESPONSE_JSON_INVALID"
          : stage === "fetch" ? error instanceof TypeError && error.message.includes("Illegal invocation") ? "FETCH_CONTEXT_INVALID" : "FETCH_FAILED"
          : "CLIENT_ERROR";
        reportDevelopmentFailure(failureCode, diagnostic, stage, status);
        callbacks.failure(request.id, request.fingerprint, failureCode);
      }
    } finally {
      clearTimeout(timer);
      if (this.active === request) this.active = null;
    }
  }
}
