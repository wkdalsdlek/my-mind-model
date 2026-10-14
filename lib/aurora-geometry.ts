import { AURORA_MOTION_WEIGHTS, AURORA_ORBITAL_ANCHOR, type AuroraAppearance, type AuroraMotion } from "./aurora-types";

export interface AuroraRibbonShape {
  kind: "curtain" | "loop";
  width: number; height: number; curve: number; depth: number; phase: number;
  speed: number; amplitude: number; frequency: number;
  position: [number, number, number]; rotation: [number, number, number];
  orbitRadii: [number, number, number]; orbitTilt: number;
  orbitRate: number; motionScale: number;
  colorIndex: number;
  veil?: number;
  closed?: boolean;
  energySeed: number;
}
export function auroraRibbonShapes(appearance: AuroraAppearance): AuroraRibbonShape[] {
  const positions: [number, number, number][] = [[0.3, 0.15, 1.9], [-0.8, 0.7, -0.4], [0.7, -0.65, -3.1], [-0.1, 1.3, -5.2]];
  return positions.slice(0, appearance.ribbonCount).map((position, i) => ({
    kind: "curtain", closed: true, energySeed: 43217 + i * 977,
    width: 11.8 + i * 0.9, height: [2.7, 3.35, 2.45, 3.1][i] * 1.28, curve: [1.7, 2.2, 1.35, 2.65][i], depth: [1.9, 2.45, 2.8, 1.6][i],
    phase: 0.65 + i * 1.71, speed: appearance.motion.speed * [1, -0.74, 0.56, -0.89][i],
    amplitude: appearance.motion.amplitude * [1, 0.72, 1.18, 0.85][i], frequency: [6.4, 4.7, 7.2, 5.3][i],
    position, rotation: [[0.12, -0.12, -0.16], [-0.24, 0.18, 0.19], [0.28, -0.19, -0.09], [-0.15, 0.14, 0.14]][i] as [number, number, number],
    orbitRadii: [[1.25, 0.62, 0.36], [0.95, 0.8, 0.42], [1.4, 0.55, 0.32], [1.1, 0.72, 0.38]][i] as [number, number, number],
    orbitTilt: [0.32, -0.48, 0.56, -0.26][i],
    orbitRate: [1, -0.74, 0.56, -0.89][i], motionScale: [1, 0.72, 1.18, 0.85][i],
    colorIndex: i % appearance.palette.length,
  }));
}
/** Two reusable loop profiles; the flow mode controls their visibility. */
export function auroraLoopShapes(appearance: AuroraAppearance): AuroraRibbonShape[] {
  return [0, 1].map(i => ({
    kind: "loop", closed: true, energySeed: 78437 + i * 977, width: [4.1, 3.4][i], height: [1.3, 1.05][i] * 1.3, curve: [1.75, 1.45][i], depth: [1.4, 1.55][i],
    phase: [1.35, 3.8][i], speed: appearance.motion.speed * [0.83, -0.67][i],
    amplitude: appearance.motion.amplitude * [0.88, 0.75][i], frequency: [3, 4][i],
    position: [[-0.25, 0.2, -1.5], [0.65, -0.45, -4.5]][i] as [number, number, number],
    rotation: [[0.38, -0.28, -0.22], [-0.4, 0.34, 0.3]][i] as [number, number, number],
    orbitRadii: [[1.1, 0.55, 0.3], [0.85, 0.65, 0.32]][i] as [number, number, number], orbitTilt: [0.45, -0.55][i],
    orbitRate: [0.83, -0.67][i], motionScale: [0.88, 0.75][i], colorIndex: i % appearance.palette.length,
  }));
}
/** Wider, depth-separated veils approximate scattering around a closed ribbon.
 * Periodic shape parameters preserve the half-twist seam, including mist layers. */
