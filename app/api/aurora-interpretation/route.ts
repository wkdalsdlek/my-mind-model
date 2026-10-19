import { protectAI } from "../../../lib/server/security/api";
import OpenAI from "openai";
import { SecurityError } from "../../../lib/server/security/policy";
import { INTERPRETATION_TIMING } from "../../../lib/server/interpretation-deadline";
import { interpretationProviderRequest, parseInterpretationProviderResponse } from "../../../lib/server/aurora-interpretation-provider";
import { createAuroraInterpretationHandler,
  INTERPRETATION_MODEL, INTERPRETATION_REASONING_EFFORT, INTERPRETATION_MAX_COMPLETION_TOKENS } from "../../../lib/server/aurora-interpretation-service";

export const runtime = "nodejs";
export const maxDuration = 240;
/** Primary interpretation endpoint; legacy analyze remains independently available. */
export const POST = protectAI("interpretation", async (req, permit, deadline) => createAuroraInterpretationHandler({
  deadline,
  apiKey: () => process.env.OPENAI_API_KEY,
  parse: parseInterpretationProviderResponse,
  isTimeoutError: error => typeof OpenAI.APIConnectionTimeoutError === "function" && error instanceof OpenAI.APIConnectionTimeoutError,
  providerStatus: error => typeof OpenAI.APIError === "function" && error instanceof OpenAI.APIError ? error.status : undefined,
  complete: async ({ apiKey, context, attempt, signal, remainingMs, validationFailure, providerCompleted }) => {
    const provider = interpretationProviderRequest(context);
    const parameters: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
      model: INTERPRETATION_MODEL, reasoning_effort: INTERPRETATION_REASONING_EFFORT, max_completion_tokens: INTERPRETATION_MAX_COMPLETION_TOKENS,
      store: false, service_tier: "default", response_format: provider.responseFormat,
      messages: [{ role: "system", content: provider.systemPrompt },
        ...(attempt === 2 ? [{ role: "system" as const, content: `이전 응답의 고정 검증 코드: ${validationFailure ?? "invalid-shape"}. 실제 근거 참조와 모든 활성 리본 및 본문을 포함해 지정된 구조를 한 번만 새로 완성하세요. 근거를 새로 만들거나 본문을 생략하지 마세요.` }] : []),
        { role: "user", content: JSON.stringify(provider.input) }],
    };
    const response = await permit.run(parameters, async () => {
      const timeout = remainingMs();
      if (signal.aborted || timeout < INTERPRETATION_TIMING.minAttemptMs) throw new SecurityError("REQUEST_TIMEOUT", 408);
      const openai = new OpenAI({ apiKey, maxRetries: 0, timeout, logLevel: "off" });
      deadline?.stage("provider");
      try {
        const result = await openai.chat.completions.create(parameters, { signal });
        providerCompleted();
        return result;
      }
      finally { deadline?.stage("model-accounting"); }
    }, signal);
    const choice = response.choices[0];
    return { content: choice?.message.content ?? null, finishReason: choice?.finish_reason ?? null, refused: !!choice?.message.refusal,
      usage: response.usage ? { promptTokens: response.usage.prompt_tokens, completionTokens: response.usage.completion_tokens, totalTokens: response.usage.total_tokens,
        reasoningTokens: response.usage.completion_tokens_details?.reasoning_tokens, cachedPromptTokens: response.usage.prompt_tokens_details?.cached_tokens } : undefined };
  },
})(req));
