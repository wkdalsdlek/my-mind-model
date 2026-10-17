import { featureModel, type Feature } from "./policy";

const features: readonly Feature[] = ["closing", "interpretation", "analyze"];
const mismatchTypes = ["MODEL_NAME_MISMATCH", "MAX_OUTPUT_TOKENS_MISMATCH", "INPUT_BYTES_EXCEEDED"] as const;
export type ModelBudgetMismatch = typeof mismatchTypes[number];
const safeCount = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

/** Failure-only Preview metadata. No request objects, model strings or errors. */
export function logModelBudgetMismatch(feature: Feature, mismatches: readonly ModelBudgetMismatch[],
  inputBytesWithOverhead: number, maxInputTokens: number, requestedMaxCompletionTokens: unknown): void {
  if (process.env.VERCEL_ENV !== "preview") return;
  try {
    if (!features.includes(feature)) return;
    const reasons = mismatchTypes.filter(reason => mismatches.includes(reason));
    if (!reasons.length) return;
    const expected = featureModel(feature);
    console.error("[private-beta-model-budget]", {
      stage: "model.permit.validate", code: "MODEL_BUDGET_MISMATCH", feature,
      mismatchTypes: reasons, expectedModel: expected.model,
      inputBytesWithOverhead: safeCount(inputBytesWithOverhead), inputOverheadBytes: 4096,
      maxInputTokens: safeCount(maxInputTokens),
      expectedMaxCompletionTokens: expected.output,
      requestedMaxCompletionTokens: safeCount(requestedMaxCompletionTokens),
    });
  } catch {
    // Logging must never replace the original denial or allow a provider call.
  }
}
