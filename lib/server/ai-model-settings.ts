/** Shared server-owned request contracts. Routes and cost reservations must use
 * the same model/output/attempt settings; no environment or user overrides. */
export const CLOSING_MODEL_SETTINGS = {
  model: "gpt-6.1-sol", reasoningEffort: "low", output: 4096, attempts: 1,
} as const;
export const ANALYSIS_MODEL_SETTINGS = {
  model: "gpt-6.1-sol", reasoningEffort: "high", output: 25000, attempts: 2,
} as const;
export const AI_PRICED_MODELS = [...new Set([CLOSING_MODEL_SETTINGS.model, ANALYSIS_MODEL_SETTINGS.model])];
