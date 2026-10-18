import { protectAI } from "../../../lib/server/security/api";
import OpenAI from "openai";
import { SecurityError } from "../../../lib/server/security/policy";
import { INTERPRETATION_TIMING } from "../../../lib/server/interpretation-deadline";
import { createAuroraInterpretationHandler, interpretationModelInput, interpretationResponseFormat, interpretationSystemPrompt,
  INTERPRETATION_MODEL, INTERPRETATION_REASONING_EFFORT, INTERPRETATION_MAX_COMPLETION_TOKENS } from "../../../lib/server/aurora-interpretation-service";

export const runtime = "nodejs";
export const maxDuration = 100;
/** Primary interpretation endpoint; legacy analyze remains independently available. */
export const POST = protectAI("interpretation", async (req, permit, deadline) => createAuroraInterpretationHandler({
  deadline,
  apiKey: () => process.env.OPENAI_API_KEY,
  isTimeoutError: error => typeof OpenAI.APIConnectionTimeoutError === "function" && error instanceof OpenAI.APIConnectionTimeoutError,
  complete: async ({ apiKey, context, attempt, signal, remainingMs }) => {
    const parameters: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
      model: INTERPRETATION_MODEL, reasoning_effort: INTERPRETATION_REASONING_EFFORT, max_completion_tokens: INTERPRETATION_MAX_COMPLETION_TOKENS,
      store: false, service_tier: "default", response_format: interpretationResponseFormat(context),
      messages: [{ role: "system", content: interpretationSystemPrompt(context) },
        ...(attempt === 2 ? [{ role: "system" as const, content: "이전 응답이 검증에 실패했습니다. 실제 근거 참조와 모든 활성 리본을 포함해 지정된 구조를 한 번만 새로 완성하세요." }] : []),
        { role: "user", content: JSON.stringify(interpretationModelInput(context)) }],
    };
    const response = await permit.run(parameters, () => {
      const timeout = remainingMs();
      if (signal.aborted || timeout < INTERPRETATION_TIMING.minAttemptMs) throw new SecurityError("REQUEST_TIMEOUT", 408);
      const openai = new OpenAI({ apiKey, maxRetries: 0, timeout, logLevel: "off" });
      return openai.chat.completions.create(parameters, { signal });
    }, signal);
    const choice = response.choices[0];
    return { content: choice?.message.content ?? null, finishReason: choice?.finish_reason ?? null, refused: !!choice?.message.refusal,
      usage: response.usage ? { promptTokens: response.usage.prompt_tokens, completionTokens: response.usage.completion_tokens, totalTokens: response.usage.total_tokens,
        reasoningTokens: response.usage.completion_tokens_details?.reasoning_tokens, cachedPromptTokens: response.usage.prompt_tokens_details?.cached_tokens } : undefined };
  },
})(req));
