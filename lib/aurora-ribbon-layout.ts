import { auroraCurtainMistShape, auroraLoopMistShape, auroraLoopShapes, auroraRibbonShapes, type AuroraRibbonShape } from "./aurora-geometry";
import { AURORA_DEFAULT_FLOW_MODE, auroraFlowBudget, auroraPaletteColors, auroraQualityBudget, validateAuroraAppearance,
  type AuroraAppearance, type AuroraFlowMode, type AuroraQuality } from "./aurora-types";

export type AuroraRibbonId = `aurora-ribbon-v1:${AuroraRibbonShape["kind"]}:${number}`;
/** Result-local slot identity; semantic changes do not rename a physical slot. */
export const auroraRibbonId = (kind: AuroraRibbonShape["kind"], slot: number): AuroraRibbonId => `aurora-ribbon-v1:${kind}:${slot}`;

/** The renderer and meaning contract share these exact target color parameters.
 * baseMix is a shader input, NOT a measured color area or semantic percentage. */
export function auroraRibbonVisualParameters(palette: AuroraAppearance["palette"], shape: AuroraRibbonShape, mist = false) {
  const colors = auroraPaletteColors(palette), a = shape.colorIndex, b = (a + 1) % colors.length;
  const coreShare = shape.kind === "loop" ? 0.58 : 0.95;
  const mistShare = shape.kind === "loop" ? 0.58 * 0.34 : 0.24;
  const endpoint = (index: number) => ({ paletteIndex: index, familyId: palette[index].familyId,
    color: colors[index], paletteWeight: palette[index].weight });
  return { colorA: endpoint(a), colorB: endpoint(b), baseMix: palette[b].weight,
    targetOpacity: (0.24 + palette[a].weight * 0.24) * (mist ? mistShare : coreShare),
    blendModel: "spatial-noise-iridescence" as const, parameterState: "target-after-easing" as const };
}
export interface AuroraRibbonLayer {
  renderKey: string;
  mist: boolean;
  segments: number;
  rows: number;
  shape: AuroraRibbonShape;
  visual: ReturnType<typeof auroraRibbonVisualParameters>;
}
export interface AuroraRibbonSlot {
  ribbonId: AuroraRibbonId;
  slot: number;
  kind: AuroraRibbonShape["kind"];
  active: boolean;
  layers: readonly AuroraRibbonLayer[];
}
/** Mirrors mounted profiles, including inactive loop slots; mist belongs to its parent.
 * Render keys and draw order match AuroraRibbons. No GPU/React or device detection. */
export function createAuroraRibbonLayout(appearance: AuroraAppearance, quality: AuroraQuality = "balanced", flowMode: AuroraFlowMode = AURORA_DEFAULT_FLOW_MODE) {
  if (validateAuroraAppearance(appearance).length) throw new Error("INVALID_AURORA_RIBBON_APPEARANCE");
  if (!["low", "balanced", "high"].includes(quality)) throw new Error("INVALID_AURORA_RIBBON_QUALITY");
  const budget = auroraQualityBudget(quality), flow = auroraFlowBudget(flowMode, budget);
  const layer = (renderKey: string, shape: AuroraRibbonShape, mist: boolean, segments: number, rows: number): AuroraRibbonLayer =>
    ({ renderKey, shape, mist, segments, rows, visual: auroraRibbonVisualParameters(appearance.palette, shape, mist) });
  const curtains = auroraRibbonShapes(appearance).map((shape, slot): AuroraRibbonSlot => ({
    ribbonId: auroraRibbonId("curtain", slot), slot, kind: "curtain", active: true,
    layers: [layer(`curtain-${slot}`, shape, false, budget.segments, budget.rows),
      layer(`curtain-mist-${slot}`, auroraCurtainMistShape(shape), true, flow.curtainMistSegments, flow.curtainMistRows)],
  }));
  const loops = auroraLoopShapes(appearance).map((shape, slot): AuroraRibbonSlot => ({
    ribbonId: auroraRibbonId("loop", slot), slot, kind: "loop", active: slot < flow.loopCount,
    layers: [layer(`loop-${slot}`, shape, false, flow.segments, flow.rows),
      ...Array.from({ length: flow.mistLayers }, (_, i) => layer(`mist-${slot}-${i}`, auroraLoopMistShape(shape, i), true, flow.mistSegments, flow.mistRows))],
  }));
  const ribbons = [...curtains, ...loops];
  return { quality, flowMode, ribbons, activeRibbonCount: curtains.length + flow.loopCount,
    renderSequence: [...curtains.map(r => r.layers[0].renderKey), ...curtains.map(r => r.layers[1].renderKey),
      ...loops.map(r => r.layers[0].renderKey), ...loops.flatMap(r => r.layers.slice(1).map(l => l.renderKey))],
    mountedMeshCount: ribbons.reduce((sum, r) => sum + r.layers.length, 0),
    activeMeshCount: ribbons.filter(r => r.active).reduce((sum, r) => sum + r.layers.length, 0) };
}
