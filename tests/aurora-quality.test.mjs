import assert from "node:assert/strict";
import test from "node:test";
import { PerspectiveCamera, Vector3 } from "three";
import { loadModule } from "./helpers/load-typescript.mjs";

const { AURORA_PRESETS } = loadModule("lib/aurora-presets.ts");
const { auroraQualityBudget } = loadModule("lib/aurora-types.ts");
const { auroraCurtainMistShape, auroraLoopShapes, auroraRibbonShapes, createAuroraRibbonData,
  createAuroraGlassData, sortAuroraGlassOrder, updateAuroraRibbonPose } = loadModule("lib/aurora-geometry.ts");
const point = (data, index) => Array.from(data.positions.slice(index * 3, index * 3 + 3));
const samplePose = (shape, motion, time) => {
  const pose = { position: [0, 0, 0], rotation: [0, 0, 0] };
  updateAuroraRibbonPose(shape, motion, time, pose); return pose;
};

test("core bands widen by 28/30 percent and mist grows without changing their closed paths", () => {
  const main = auroraRibbonShapes(AURORA_PRESETS[3]), loops = auroraLoopShapes(AURORA_PRESETS[3]);
  const baselineHeights = [2.7, 3.35, 2.45, 3.1], loopHeights = [1.3, 1.05];
  for (const [shapes, heights, factor] of [[main, baselineHeights, 1.28], [loops, loopHeights, 1.3]]) {
    shapes.forEach((shape, i) => {
      assert.ok(Math.abs(shape.height / heights[i] - factor) < 1e-10);
      const before = createAuroraRibbonData({ ...shape, height: heights[i] }, 40, 6), after = createAuroraRibbonData(shape, 40, 6);
      for (let x = 0; x <= 40; x++) {
        const span = data => new Vector3(...point(data, x)).distanceTo(new Vector3(...point(data, 6 * 41 + x)));
        assert.ok(Math.abs(span(after) / span(before) - factor) < 1e-5);
      }
      assert.equal(shape.closed, true);
    });
  }
  main.forEach(s => assert.ok(auroraCurtainMistShape(s).height / s.height > 1.3));
});

