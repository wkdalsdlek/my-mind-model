import { SecurityError } from "./security/policy";

export const INTERPRETATION_TIMING = {
  attemptMs: 70000, workMs: 85000, totalMs: 95000, settlementMs: 10000, minAttemptMs: 20000,
} as const;
export type InterpretationStage = "authentication" | "origin" | "rate-limit" | "body" | "reservation" | "input" | "model" | "settlement" | "session-check" | "response";
export type InterpretationAbortSource = "none" | "client-abort" | "attempt-timeout" | "work-timeout" | "total-timeout" | "sdk-timeout" | "insufficient-time";

/** Observe cancellation without ever leaving a late rejection unhandled. Does not
 * imply that a remote provider or a PostgreSQL transaction has stopped. */
export function awaitSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => reject(new SecurityError("REQUEST_TIMEOUT", 408));
    if (signal.aborted) { void promise.catch(() => {}); abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    promise.then(value => { signal.removeEventListener("abort", abort); resolve(value); }, error => {
      signal.removeEventListener("abort", abort); reject(error);
    });
  });
}

/** One request-local, monotonic clock, created before authentication. */
export class InterpretationDeadline {
  readonly startedAt = performance.now();
  private readonly work = new AbortController();
  private readonly total = new AbortController();
  private readonly workTimer: ReturnType<typeof setTimeout>;
  private readonly totalTimer: ReturnType<typeof setTimeout>;
  readonly signal: AbortSignal;
  readonly totalSignal: AbortSignal;
  private phase: InterpretationStage = "authentication";
  constructor(readonly clientSignal: AbortSignal) {
    this.workTimer = setTimeout(() => this.work.abort(), INTERPRETATION_TIMING.workMs);
    this.totalTimer = setTimeout(() => this.total.abort(), INTERPRETATION_TIMING.totalMs);
    this.workTimer.unref?.(); this.totalTimer.unref?.();
    this.signal = AbortSignal.any([clientSignal, this.work.signal, this.total.signal]);
    // HTTP completion races the server deadline, while client cancellation still
    // leaves time to durably settle the already-reserved attempt.
    this.totalSignal = this.total.signal;
  }
  elapsedMs(): number { return Math.max(0, performance.now() - this.startedAt); }
  remainingMs(): number { return Math.max(0, Math.floor(INTERPRETATION_TIMING.totalMs - this.elapsedMs())); }
  remainingWorkMs(): number { return Math.max(0, Math.floor(INTERPRETATION_TIMING.workMs - this.elapsedMs())); }
  source(): InterpretationAbortSource {
    return this.clientSignal.aborted ? "client-abort" : this.total.signal.aborted || !this.remainingMs() ? "total-timeout"
      : this.work.signal.aborted || !this.remainingWorkMs() ? "work-timeout" : "none";
  }
  checkWork(): void { if (this.source() !== "none") throw new SecurityError("REQUEST_TIMEOUT", 408); }
  checkResponse(): void {
    if (this.clientSignal.aborted || !this.remainingMs() || this.totalSignal.aborted) throw new SecurityError("REQUEST_TIMEOUT", 408);
  }
  stage(stage: InterpretationStage): void { this.phase = stage; this.log(); }
  log(source = this.source()): void {
    if (process.env.VERCEL_ENV !== "preview") return;
    try { console.info("[aurora-request-deadline]", { stage: this.phase, abortSource: source,
      elapsedMs: Math.round(this.elapsedMs()), remainingMs: this.remainingMs(), remainingWorkMs: this.remainingWorkMs(),
      totalTimeoutMs: INTERPRETATION_TIMING.totalMs, workTimeoutMs: INTERPRETATION_TIMING.workMs }); } catch { /* No effect on access or billing. */ }
  }
  attempt(): { signal: AbortSignal; timeoutMs: number; remainingMs: () => number; source: () => InterpretationAbortSource; dispose: () => void } {
    this.checkWork();
    const timeoutMs = Math.min(INTERPRETATION_TIMING.attemptMs, this.remainingWorkMs());
    if (timeoutMs < INTERPRETATION_TIMING.minAttemptMs) {
      this.log("insufficient-time"); throw new SecurityError("REQUEST_TIMEOUT", 408);
    }
    const expiresAt = performance.now() + timeoutMs, timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), timeoutMs); timer.unref?.();
    const signal = AbortSignal.any([this.signal, timeout.signal]);
    return { signal, timeoutMs,
      remainingMs: () => Math.max(0, Math.floor(Math.min(expiresAt - performance.now(), this.remainingWorkMs(), this.remainingMs() - INTERPRETATION_TIMING.settlementMs))),
      source: () => this.source() !== "none" ? this.source() : timeout.signal.aborted || performance.now() >= expiresAt ? "attempt-timeout" : "none",
      dispose: () => clearTimeout(timer) };
  }
  async respond(task: Promise<Response>): Promise<Response> {
    try { return await awaitSignal(task, this.totalSignal); }
    catch (error) { this.log(); throw error; }
  }
  dispose(): void { clearTimeout(this.workTimer); clearTimeout(this.totalTimer); }
}
