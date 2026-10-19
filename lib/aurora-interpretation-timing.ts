/** Pure timing contract shared by browser and server. No server imports/keys. */
export const INTERPRETATION_TIMING = {
  attemptMs: 160000, workMs: 190000, totalMs: 210000,
  // Leave time for attempt accounting/validation inside work, then request
  // settlement and the final session check before the HTTP deadline.
  finalizationMs: 20000, settlementMs: 20000, minAttemptMs: 20000,
} as const;
export const INTERPRETATION_BROWSER_TIMEOUT_MS = 225000;
