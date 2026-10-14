import { seededAuroraRandom } from "./aurora-geometry";

export interface AuroraEnergyProfile {
  seed: number; cycle: number; travel: number; offset: number; speed: number;
  length: number; focus: number; direction: number; gain: number;
  jitter: number; wakeLength: number; wakeGain: number;
}
export interface AuroraEnergyEvent {
  cycleIndex: number; start: number; travel: number; speed: number; length: number;
  focus: number; direction: number; gain: number; wakeLength: number; wakeGain: number; wakeEnd: number;
}
export const AURORA_ENERGY_STREAMS = 3;
/** Each lane has its own stable seed; no device/preset/frame-dependent randomness. */
export function auroraEnergyProfile(seed: number): AuroraEnergyProfile {
  const random = seededAuroraRandom(seed);
  const cycle = 16 + random() * 6, travel = 8.5 + random() * 1.5;
  return { seed, cycle, travel, offset: random() * cycle, speed: 0.065 + random() * 0.055,
    length: 0.14 + random() * 0.12, focus: random(), direction: random() < 0.5 ? -1 : 1, gain: 0.62 + random() * 0.28,
    jitter: 0.7 + random() * 1.05, wakeLength: 0.45 + random() * 0.25, wakeGain: 0.22 + random() * 0.13 };
}
export function auroraEnergyProfiles(seed: number): AuroraEnergyProfile[] {
  return Array.from({ length: AURORA_ENERGY_STREAMS }, (_, lane) => auroraEnergyProfile(seed + lane * 104729));
}
const wrap = (v: number, cycle: number) => ((v % cycle) + cycle) % cycle;
const smooth = (a: number, b: number, v: number) => {
  const x = Math.max(0, Math.min(1, (v - a) / (b - a))); return x * x * (3 - 2 * x);
};
/** Exact integer hashing avoids platform-dependent sin() random seeds. */
function eventRandom(seed: number, index: number, salt: number): number {
  let value = (seed ^ Math.imul(index, 1664525) ^ Math.imul(salt, 1013904223)) >>> 0;
  value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
  return (value & 0xffffff) / 16777216;
}
export function createAuroraEnergyEvent(): AuroraEnergyEvent {
  return { cycleIndex: NaN, start: 0, travel: 1, speed: 0, length: 1, focus: 0,
    direction: 1, gain: 0, wakeLength: 1, wakeGain: 0, wakeEnd: 1 };
}
/** Refill owned storage only at an event boundary; no per-frame allocation/hash work. */
export function updateAuroraEnergyEvent(profile: AuroraEnergyProfile, time: number, event: AuroraEnergyEvent): boolean {
  const index = Math.floor((time + profile.offset) / profile.cycle);
  if (event.cycleIndex === index) return false;
  event.cycleIndex = index;
  event.start = index * profile.cycle - profile.offset + eventRandom(profile.seed, index, 1) * profile.jitter;
  event.travel = profile.travel * (0.93 + eventRandom(profile.seed, index, 2) * 0.14);
  event.speed = profile.speed * (0.96 + eventRandom(profile.seed, index, 3) * 0.08);
  event.length = profile.length * (0.82 + eventRandom(profile.seed, index, 4) * 0.36);
  event.focus = wrap(profile.focus + (eventRandom(profile.seed, index, 5) - 0.5) * 0.65, 1);
  event.direction = profile.direction * (eventRandom(profile.seed, index, 6) < 0.35 ? -1 : 1);
  event.gain = profile.gain * (0.78 + eventRandom(profile.seed, index, 7) * 0.32);
  event.wakeEnd = 1.15 + eventRandom(profile.seed, index, 8) * 0.15;
  event.wakeLength = profile.wakeLength * (0.9 + eventRandom(profile.seed, index, 9) * 0.2);
  event.wakeGain = profile.wakeGain * (0.9 + eventRandom(profile.seed, index, 10) * 0.2);
  return true;
}
/** Gentle field unity, without making every ribbon dim on the same beat. */
export function auroraEnergyBreath(time: number): number { return 0.94 + 0.06 * Math.sin(time * Math.PI * 2 / 43); }
export function sampleAuroraEnergy(profile: AuroraEnergyProfile, time: number, u: number) {
  const event = createAuroraEnergyEvent(); updateAuroraEnergyEvent(profile, time, event);
  return sampleAuroraEnergyEvent(event, time, u);
}
export function sampleAuroraEnergyEvent(event: AuroraEnergyEvent, time: number, u: number) {
  const age = (time - event.start) / event.travel;
  const activity = smooth(0, 0.18, age) * (1 - smooth(0.65, 1, age));
  const wakeActivity = smooth(0, 0.18, age) * (1 - smooth(0.75, event.wakeEnd, age));
  const breath = auroraEnergyBreath(time);
  if (wakeActivity < 0.0001) return { stream: 0, wake: 0, breath };
  const head = event.focus + event.direction * Math.min(age, 1) * event.travel * event.speed;
  const distance = wrap((u - head) * event.direction + 0.5, 1) - 0.5;
  const width = event.length * (0.7 + (0.4 - 0.7) * smooth(-0.02, 0.02, distance));
  const band = Math.exp(-((distance / width) ** 2));
  const wakeDistance = wrap((u - head) * event.direction + event.length * 0.7 + 0.5, 1) - 0.5;
  const wake = Math.exp(-((wakeDistance / (event.length * event.wakeLength)) ** 2));
  const emphasis = 0.72 + 0.28 * (0.5 + 0.5 * Math.cos((u - event.focus) * Math.PI * 2));
  return { stream: band * activity * breath * event.gain * emphasis,
    wake: wake * wakeActivity * (0.35 + breath * 0.65) * event.gain * event.wakeGain, breath };
}
/** Soft union preserves localized overlapping streams without additive white burnout. */
export function sampleAuroraEnergyField(profiles: readonly AuroraEnergyProfile[], time: number, u: number) {
  let quiet = 1, noWake = 1;
  for (const profile of profiles) { const e = sampleAuroraEnergy(profile, time, u); quiet *= 1 - e.stream; noWake *= 1 - e.wake; }
  return { stream: 1 - quiet, wake: 1 - noWake, breath: auroraEnergyBreath(time) };
}
export const auroraEnergyShader = `
uniform float uEnergyTime;
uniform vec4 uEnergyTiming[3], uEnergyShape[3];
uniform vec2 uEnergyWake[3];
vec2 ribbonEnergyEvent(float u, vec4 timing, vec4 shape, vec2 tail, float breath) {
  float age = (uEnergyTime - timing.x) / timing.y;
  float activity = smoothstep(0.0, 0.18, age) * (1.0 - smoothstep(0.65, 1.0, age));
  float wakeActivity = smoothstep(0.0, 0.18, age) * (1.0 - smoothstep(0.75, timing.w, age));
  if (wakeActivity < 0.0001) return vec2(0.0);
  float head = shape.y + shape.z * min(age, 1.0) * timing.y * timing.z;
  float distance = fract((u - head) * shape.z + 0.5) - 0.5;
  float width = shape.x * mix(0.7, 0.4, smoothstep(-0.02, 0.02, distance));
  float band = exp(-pow(distance / width, 2.0));
  float wakeDistance = fract((u - head) * shape.z + shape.x * 0.7 + 0.5) - 0.5;
  float wake = exp(-pow(wakeDistance / (shape.x * tail.x), 2.0));
  float emphasis = 0.72 + 0.28 * (0.5 + 0.5 * cos((u - shape.y) * 6.283185307));
  return vec2(band * activity * breath * shape.w * emphasis,
    wake * wakeActivity * (0.35 + breath * 0.65) * shape.w * tail.y);
}
vec3 ribbonEnergy(float u) {
  float breath = 0.94 + 0.06 * sin(uEnergyTime * 6.283185307 / 43.0);
  vec2 quiet = vec2(1.0);
  for (int i = 0; i < 3; i++) quiet *= vec2(1.0) - ribbonEnergyEvent(u, uEnergyTiming[i], uEnergyShape[i], uEnergyWake[i], breath);
  return vec3(vec2(1.0) - quiet, breath);
}`;