test("low subdivision reduces maximum curtain approximation error without an unbounded mesh", () => {
  const error = (shape, segments, rows) => {
    const mesh = createAuroraRibbonData(shape, segments, rows), reference = createAuroraRibbonData(shape, segments * 2, rows * 2);
    let maximum = 0;
    for (let y = 0; y < rows; y++) for (let x = 0; x < segments; x++) {
      const b = point(mesh, y * (segments + 1) + x + 1), c = point(mesh, (y + 1) * (segments + 1) + x);
      const actual = point(reference, (2 * y + 1) * (2 * segments + 1) + 2 * x + 1);
      maximum = Math.max(maximum, Math.hypot(...actual.map((v, i) => v - (b[i] + c[i]) * 0.5)));
    }
    return maximum;
  };
  const budget = auroraQualityBudget("low");
  for (const preset of AURORA_PRESETS) for (const shape of auroraRibbonShapes(preset)) {
    assert.ok(error(shape, budget.segments, budget.rows) < error(shape, 56, 8) * 0.9);
  }
  assert.ok((budget.segments + 1) * (budget.rows + 1) < 750);
});
test("curtains have a curved transverse section rather than a flat linear width", () => {
  for (const shape of auroraRibbonShapes(AURORA_PRESETS[3])) {
    const data = createAuroraRibbonData(shape, 64, 10);
    let depth = 0;
    for (let x = 0; x <= 64; x++) {
      depth = Math.max(depth, Math.abs(point(data, 5 * 65 + x)[2] - (point(data, x)[2] + point(data, 10 * 65 + x)[2]) * 0.5));
    }
    assert.ok(depth > 0.1 && depth < 0.25);
  }
});
test("curtain mist shares its core pose and retains a valid wider depth-separated surface", () => {
  for (const preset of AURORA_PRESETS) for (const shape of auroraRibbonShapes(preset)) {
    const original = structuredClone(shape), mist = auroraCurtainMistShape(shape);
    for (const time of [0, 30, 3600]) assert.deepEqual(samplePose(mist, preset.motion, time), samplePose(shape, preset.motion, time));
    assert.equal(mist.colorIndex, shape.colorIndex); assert.equal(mist.phase, shape.phase);
    assert.ok(mist.height > shape.height && mist.height < shape.height * 1.4);
    const core = createAuroraRibbonData(shape, 32, 6), data = createAuroraRibbonData(mist, 32, 6);
    assert.ok(data.positions.every(Number.isFinite) && data.tangentU.every(Number.isFinite) && data.tangentV.every(Number.isFinite));
    assert.ok(data.positions.some((v, i) => i % 3 === 2 && Math.abs(v - core.positions[i]) > 0.2));
    for (let i = 0; i < data.indices.length; i += 3) {
      const a = new Vector3(...point(data, data.indices[i])), b = new Vector3(...point(data, data.indices[i + 1])), c = new Vector3(...point(data, data.indices[i + 2]));
      assert.ok(b.sub(a).cross(c.sub(a)).length() > 1e-5);
    }
    assert.deepEqual(shape, original);
  }
  assert.throws(() => auroraCurtainMistShape(auroraLoopShapes(AURORA_PRESETS[0])[0]));
});
test("sparse glass strata cover every viewing direction and several world-space depths at each quality", () => {
  for (const quality of ["low", "balanced", "high"]) {
    const count = auroraQualityBudget(quality).fragments, data = createAuroraGlassData(count), points = [];
    for (let i = 0; i < count; i++) points.push([data.positions[i * 3], data.positions[i * 3 + 1] - 0.15, data.positions[i * 3 + 2] + 2.4]);
    assert.ok(points.some(p => p[2] > 6) && points.some(p => p[2] < -6));
    assert.ok(points.some(p => p[0] > 6) && points.some(p => p[0] < -6));
    assert.ok(points.every(p => Math.hypot(...p) > 6 && Math.hypot(...p) < 14 && Math.abs(p[1]) < 3.3));
    assert.ok(Math.max(...points.map(p => Math.hypot(...p))) - Math.min(...points.map(p => Math.hypot(...p))) > 3);
    for (let angle = 0; angle < 32; angle++) {
      const theta = angle * Math.PI / 16;
      assert.ok(points.filter(p => p[0] * Math.sin(theta) + p[2] * Math.cos(theta) > 3).length >= 2);
    }
    assert.ok(data.sizes.every(v => v >= 0.11 && v <= 0.23));
  }
});
test("glass data is deterministic, finite and rejects unsafe allocation sizes", () => {
  const data = createAuroraGlassData(12);
  assert.deepEqual(data, createAuroraGlassData(12));
  assert.notDeepEqual(data.positions, createAuroraGlassData(12, 713).positions);
  for (const buffer of Object.values(data)) assert.ok(buffer.every(Number.isFinite));
  assert.equal(createAuroraGlassData(0).positions.length, 0);
  for (const count of [-1, 1.5, Infinity, NaN, 33]) assert.throws(() => createAuroraGlassData(count));
});
test("glass instances sort back to front from front, side, rear and tilted views using owned storage", () => {
  const data = createAuroraGlassData(18), original = data.positions.slice(), order = new Uint16Array(18), depths = new Float32Array(18);
  const camera = new PerspectiveCamera();
  for (const phi of [Math.PI / 6, Math.PI / 2, Math.PI * 5 / 6]) for (let i = 0; i < 16; i++) {
    const theta = i * Math.PI / 8;
    camera.position.set(25 * Math.sin(phi) * Math.sin(theta), 0.15 + 25 * Math.cos(phi), -2.4 + 25 * Math.sin(phi) * Math.cos(theta));
    camera.lookAt(0, 0.15, -2.4); camera.updateMatrixWorld();
    sortAuroraGlassOrder(data.positions, camera.matrixWorldInverse.elements, order, depths);
    assert.equal(new Set(order).size, 18);
    assert.ok(order.every((index, j) => j === 0 || depths[order[j - 1]] <= depths[index]));
  }
  assert.deepEqual(data.positions, original);
});
