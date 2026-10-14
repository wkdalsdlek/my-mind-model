import { SEMANTIC_FAMILIES, type SemanticFamilyId } from "./semantic-families";

export type AuroraQuality = "low" | "balanced" | "high";
export type AuroraPresetId = "serenity" | "connection" | "exploration" | "mixed";
export type AuroraRibbonCount = 2 | 3 | 4;
export type AuroraFlowMode = "independent" | "hybrid" | "loop-emphasis";
export type AuroraCameraMode = "front" | "free" | "auto";
export const AURORA_DEFAULT_FLOW_MODE: AuroraFlowMode = "hybrid";
// Artistic movement weights, not measured percentages of perceived movement.
export const AURORA_MOTION_WEIGHTS = { field: 0.43, individual: 0.38, surface: 0.19 } as const;
export const AURORA_ORBITAL_ANCHOR: readonly [number, number, number] = [0, 0.15, -0.6];
export interface AuroraColorShare { familyId: SemanticFamilyId; weight: number; color?: string }
export interface AuroraMotion { speed: number; amplitude: number; flow: number; intensity?: number }
export interface AuroraAppearance {
  palette: readonly AuroraColorShare[];
  motion: AuroraMotion;
  ribbonCount: AuroraRibbonCount;
}
export interface AuroraPreset extends AuroraAppearance {
  id: AuroraPresetId;
  name: string;
  description: string;
}
export interface AuroraLayers { nebula: boolean; ribbons: boolean; glass: boolean; stardust: boolean; bloom: boolean }
export interface AuroraPerformanceSample { fps: number; frameMs: number }
export interface AuroraQualityBudget {
  segments: number;
  rows: number;
  stars: number;
  dust: number;
  fragments: number;
  nebulaLayers: number;
  dpr: number;
  bloomHeight: number;
}
export const AURORA_DEFAULT_LAYERS: Readonly<AuroraLayers> = { nebula: true, ribbons: true, glass: true, stardust: true, bloom: true };
export const AURORA_QUALITY_BUDGETS: Readonly<Record<AuroraQuality, AuroraQualityBudget>> = {
  low: { segments: 64, rows: 10, stars: 600, dust: 100, fragments: 8, nebulaLayers: 3, dpr: 1, bloomHeight: 192 },
  balanced: { segments: 112, rows: 16, stars: 1300, dust: 220, fragments: 12, nebulaLayers: 4, dpr: 1.5, bloomHeight: 384 },
  high: { segments: 160, rows: 20, stars: 2200, dust: 400, fragments: 18, nebulaLayers: 5, dpr: 2, bloomHeight: 640 },
};
export function auroraQualityBudget(quality: AuroraQuality, compact = false): AuroraQualityBudget {
  // Retain the viewport hint for compatibility; layout never implies GPU capacity.
  void compact;
  return { ...AURORA_QUALITY_BUDGETS[quality] };
}
export function auroraFlowBudget(mode: AuroraFlowMode, budget: AuroraQualityBudget) {
  if (!["independent", "hybrid", "loop-emphasis"].includes(mode)) throw new Error("Invalid aurora flow mode");
  return { loopCount: mode === "independent" ? 0 : mode === "hybrid" ? 1 : 2,
    segments: Math.min(128, Math.max(48, Math.floor(budget.segments * 0.75))), rows: Math.min(14, budget.rows),
    mistLayers: budget.dpr <= 1.25 ? 1 : 2,
    mistSegments: Math.min(80, Math.max(40, Math.floor(budget.segments * 0.5))), mistRows: budget.rows <= 10 ? 6 : 8,
    curtainMistSegments: Math.min(72, Math.max(32, Math.floor(budget.segments * 0.45))),
    curtainMistRows: budget.rows <= 10 ? 6 : budget.rows <= 16 ? 8 : 10 };
}
export function validateAuroraAppearance(value: AuroraAppearance): string[] {
  const errors: string[] = [];
  if (!value || ![2, 3, 4].includes(value.ribbonCount)) errors.push("리본은 2~4개여야 합니다.");
  const palette = value?.palette;
  if (!Array.isArray(palette) || palette.length < 2 || palette.length > 7) errors.push("색상 계열은 2~7개여야 합니다.");
  else {
    const ids = new Set<string>();
    for (const item of palette) {
      if (!item || !SEMANTIC_FAMILIES.some(f => f.id === item.familyId) || ids.has(item.familyId)) errors.push("색상 계열은 유효하고 중복되지 않아야 합니다.");
      if (!item || !Number.isFinite(item.weight) || item.weight <= 0 || item.weight > 1 || (item.color !== undefined && !/^#[\da-f]{6}$/i.test(item.color))) errors.push("색상과 비율이 유효하지 않습니다.");
      if (item) ids.add(item.familyId);
    }
    if (Math.abs(palette.reduce((sum, item) => sum + (item?.weight ?? 0), 0) - 1) > 1e-6) errors.push("색상 비율의 합은 1이어야 합니다.");
  }
  const motion = value?.motion;
  if (!motion || !Number.isFinite(motion.speed) || motion.speed < 0 || motion.speed > 2
    || !Number.isFinite(motion.amplitude) || motion.amplitude < 0 || motion.amplitude > 1.5
    || !Number.isFinite(motion.flow) || motion.flow < 0 || motion.flow > 2
    || (motion.intensity !== undefined && (!Number.isFinite(motion.intensity) || motion.intensity < 0.5 || motion.intensity > 1.5))) errors.push("움직임 파라미터가 유효하지 않습니다.");
  return errors;
}
export function auroraPaletteColors(palette: readonly AuroraColorShare[]): string[] {
  return palette.map(item => item.color ?? SEMANTIC_FAMILIES.find(f => f.id === item.familyId)!.color);
}
export function auroraFrameLoop(visible: boolean, reducedMotion: boolean): "always" | "demand" | "never" {
  return !visible ? "never" : reducedMotion ? "demand" : "always";
}
/** Clamp only unusually long gaps, so returning to a tab does not jump the ribbons. */
export function advanceAuroraTime(time: number, delta: number, moving: boolean): number {
  return moving && Number.isFinite(delta) && delta > 0 ? time + Math.min(delta, 0.1) : time;
}
export interface AuroraMotionClock { phase: number; energyTime: number; previousTime: number; delta: number; speed: number; motion: AuroraMotion }
const energyRate = (flow: number) => 1.6 * flow / (0.5 + flow);
export function createAuroraMotionClock(motion: AuroraMotion): AuroraMotionClock {
  return { phase: 0, energyTime: 0, previousTime: -1, delta: 0, speed: motion.speed, motion: { ...motion, speed: 1, intensity: motion.intensity ?? 1 } };
}
/** Integrate velocity so preset changes preserve phase; frozen time stops all motion. */
export function advanceAuroraMotionClock(clock: AuroraMotionClock, time: number, target: AuroraMotion, reduced: boolean): void {
  if (!Number.isFinite(time)) { clock.delta = 0; return; }
  if (clock.previousTime < 0) {
    clock.phase = time * target.speed;
    clock.energyTime = time * energyRate(target.flow);
    clock.previousTime = time;
  }
  clock.delta = reduced ? 0 : Math.max(0, Math.min(0.1, time - clock.previousTime));
  clock.previousTime = time;
  const response = reduced ? 1 : 1 - Math.exp(-clock.delta * 3);
  clock.speed += (target.speed - clock.speed) * response;
  clock.phase += clock.delta * clock.speed;
  clock.motion.amplitude += (target.amplitude - clock.motion.amplitude) * response;
  clock.motion.flow += (target.flow - clock.motion.flow) * response;
  clock.energyTime += clock.delta * energyRate(clock.motion.flow);
  clock.motion.intensity = (clock.motion.intensity ?? 1) + ((target.intensity ?? 1) - (clock.motion.intensity ?? 1)) * response;
}
