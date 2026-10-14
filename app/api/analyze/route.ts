import OpenAI from "openai";
import { ANALYSIS_MAX_COMPLETION_TOKENS, ANALYSIS_MODEL, ANALYSIS_REASONING_EFFORT, ANALYSIS_RESPONSE_FORMAT, ANALYSIS_SYSTEM_PROMPT, createAnalysisHandler } from "../../../lib/server/analysis-service";

export const runtime = "nodejs";
export const maxDuration = 100;
export const POST = createAnalysisHandler({
  apiKey: () => process.env.OPENAI_API_KEY,
  complete: async ({ apiKey, input, attempt, retryReason, signal }) => {
    // The service owns the two-call budget; SDK retries and payload logs stay off.
    const openai = new OpenAI({ apiKey, maxRetries: 0, timeout: 45000, logLevel: "off" });
    const response = await openai.chat.completions.create({
      model: ANALYSIS_MODEL, reasoning_effort: ANALYSIS_REASONING_EFFORT,
      max_completion_tokens: ANALYSIS_MAX_COMPLETION_TOKENS, store: false, service_tier: "default",
      response_format: ANALYSIS_RESPONSE_FORMAT,
      messages: [{ role: "system", content: ANALYSIS_SYSTEM_PROMPT },
        ...(attempt === 2 ? [{ role: "system" as const, content: `이전 응답은 검증에 실패했습니다(${retryReason}). Q1~Q10 전체를 지정된 구조와 비어 있지 않은 두 분석 필드로 새로 완성하세요.` }] : []),
        { role: "user", content: JSON.stringify(input) }],
    }, { signal });
    const choice = response.choices[0];
    return { content: choice?.message.content ?? null, finishReason: choice?.finish_reason ?? null, refused: !!choice?.message.refusal,
      usage: response.usage ? { promptTokens: response.usage.prompt_tokens, completionTokens: response.usage.completion_tokens, totalTokens: response.usage.total_tokens,
        reasoningTokens: response.usage.completion_tokens_details?.reasoning_tokens, cachedPromptTokens: response.usage.prompt_tokens_details?.cached_tokens } : undefined };
  },
});
