import type { Feature } from "./policy";

type LimitCode = "AI_BUDGET_LIMIT" | "USER_DAILY_LIMIT" | "GLOBAL_REQUEST_LIMIT" | "AI_BUSY" | "DUPLICATE_REQUEST";
export type LimitReason = "USER_MONTH_USD" | "GLOBAL_DAY_USD" | "GLOBAL_MONTH_USD" | "USER_DAY_REQUESTS"
  | "GLOBAL_DAY_REQUESTS" | "GLOBAL_MONTH_REQUESTS" | "USER_CONCURRENCY" | "GLOBAL_CONCURRENCY" | "DUPLICATE_WINDOW";
const reasons: readonly LimitReason[] = ["USER_MONTH_USD", "GLOBAL_DAY_USD", "GLOBAL_MONTH_USD", "USER_DAY_REQUESTS",
  "GLOBAL_DAY_REQUESTS", "GLOBAL_MONTH_REQUESTS", "USER_CONCURRENCY", "GLOBAL_CONCURRENCY", "DUPLICATE_WINDOW"];
const codes: readonly LimitCode[] = ["AI_BUDGET_LIMIT", "USER_DAILY_LIMIT", "GLOBAL_REQUEST_LIMIT", "AI_BUSY", "DUPLICATE_REQUEST"];
const numericFields = ["reservedUsd", "userMonthChargedUsd", "userMonthLimitUsd", "globalDayChargedUsd", "globalDayLimitUsd",
  "globalMonthChargedUsd", "globalMonthLimitUsd", "userDayRequests", "userDayLimit", "globalDayRequests", "globalDayLimit",
  "globalMonthRequests", "globalMonthLimit", "pendingRequests", "concurrencyLimit", "maxInputTokens", "maxOutputTokens", "maxAttempts"] as const;
export type UsageLimitNumbers = Partial<Record<typeof numericFields[number], number>>;

/** Preview failure metadata only. Reconstruct an allowlist; never spread caller data. */
export function logUsageDenial(feature: Feature, code: LimitCode, denied: readonly LimitReason[],
  numbers: UsageLimitNumbers, userBudgetSource: "account" | "environment"): void {
  if (process.env.VERCEL_ENV !== "preview") return;
  try {
    if (!["closing", "interpretation", "analyze"].includes(feature) || !codes.includes(code)) return;
    const matched = reasons.filter(reason => denied.includes(reason)); if (!matched.length) return;
    const safeNumbers = Object.fromEntries(numericFields.filter(key => Object.hasOwn(numbers, key)).map(key => {
      const n = numbers[key]; return [key, typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null];
    }));
    console.error("[private-beta-usage-limit]", { stage: "usage.reserve", code, feature, reasons: matched,
      userBudgetSource: userBudgetSource === "account" ? "account" : "environment", ...safeNumbers });
  } catch { /* A broken log sink must never change the original denial. */ }
}

/** Provider usage and ledger settlement remain separate estimates, never invoices. */
export function logUsageAccounting(feature: Feature, stage: "model.usage" | "usage.finish", state: "reported" | "uncertain" | "success" | "failed" | "no-model",
  values: Partial<Record<"promptTokens" | "completionTokens" | "cachedTokens" | "reasoningTokens" | "estimatedUsd" | "reservedUsd" | "chargedUsd" | "attempts", number | null>>): void {
  if (process.env.VERCEL_ENV !== "preview") return;
  try {
    if (!["closing", "interpretation", "analyze"].includes(feature) || !["model.usage", "usage.finish"].includes(stage)
      || !["reported", "uncertain", "success", "failed", "no-model"].includes(state)) return;
    const keys = ["promptTokens", "completionTokens", "cachedTokens", "reasoningTokens", "estimatedUsd", "reservedUsd", "chargedUsd", "attempts"] as const;
    const safe = Object.fromEntries(keys.filter(key => Object.hasOwn(values, key)).map(key => {
      const n = values[key]; return [key, typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null];
    }));
    console.info("[private-beta-usage-accounting]", { feature, stage, state, ...safe });
  } catch { /* Never change authorization, model retries or settlement. */ }
}
