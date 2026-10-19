import { protectAI } from "../../../lib/server/security/api";
import OpenAI from "openai";
import { CLOSING_MESSAGE_MODEL, CLOSING_MESSAGE_REASONING_EFFORT, CLOSING_MESSAGE_MAX_COMPLETION_TOKENS,
  CLOSING_MESSAGE_SYSTEM_PROMPT, CLOSING_RESPONSE_FORMAT, createClosingMessageHandler } from "../../../lib/server/closing-message-service";

export const runtime = "nodejs";
export const maxDuration = 40;
export const POST = protectAI("closing", async (req, permit) => createClosingMessageHandler({
  apiKey: () => process.env.OPENAI_API_KEY,
  reserve: () => () => {}, // Durable authenticated permit replaces the cookie/process limiter here.
  sourceValidated: true,
  complete: async ({ apiKey, input, previousText, signal }) => {
    const openai = new OpenAI({ apiKey, maxRetries: 0, timeout: 30000, logLevel: "off" });
    const parameters: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
      model: CLOSING_MESSAGE_MODEL, reasoning_effort: CLOSING_MESSAGE_REASONING_EFFORT,
      max_completion_tokens: CLOSING_MESSAGE_MAX_COMPLETION_TOKENS, store: false, service_tier: "default",
      messages: [{ role: "system", content: CLOSING_MESSAGE_SYSTEM_PROMPT }, { role: "user", content: JSON.stringify({ input, ...(previousText ? { previousText } : {}) }) }],
      response_format: CLOSING_RESPONSE_FORMAT,
    };
    const response = await permit.run(parameters, () => openai.chat.completions.create(parameters, { signal }));
    const choice = response.choices[0];
    return choice?.finish_reason === "stop" && !choice.message.refusal ? choice.message.content : null;
  },
})(req));
