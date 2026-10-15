import { auroraEnergyProfiles } from "./aurora-energy";
import type { AuroraRibbonShape } from "./aurora-geometry";
import type { auroraRibbonVisualParameters } from "./aurora-ribbon-layout";

type Visual = ReturnType<typeof auroraRibbonVisualParameters>;
/** Explanation data, not additional psychological inference. All motion/shape
 * values are references to the existing slot; only bounded surface styling is new. */
export interface AuroraRibbonIdentityProfile {
  version: "aurora-ribbon-surface-v1";
  application: "interactive-result-only";
  colorOrigin: "unchanged-palette-endpoints";
  stylingOrigin: "deterministic-renderer-slot";
  colors: { a: Visual["colorA"]; b: Visual["colorB"]; baseMix: number; coreMix: number };
  structure: { width: number; height: number; curve: number; depth: number; phase: number; origin: "phase-4-slot-design" };
  energy: { seed: number; profiles: ReturnType<typeof auroraEnergyProfiles>; origin: "unchanged-renderer-slot-seed" };
  surface: { veinWidth: number; coreFloor: number; rim: number; colorSpread: number; mistOverview: number; mistMacro: number };
}
export function auroraRibbonIdentityProfile(shape: AuroraRibbonShape, visual: Visual): AuroraRibbonIdentityProfile {
  const variant = ((shape.energySeed >>> 3) % 3), loop = shape.kind === "loop";
  const dominantB = visual.colorB.paletteWeight > visual.colorA.paletteWeight;
  return { version: "aurora-ribbon-surface-v1", application: "interactive-result-only", colorOrigin: "unchanged-palette-endpoints",
    stylingOrigin: "deterministic-renderer-slot",
    colors: { a: { ...visual.colorA }, b: { ...visual.colorB }, baseMix: visual.baseMix, coreMix: dominantB ? .9 : .1 },
    structure: { width: shape.width, height: shape.height, curve: shape.curve, depth: shape.depth, phase: shape.phase, origin: "phase-4-slot-design" },
    energy: { seed: shape.energySeed, profiles: auroraEnergyProfiles(shape.energySeed), origin: "unchanged-renderer-slot-seed" },
    surface: { veinWidth: .019 + variant * .005, coreFloor: .82 + variant * .08, rim: .19 + variant * .035,
      colorSpread: .72 + variant * .06, mistOverview: loop ? .88 : .84, mistMacro: loop ? .58 : .5 } };
}