export function auroraLoopMistShape(shape: AuroraRibbonShape, layer: number): AuroraRibbonShape {
  if (shape.kind !== "loop" || ![0, 1].includes(layer)) throw new Error("Invalid loop mist layer");
  return { ...shape, height: shape.height * (1.8 + layer * 0.34), width: shape.width * (1.015 + layer * 0.015),
    depth: shape.depth + (layer === 0 ? 0.18 : -0.23) };
}
/** One curved, low-density veil supplies transverse depth without a solid shell. */
export function auroraCurtainMistShape(shape: AuroraRibbonShape): AuroraRibbonShape {
  if (shape.kind !== "curtain") throw new Error("Invalid curtain mist shape");
  return { ...shape, height: shape.height * 1.34, depth: shape.depth + 0.18, veil: 0.23 };
}
export interface AuroraRibbonPose { position: [number, number, number]; rotation: [number, number, number] }
/** A nearly stationary shared anchor breathes; the field no longer wanders freely. */
export function updateAuroraFieldPose(motion: AuroraMotion, time: number, target: AuroraRibbonPose): void {
  const phase = time * motion.speed * 0.32;
  const gain = Math.min(1, motion.amplitude * (motion.intensity ?? 1)) * 1.4 * AURORA_MOTION_WEIGHTS.field * 0.4;
  target.position[0] = AURORA_ORBITAL_ANCHOR[0] + gain * (0.35 * Math.cos(phase) + 0.08 * Math.sin(phase * 2));
  target.position[1] = AURORA_ORBITAL_ANCHOR[1] + gain * 0.25 * Math.sin(phase);
  target.position[2] = AURORA_ORBITAL_ANCHOR[2] + gain * 0.18 * Math.sin(phase + 0.6);
  target.rotation[0] = gain * 0.14 * Math.sin(phase);
  target.rotation[1] = gain * 0.17 * Math.sin(phase + 0.4);
  target.rotation[2] = gain * 0.10 * Math.cos(phase);
}
/** Individual elliptical drift rides the shared field. Caller owns pose storage. */
export function updateAuroraRibbonPose(shape: AuroraRibbonShape, motion: AuroraMotion, time: number, target: AuroraRibbonPose): void {
  const orbit = time * motion.speed * shape.orbitRate * (shape.kind === "loop" ? 0.26 : 0.42) + shape.phase;
  const gain = Math.min(1, motion.amplitude * (motion.intensity ?? 1)) * shape.motionScale * 1.4 * AURORA_MOTION_WEIGHTS.individual * 1.25 * 0.4;
  const x = Math.cos(orbit) * shape.orbitRadii[0] * 0.6;
  const y = Math.sin(orbit) * shape.orbitRadii[1] * 0.6;
  const tilt = shape.orbitTilt;
  target.position[0] = shape.position[0] * 0.45 + gain * (x * Math.cos(tilt) - y * Math.sin(tilt));
  target.position[1] = shape.position[1] * 0.45 + gain * (x * Math.sin(tilt) + y * Math.cos(tilt));
  target.position[2] = shape.position[2] + gain * Math.sin(orbit + tilt) * shape.orbitRadii[2];
  target.rotation[0] = shape.rotation[0] + gain * 0.075 * Math.sin(orbit + tilt);
  target.rotation[1] = shape.rotation[1] + gain * 0.12 * Math.cos(orbit);
  target.rotation[2] = shape.rotation[2] + gain * 0.085 * Math.sin(orbit);
  if (shape.kind === "loop") {
    // Bounded precession supports the main curtain instead of spinning a ring.
    const precession = time * motion.speed * shape.orbitRate * 0.12 + shape.phase;
    target.rotation[0] += gain * 0.20 * Math.sin(precession);
    target.rotation[1] += gain * 0.15 * Math.cos(precession + 0.8);
    target.rotation[2] += gain * 0.09 * Math.sin(precession * 0.8);
  }
}
function surface(shape: AuroraRibbonShape, u: number, v: number): [number, number, number] {
  const across = v - 0.5;
  if (shape.closed && shape.kind === "curtain") {
    const angle = u * Math.PI * 2;
    const radius = 1 + 0.07 * Math.sin(angle * 2 + shape.phase) + 0.045 * Math.cos(angle * 3 - shape.phase);
    const twist = 0.42 * Math.sin(angle + shape.phase) + 0.22 * Math.sin(angle * 3 - shape.phase);
    const span = across * shape.height * (0.8 + 0.12 * Math.cos(angle * 2 + shape.phase));
    return [shape.width * 0.43 * Math.cos(angle) * radius + span * Math.cos(twist) * Math.cos(angle),
      shape.curve * 0.88 * Math.sin(angle) + 0.23 * Math.sin(angle * 2 + shape.phase) + span * Math.cos(twist) * Math.sin(angle),
      shape.depth * Math.sin(angle + shape.phase) + 0.25 * Math.sin(angle * 2 - shape.phase) + span * Math.sin(twist)
        + shape.height * (shape.veil ?? 0.055) * (1 - 4 * across * across) * Math.cos(angle * 2 + shape.phase)];
  }
  if (shape.kind === "loop") {
    const angle = u * Math.PI * 2, span = across * shape.height;
    const twist = angle * 0.5 + 0.16 * Math.sin(angle * 2 + shape.phase);
    const radius = 1 + 0.09 * Math.sin(angle * 2 + shape.phase) + 0.045 * Math.cos(angle * 3 - shape.phase);
    return [shape.width * Math.cos(angle) * radius + span * Math.cos(twist) * Math.cos(angle),
      shape.curve * Math.sin(angle) + 0.23 * Math.sin(angle * 2 + shape.phase) + span * Math.cos(twist) * Math.sin(angle),
      shape.depth * Math.sin(angle + shape.phase) + 0.2 * Math.sin(angle * 3 - shape.phase) + span * Math.sin(twist)];
  }
  return [shape.width * (u - 0.5),
    shape.curve * 0.38 * Math.sin((u - 0.5) * Math.PI * 1.4 + shape.phase) + shape.height * across * (0.88 + 0.2 * Math.cos(u * Math.PI * 2 + shape.phase)),
    shape.depth * Math.sin(u * Math.PI * 1.65 + shape.phase) + across * shape.height * 0.28 * Math.sin(u * Math.PI * 2 + shape.phase)
      + shape.height * (shape.veil ?? 0.055) * (1 - 4 * across * across) * Math.sin(u * Math.PI * 1.4 + shape.phase)];
}
/** An indexed 2D manifold embedded in 3D, not a line, tube or sphere. Tangents support shader normals. */
export function createAuroraRibbonData(shape: AuroraRibbonShape, segments: number, rows: number) {
  if (!Number.isInteger(segments) || segments < 4 || segments > 256 || !Number.isInteger(rows) || rows < 2 || rows > 32) throw new Error("Invalid curtain resolution");
  const count = (segments + 1) * (rows + 1);
  const positions = new Float32Array(count * 3), tangentU = new Float32Array(count * 3), tangentV = new Float32Array(count * 3), uvs = new Float32Array(count * 2);
  const indices = new Uint16Array(segments * rows * 6);
  const epsilon = 0.0001;
  for (let y = 0; y <= rows; y++) for (let x = 0; x <= segments; x++) {
    const index = y * (segments + 1) + x, u = x / segments, v = y / rows;
    // Primary rings join equal widths; the supporting half-twist reverses widths.
    const p = (shape.closed || shape.kind === "loop") && x === segments ? surface(shape, 0, shape.kind === "loop" ? 1 - v : v) : surface(shape, u, v);
    const du = surface(shape, u + epsilon, v), dv = surface(shape, u, v + epsilon);
    positions.set(p, index * 3); uvs.set([u, v], index * 2);
    for (let axis = 0; axis < 3; axis++) { tangentU[index * 3 + axis] = (du[axis] - p[axis]) / epsilon; tangentV[index * 3 + axis] = (dv[axis] - p[axis]) / epsilon; }
    if (x < segments && y < rows) {
      const a = index, b = a + 1, c = a + segments + 1, d = c + 1;
      indices.set([a, b, c, b, d, c], (y * segments + x) * 6);
    }
  }
  return { positions, tangentU, tangentV, uvs, indices };
}
export function seededAuroraRandom(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
}
/** Sparse world-space strata surround the field; no camera/device inputs. */
export function createAuroraGlassData(count: number, seed = 712) {
  if (!Number.isInteger(count) || count < 0 || count > 32) throw new Error("Invalid glass budget");
  const random = seededAuroraRandom(seed), positions = new Float32Array(count * 3), rotations = new Float32Array(count * 3);
  const sizes = new Float32Array(count), phases = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const angle = i * Math.PI * 2 / count + 0.19 + random() * 0.1;
    const radius = [8.3, 10.4, 12.4][i % 3] + random() * 0.3;
    positions.set([AURORA_ORBITAL_ANCHOR[0] + Math.sin(angle) * radius * 0.8,
      AURORA_ORBITAL_ANCHOR[1] + (i % 2 ? 1 : -1) * (1.2 + random() * 2),
      -2.4 + Math.cos(angle) * radius * 1.03], i * 3);
    rotations.set([random() * Math.PI, random() * Math.PI * 2, random() * Math.PI], i * 3);
    sizes[i] = 0.11 + random() * 0.12; phases[i] = i * 1.37;
  }
  return { positions, rotations, sizes, phases };
}
/** Tiny insertion sort reuses caller storage; negative view Z renders first. */
export function sortAuroraGlassOrder(positions: Float32Array, viewMatrix: ArrayLike<number>, order: Uint16Array, depths: Float32Array): void {
  for (let i = 0; i < order.length; i++) {
    order[i] = i;
    depths[i] = viewMatrix[2] * positions[i * 3] + viewMatrix[6] * positions[i * 3 + 1] + viewMatrix[10] * positions[i * 3 + 2] + viewMatrix[14];
  }
  for (let i = 1; i < order.length; i++) {
    const value = order[i]; let j = i - 1;
    while (j >= 0 && depths[order[j]] > depths[value]) { order[j + 1] = order[j]; j--; }
    order[j + 1] = value;
  }
}
export function createAuroraParticleData(count: number, near: boolean, seed: number) {
  if (!Number.isInteger(count) || count < 0 || count > 5000) throw new Error("Invalid particle budget");
  const random = seededAuroraRandom(seed), positions = new Float32Array(count * 3), sizes = new Float32Array(count), phases = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions.set(near ? [(random() - 0.5) * 21, (random() - 0.5) * 12, -8 + random() * 15]
      : [(random() - 0.5) * 100, (random() - 0.5) * 65, -28 - random() * 55], i * 3);
    sizes[i] = near ? 0.13 + random() * 0.22 : 0.08 + random() * 0.32;
    phases[i] = random() * Math.PI * 2;
  }
  return { positions, sizes, phases };
}
