import OpenAI from "openai";
import { createAuroraInterpretationHandler, interpretationModelInput, interpretationResponseFormat, INTERPRETATION_SYSTEM_PROMPT,
  INTERPRETATION_MODEL, INTERPRETATION_REASONING_EFFORT, INTERPRETATION_MAX_COMPLETION_TOKENS, INTERPRETATION_LIMITS } from "../../../lib/server/aurora-interpretation-service";

export const runtime = "nodejs";
export const maxDuration = 100;
/** Additive endpoint, deliberately not called by the existing result UI. */
export const POST = createAuroraInterpretationHandler({
  apiKey: () => process.env.OPENAI_API_KEY,
  complete: async ({ apiKey, context, attempt, signal }) => {
    const openai = new OpenAI({ apiKey, maxRetries: 0, timeout: INTERPRETATION_LIMITS.attemptMs, logLevel: "off" });
    const response = await openai.chat.completions.create({
      model: INTERPRETATION_MODEL, reasoning_effort: INTERPRETATION_REASONING_EFFORT, max_completion_tokens: INTERPRETATION_MAX_COMPLETION_TOKENS,
      store: false, service_tier: "default", response_format: interpretationResponseFormat(context),
      messages: [{ role: "system", content: INTERPRETATION_SYSTEM_PROMPT },
        ...(attempt === 2 ? [{ role: "system" as const, content: "이전 응답이 검증에 실패했습니다. 실제 근거 참조와 모든 활성 리본을 포함해 지정된 구조를 한 번만 새로 완성하세요." }] : []),
        { role: "user", content: JSON.stringify(interpretationModelInput(context)) }],
    }, { signal });
    const choice = response.choices[0];
    return { content: choice?.message.content ?? null, finishReason: choice?.finish_reason ?? null, refused: !!choice?.message.refusal,
      usage: response.usage ? { promptTokens: response.usage.prompt_tokens, completionTokens: response.usage.completion_tokens, totalTokens: response.usage.total_tokens,
        reasoningTokens: response.usage.completion_tokens_details?.reasoning_tokens, cachedPromptTokens: response.usage.prompt_tokens_details?.cached_tokens } : undefined };
  },
});
