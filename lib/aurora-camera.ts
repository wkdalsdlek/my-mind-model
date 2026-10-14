import type { AuroraCameraMode, AuroraRibbonCount } from "./aurora-types";

export const AURORA_CAMERA_TARGET: readonly [number, number, number] = [0, 0.15, -2.4];
// Conservative primary-ribbon/loop/mist envelope, excluding background clouds/stars.
export const AURORA_CAMERA_ENVELOPE: readonly [number, number, number] = [9.9, 6.7, 9];
export const AURORA_CAMERA_MIN_DISTANCE = 15.5;
export function auroraCameraEnvelope(count: AuroraRibbonCount = 4): readonly [number, number, number] {
  return count < 4 ? [9.9, 5.4, 9] : AURORA_CAMERA_ENVELOPE;
}
export const AURORA_CAMERA_POLAR_LIMITS = [Math.PI / 6, Math.PI * 5 / 6] as const;
export const AURORA_CAMERA_DEFAULTS = { autoOrbitSeconds: 120, returnSeconds: 1.2 } as const;
export interface AuroraCameraOptions { autoOrbitSeconds?: number; returnSeconds?: number }
export interface AuroraCameraOrbit { theta: number; phi: number; radius: number }
export interface AuroraCameraFraming { fov: number; frontDistance: number; autoDistance: number; minDistance: number; maxDistance: number }
export interface AuroraCameraState {
  mode: AuroraCameraMode; orbit: AuroraCameraOrbit; from: AuroraCameraOrbit;
  returning: boolean; elapsed: number; thetaTravel: number; velocity: number;
}
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
export function auroraCameraOptions(value: AuroraCameraOptions = {}) {
  return {
    autoOrbitSeconds: Number.isFinite(value.autoOrbitSeconds) ? clamp(value.autoOrbitSeconds!, 90, 150) : AURORA_CAMERA_DEFAULTS.autoOrbitSeconds,
    returnSeconds: Number.isFinite(value.returnSeconds) ? clamp(value.returnSeconds!, 0.8, 1.5) : AURORA_CAMERA_DEFAULTS.returnSeconds,
  };
}
/** Exact corner projection against a lightweight static envelope, not per-frame geometry bounds. */
export function auroraCameraFitDistance(theta: number, phi: number, aspect: number, fov: number, envelope = AURORA_CAMERA_ENVELOPE): number {
  const dx = Math.sin(phi) * Math.sin(theta), dy = Math.cos(phi), dz = Math.sin(phi) * Math.cos(theta);
  const rx = Math.cos(theta), rz = -Math.sin(theta);
  const ux = -Math.cos(phi) * Math.sin(theta), uy = Math.sin(phi), uz = -Math.cos(phi) * Math.cos(theta);
  const v = Math.tan(fov * Math.PI / 360), h = v * aspect;
  let distance = 0;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * envelope[0], y = sy * envelope[1], z = sz * envelope[2];
    const depth = x * dx + y * dy + z * dz;
    distance = Math.max(distance, depth + Math.abs(x * rx + z * rz) / h, depth + Math.abs(x * ux + y * uy + z * uz) / v);
  }
  return distance * 1.04;
}
export function auroraCameraFraming(width: number, height: number, count: AuroraRibbonCount = 4): AuroraCameraFraming {
  const aspect = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? clamp(width / height, 0.2, 4) : 16 / 9;
  const fov = 43 + 10 * clamp((1 - aspect) / 0.6, 0, 1);
  const envelope = auroraCameraEnvelope(count);
  const frontDistance = Math.max(20, auroraCameraFitDistance(0, Math.PI / 2, aspect, fov, envelope));
  let autoDistance = frontDistance;
  for (let i = 0; i < 48; i++) autoDistance = Math.max(autoDistance, auroraCameraFitDistance(i * Math.PI / 24, Math.PI / 2, aspect, fov, envelope));
  return { fov, frontDistance, autoDistance: autoDistance * 1.02, minDistance: AURORA_CAMERA_MIN_DISTANCE, maxDistance: autoDistance * 1.7 };
}
export function resolveAuroraCameraMode(mode: AuroraCameraMode, reduced: boolean): AuroraCameraMode {
  return !["front", "free", "auto"].includes(mode) || (mode === "auto" && reduced) ? "front" : mode;
}
export function readAuroraCameraOrbit(position: readonly number[], target: AuroraCameraOrbit): void {
  const x = position[0] - AURORA_CAMERA_TARGET[0], y = position[1] - AURORA_CAMERA_TARGET[1], z = position[2] - AURORA_CAMERA_TARGET[2];
  target.radius = Math.max(AURORA_CAMERA_MIN_DISTANCE, Math.hypot(x, y, z));
  target.theta = Math.atan2(x, z);
  target.phi = clamp(Math.acos(clamp(y / target.radius, -1, 1)), ...AURORA_CAMERA_POLAR_LIMITS);
}
export function writeAuroraCameraPosition(orbit: AuroraCameraOrbit, target: [number, number, number]): void {
  const equator = orbit.radius * Math.sin(orbit.phi);
  target[0] = AURORA_CAMERA_TARGET[0] + equator * Math.sin(orbit.theta);
  target[1] = AURORA_CAMERA_TARGET[1] + orbit.radius * Math.cos(orbit.phi);
  target[2] = AURORA_CAMERA_TARGET[2] + equator * Math.cos(orbit.theta);
}
export function createAuroraCameraState(): AuroraCameraState {
  const orbit = { theta: 0, phi: Math.PI / 2, radius: 20 };
  return { mode: "front", orbit: { ...orbit }, from: { ...orbit }, returning: false, elapsed: 0, thetaTravel: 0, velocity: 0 };
}
export function requestAuroraCameraMode(state: AuroraCameraState, mode: AuroraCameraMode, reduced: boolean): void {
  state.mode = resolveAuroraCameraMode(mode, reduced); state.velocity = 0;
  state.returning = state.mode === "front"; state.elapsed = 0;
  Object.assign(state.from, state.orbit);
  state.thetaTravel = Math.atan2(Math.sin(-state.orbit.theta), Math.cos(-state.orbit.theta));
}
export function interruptAuroraAutoOrbit(state: AuroraCameraState): boolean {
  if (state.mode !== "auto") return false;
  state.mode = "free"; state.velocity = 0; state.returning = false; return true;
}
/** Owned state only. Automatic velocity uses an analytic ramp, independent of FPS. */
export function advanceAuroraCamera(state: AuroraCameraState, delta: number, framing: AuroraCameraFraming,
  options: ReturnType<typeof auroraCameraOptions>, reduced: boolean, visible: boolean): boolean {
  if (!visible || !Number.isFinite(delta) || delta <= 0) { if (!visible) state.velocity = 0; return false; }
  const dt = Math.min(delta, 0.25);
  if (state.returning) {
    state.elapsed += dt;
    const fraction = Math.min(1, state.elapsed / options.returnSeconds), ease = 1 - Math.pow(1 - fraction, 3);
    state.orbit.theta = state.from.theta + state.thetaTravel * ease;
    state.orbit.phi = state.from.phi + (Math.acos(0.25 / framing.frontDistance) - state.from.phi) * ease;
    state.orbit.radius = state.from.radius + (framing.frontDistance - state.from.radius) * ease;
    if (fraction === 1) { state.returning = false; state.orbit.theta = 0; }
    return true;
  }
  if (state.mode !== "auto" || reduced) return false;
  const speed = Math.PI * 2 / options.autoOrbitSeconds, decay = Math.exp(-dt * 3);
  state.orbit.theta += speed * dt + (state.velocity - speed) * (1 - decay) / 3;
  state.velocity = speed + (state.velocity - speed) * decay;
  state.orbit.phi += (Math.PI / 2 - state.orbit.phi) * (1 - Math.exp(-dt * 1.8));
  state.orbit.radius += (framing.autoDistance - state.orbit.radius) * (1 - Math.exp(-dt * 1.8));
  return true;
}
