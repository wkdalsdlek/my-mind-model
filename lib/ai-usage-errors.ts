/** Public, fixed guidance only; never balances, account fields or server config. */
export const AI_USAGE_MESSAGES = {
  AI_BUDGET_LIMIT: "AI 요청에 필요한 일간 또는 월간 예산이 부족해요. 관리자에게 예산을 확인해 주세요. 1분 후 자동으로 해제되는 제한은 아니에요.",
  USER_DAILY_LIMIT: "오늘의 개인 생성 횟수를 모두 사용했어요. 다음 한국 시간 자정 이후 다시 시도해 주세요.",
  GLOBAL_REQUEST_LIMIT: "전체 서비스의 일간 또는 월간 요청 횟수에 도달했어요. 관리자에게 확인하거나 해당 기간이 바뀐 뒤 다시 시도해 주세요.",
  AI_BUSY: "진행 중인 AI 요청이 있어요. 요청이 끝난 뒤 다시 시도해 주세요.",
  DUPLICATE_REQUEST: "같은 답변으로 방금 요청했어요. 앞선 요청을 확인하고, 요청 시작 후 1분이 지난 뒤 다시 시도해 주세요.",
  REQUEST_RATE_LIMIT: "짧은 시간에 요청이 많았어요. 1분 뒤 다시 시도해 주세요.",
} as const;
export type AIUsageErrorCode = keyof typeof AI_USAGE_MESSAGES;
export function isAIUsageErrorCode(value: unknown): value is AIUsageErrorCode {
  return typeof value === "string" && Object.hasOwn(AI_USAGE_MESSAGES, value);
}
