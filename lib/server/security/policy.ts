/** Fail closed: every value comes from server-owned configuration, never Host. */
export type Feature = "closing" | "interpretation" | "analyze";
export class SecurityError extends Error {
  constructor(readonly code: string, readonly status = 503) { super(code); }
}
export const securityFailure = (e: unknown) => Response.json({ code: e instanceof SecurityError ? e.code : "SECURITY_UNAVAILABLE",
  error: e instanceof SecurityError && e.status === 401 ? "로그인이 필요합니다." : e instanceof SecurityError && e.status === 429
    ? "사용 한도에 도달했거나 요청이 진행 중입니다. 잠시 후 다시 시도해 주세요. 답변은 유지됩니다." : "접근 권한 또는 서비스 설정을 확인해 주세요. 답변은 유지됩니다." },
  { status: e instanceof SecurityError ? e.status : 503, headers: { "Cache-Control": "no-store", ...(e instanceof SecurityError && e.status === 429 ? { "Retry-After": "60" } : {}) } });
export function authConfig(env: NodeJS.ProcessEnv = process.env) {
  const secret = env.BETTER_AUTH_SECRET, database = env.DATABASE_URL;
  if (!database || !secret || secret.length < 32) throw new SecurityError("AUTH_NOT_CONFIGURED");
  const origins = [...new Set([env.BETTER_AUTH_URL, ...(env.AUTH_TRUSTED_ORIGINS || "").split(",")].filter(Boolean))].map(value => {
    let url: URL; try { url = new URL(value!.trim()); } catch { throw new SecurityError("AUTH_NOT_CONFIGURED"); }
    if (url.origin !== value!.trim() || url.username || url.password || (url.protocol !== "https:" && !(env.NODE_ENV !== "production" && url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)))) throw new SecurityError("AUTH_NOT_CONFIGURED");
    return url.origin;
  });
  if (!env.BETTER_AUTH_URL || !origins.length) throw new SecurityError("AUTH_NOT_CONFIGURED");
  return { secret, database, origins, baseURL: origins[0] };
}
export function checkOrigin(req: Request, origins: string[]) {
  const origin = req.headers.get("origin");
  if (!origin || !origins.includes(origin) || req.headers.get("sec-fetch-site") === "cross-site") throw new SecurityError("REQUEST_FORBIDDEN", 403);
  const ref = req.headers.get("referer");
  if (ref) { try { if (new URL(ref).origin !== origin) throw new Error(); } catch { throw new SecurityError("REQUEST_FORBIDDEN", 403); } }
  if (req.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new SecurityError("INVALID_CONTENT_TYPE", 415);
}
export function seoulPeriods(now: Date) {
  const day = new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
  return { day, month: day.slice(0, 7) };
}
const positive = (value: string | undefined) => { const n = Number(value); if (!Number.isFinite(n) || n <= 0) throw new SecurityError("BUDGET_NOT_CONFIGURED"); return n; };
const count = (value:string|undefined) => { const n=positive(value); if(!Number.isSafeInteger(n))throw new SecurityError("BUDGET_NOT_CONFIGURED");return n; };
export interface Price { input: number; cachedInput: number; output: number; maxInputTokens: number; verifiedAt: string; source: string }
export function budgetConfig(env: NodeJS.ProcessEnv = process.env) {
  let prices: Record<string, Price>; try { prices = JSON.parse(env.AI_MODEL_PRICES_JSON || ""); } catch { throw new SecurityError("BUDGET_NOT_CONFIGURED"); }
  for (const model of ["gpt-4o-mini", "gpt-6.1-sol"]) {
    const p = prices?.[model];
    if (!p || [p.input, p.cachedInput, p.output, p.maxInputTokens].some(x => !Number.isFinite(x) || x <= 0)
      || p.cachedInput > p.input || !Number.isSafeInteger(p.maxInputTokens) || !/^\d{4}-\d{2}-\d{2}$/.test(p.verifiedAt) || !p.source?.startsWith("https://")) throw new SecurityError("BUDGET_NOT_CONFIGURED");
  }
  return { prices, userMonth: positive(env.AI_USER_MONTH_USD), globalDay: positive(env.AI_GLOBAL_DAY_USD), globalMonth: positive(env.AI_GLOBAL_MONTH_USD),
    globalDayRequests: count(env.AI_GLOBAL_DAY_REQUESTS), globalMonthRequests: count(env.AI_GLOBAL_MONTH_REQUESTS), concurrency: count(env.AI_GLOBAL_CONCURRENCY) };
}
export function featureModel(feature: Feature) { return feature === "closing" ? { model: "gpt-4o-mini", output: 180, attempts: 1 } : { model: "gpt-6.1-sol", output: 25000, attempts: 2 }; }
/** Request-local Preview override. Bytes also remain a conservative token bound
 * for reservation and reported usage; never mutate the shared price settings. */
export function featureBudgetConfig(feature: Feature, env: NodeJS.ProcessEnv = process.env): ReturnType<typeof budgetConfig> {
  const config = budgetConfig(env);
  if (feature !== "interpretation" || env.VERCEL_ENV !== "preview") return config;
  const raw = env.AI_INTERPRETATION_MAX_INPUT_BYTES;
  if (raw === undefined) return config;
  const limit = Number(raw);
  if (!Number.isSafeInteger(limit) || String(limit) !== raw || limit < 4096 || limit > 60000) throw new SecurityError("BUDGET_NOT_CONFIGURED");
  const { model } = featureModel(feature);
  return { ...config, prices: { ...config.prices, [model]: { ...config.prices[model], maxInputTokens: limit } } };
}
export function cost(p: Price, input: number, output: number, cached = 0) {
  return ((input - cached) * p.input + cached * p.cachedInput + output * p.output) / 1000000;
}
