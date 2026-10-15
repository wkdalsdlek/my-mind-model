import type { AuroraRibbonId } from "./aurora-ribbon-layout";

export type AuroraRibbonFocusPhase = "overview" | "focusing" | "focused" | "returning";
export const AURORA_RIBBON_FOCUS_SECONDS = 1.35;
export const auroraFocusDuration = (reduced: boolean) => reduced ? 0.08 : AURORA_RIBBON_FOCUS_SECONDS;
export function auroraFocusEase(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * x * (10 + x * (-15 + 6 * x));
}
export const auroraRibbonFocusOpacity = (selected: AuroraRibbonId | null, own: AuroraRibbonId) => selected && selected !== own ? 0.38 : 1;
export function auroraRibbonPickCode(id: string): number {
  const match = /^aurora-ribbon-v1:(curtain|loop):([0-3])$/.exec(id);
  if (!match || match[1] === "loop" && Number(match[2]) > 1) return 0;
  return Number(match[2]) + (match[1] === "curtain" ? 1 : 5);
}
export function decodeAuroraRibbonPick(pixel: ArrayLike<number>): AuroraRibbonId | null {
  if (pixel[1] !== 85 || pixel[2] !== 170 || pixel[3] !== 255 || pixel[0] < 1 || pixel[0] > 6) return null;
  return `aurora-ribbon-v1:${pixel[0] <= 4 ? "curtain" : "loop"}:${pixel[0] <= 4 ? pixel[0] - 1 : pixel[0] - 5}`;
}
/** Keep the exact visual fold/alpha discard. Only the final color changes for picking. */
export function auroraRibbonPickingShader(fragment: string): string {
  const marker = "gl_FragColor = vec4(color, alpha);";
  if (!fragment.includes(marker)) throw new Error("RIBBON_PICK_SHADER_CONTRACT_CHANGED");
  return `uniform vec3 uPickId;\n${fragment.replace(marker, "if (alpha < 0.003) discard; gl_FragColor = vec4(uPickId, 1.0);")
    .replace("#include <tonemapping_fragment>", "").replace("#include <colorspace_fragment>", "")}`;
}
/** Exact projected corner fit, plus a conservative outside-sphere clearance.
 * No allocations; bounds already include model/world transforms and GPU-fold padding. */
export function auroraRibbonFocusDistance(min: readonly number[], max: readonly number[], target: readonly number[], direction: readonly number[], aspect: number, fov: number): number {
  const dx = direction[0], dy = direction[1], dz = direction[2];
  const horizontal = Math.hypot(dx, dz) || 1, rx = dz / horizontal, rz = -dx / horizontal;
  const ux = dy * rz, uy = dz * rx - dx * rz, uz = -dy * rx;
  const v = Math.tan(fov * Math.PI / 360), h = v * Math.max(0.2, aspect);
  let distance = 1, radius = 0;
  for (let corner = 0; corner < 8; corner++) {
    const x = (corner & 1 ? max[0] : min[0]) - target[0];
    const y = (corner & 2 ? max[1] : min[1]) - target[1];
    const z = (corner & 4 ? max[2] : min[2]) - target[2];
    distance = Math.max(distance, x * dx + y * dy + z * dz + Math.max(Math.abs(x * rx + z * rz) / h, Math.abs(x * ux + y * uy + z * uz) / v));
    radius = Math.max(radius, Math.hypot(x, y, z));
  }
  return Math.max(distance * 1.08, radius + 1.2);
}
/** One physical tap, never a drag, wheel gesture, long press, or multi-touch orbit. */
export class AuroraRibbonTapGesture {
  private pointers = new Set<number>();
  private candidate: { id: number; x: number; y: number; time: number; valid: boolean } | null = null;
  down(id: number, x: number, y: number, time: number, primary: boolean, button: number): void {
    this.pointers.add(id);
    if (this.pointers.size > 1) { this.cancel(); return; }
    this.candidate = { id, x, y, time, valid: primary && button === 0 };
  }
  move(id: number, x: number, y: number): void {
    if (this.candidate?.id === id && Math.hypot(x - this.candidate.x, y - this.candidate.y) > 7) this.candidate.valid = false;
  }
  up(id: number, x: number, y: number, time: number): boolean {
    this.move(id, x, y);
    const c = this.candidate;
    const tap = !!c && c.id === id && c.valid && this.pointers.size === 1 && time - c.time >= 0 && time - c.time < 650;
    this.pointers.delete(id); this.candidate = null;
    return tap;
  }
  cancel(id?: number): void { if (id !== undefined) this.pointers.delete(id); this.candidate = null; }
  reset(): void { this.pointers.clear(); this.candidate = null; }
}
