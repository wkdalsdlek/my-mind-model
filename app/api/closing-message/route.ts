import OpenAI from "openai";
import { CLOSING_MESSAGE_MODEL, CLOSING_MESSAGE_SYSTEM_PROMPT, CLOSING_RESPONSE_FORMAT, createClosingMessageHandler, createClosingRequestLimiter } from "../../../lib/server/closing-message-service";

export const runtime = "nodejs";
export const maxDuration = 40;
export const POST = createClosingMessageHandler({
  apiKey: () => process.env.OPENAI_API_KEY,
  reserve: createClosingRequestLimiter(),
  complete: async ({ apiKey, input, previousText, signal }) => {
    const openai = new OpenAI({ apiKey, maxRetries: 0, timeout: 30000, logLevel: "off" });
    const response = await openai.chat.completions.create({
      model: CLOSING_MESSAGE_MODEL, temperature: 0.9, max_completion_tokens: 180, store: false,
      messages: [{ role: "system", content: CLOSING_MESSAGE_SYSTEM_PROMPT }, { role: "user", content: JSON.stringify({ input, ...(previousText ? { previousText } : {}) }) }],
      response_format: CLOSING_RESPONSE_FORMAT,
    }, { signal });
    const choice = response.choices[0];
    return choice?.finish_reason === "stop" && !choice.message.refusal ? choice.message.content : null;
  },
});
