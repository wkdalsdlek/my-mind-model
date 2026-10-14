import assert from "node:assert/strict";
import test from "node:test";
import { Euler, Vector3 } from "three";
import { loadModule } from "./helpers/load-typescript.mjs";

const { AURORA_PRESETS } = loadModule("lib/aurora-presets.ts");
const { SEMANTIC_FAMILIES } = loadModule("lib/semantic-families.ts");
const { AURORA_DEFAULT_LAYERS, AURORA_DEFAULT_FLOW_MODE, AURORA_MOTION_WEIGHTS, AURORA_ORBITAL_ANCHOR, AURORA_QUALITY_BUDGETS, auroraFlowBudget, auroraQualityBudget, auroraPaletteColors, validateAuroraAppearance, auroraFrameLoop, advanceAuroraTime, createAuroraMotionClock, advanceAuroraMotionClock } = loadModule("lib/aurora-types.ts");
const { auroraLoopMistShape, auroraLoopShapes, auroraRibbonShapes, createAuroraRibbonData, createAuroraParticleData, seededAuroraRandom, updateAuroraRibbonPose, updateAuroraFieldPose } = loadModule("lib/aurora-geometry.ts");
const copy = value => structuredClone(value);

test("four static presets use the approved seven-family colors and valid independent settings", () => {
  assert.deepEqual(AURORA_PRESETS.map(p => p.id), ["serenity", "connection", "exploration", "mixed"]);
  assert.equal(new Set(AURORA_PRESETS.map(p => p.name)).size, 4);
  assert.deepEqual(SEMANTIC_FAMILIES.map(f => f.color), ["#69D9E8", "#EDA2CE", "#65E4BD", "#B59AF4", "#FFC17D", "#D3E1F0", "#8586D9"]);
  for (const preset of AURORA_PRESETS) {
    assert.deepEqual(validateAuroraAppearance(preset), []);
    assert.ok(preset.description.length > 0);
    assert.deepEqual(auroraPaletteColors(preset.palette), preset.palette.map(p => SEMANTIC_FAMILIES.find(f => f.id === p.familyId).color));
    assert.equal(Object.hasOwn(preset, "answers"), false);
    assert.equal(Object.hasOwn(preset, "approvedSentence"), false);
  }
});
test("Serenity, Connection, Exploration and Mixed keep their distinct dominant families", () => {
  assert.equal(AURORA_PRESETS[0].palette[0].familyId, "serenity");
  assert.ok(AURORA_PRESETS[0].palette.some(p => p.familyId === "grounding"));
  assert.deepEqual(AURORA_PRESETS[1].palette.slice(0, 2).map(p => p.familyId), ["connection", "expression"]);
  assert.deepEqual(AURORA_PRESETS[2].palette.slice(0, 2).map(p => p.familyId), ["exploration", "serenity"]);
  assert.equal(AURORA_PRESETS[3].palette.length, 4);
  assert.ok(AURORA_PRESETS.every(p => p.palette.every(s => s.weight > 0)));
});
test("external colors, ratios, movement and ribbon count are accepted without mutating semantics", () => {
  const original = copy(SEMANTIC_FAMILIES);
  const settings = copy(AURORA_PRESETS[0]);
  settings.palette = [{ familyId: "serenity", weight: 0.7, color: "#123ABC" }, { familyId: "grounding", weight: 0.3, color: "#d0e0f0" }];
  settings.motion = { speed: 0.8, amplitude: 1.2, flow: 0.9 };
  settings.ribbonCount = 2;
  assert.deepEqual(validateAuroraAppearance(settings), []);
  assert.deepEqual(auroraPaletteColors(settings.palette), ["#123ABC", "#d0e0f0"]);
  const shapes = auroraRibbonShapes(settings);
  assert.equal(shapes.length, 2);
  assert.equal(shapes[0].speed, 0.8);
  assert.equal(shapes[0].amplitude, 1.2);
  assert.deepEqual(SEMANTIC_FAMILIES, original);
});
test("invalid colors, ratios, identities, movement or ribbon count are rejected", () => {
  const alterations = [
    s => { s.ribbonCount = 1; }, s => { s.ribbonCount = 5; }, s => { s.palette = []; },
    s => { s.palette[0].familyId = "unknown"; }, s => { s.palette[1].familyId = s.palette[0].familyId; },
    s => { s.palette[0].weight = 0; }, s => { s.palette[0].weight = Number.NaN; }, s => { s.palette[0].weight = 0.99; },
    s => { s.palette[0].color = "url(remote)"; }, s => { s.palette[0].color = "#FFF"; },
    s => { s.motion.speed = -1; }, s => { s.motion.amplitude = Infinity; }, s => { s.motion.flow = 3; },
  ];
  for (const alter of alterations) { const settings = copy(AURORA_PRESETS[0]); alter(settings); assert.ok(validateAuroraAppearance(settings).length > 0); }
  assert.ok(validateAuroraAppearance(null).length > 0);
});
test("quality tiers bound vertex, particle, glass, DPR and bloom budgets monotonically", () => {
  const tiers = ["low", "balanced", "high"].map(q => auroraQualityBudget(q));
  for (const key of ["segments", "rows", "stars", "dust", "fragments", "dpr", "bloomHeight"]) {
    assert.ok(tiers[0][key] < tiers[1][key]); assert.ok(tiers[1][key] < tiers[2][key]);
  }
  assert.ok(tiers[2].dpr <= 2);
  assert.ok((tiers[2].segments + 1) * (tiers[2].rows + 1) * 4 < 14000);
  assert.ok(tiers[2].stars + tiers[2].dust <= 2600);
  assert.ok(tiers[2].fragments <= 18);
});
test("device class preserves the selected fidelity, core geometry and optical budget", () => {
  for (const quality of ["low", "balanced", "high"]) {
    const desktop = auroraQualityBudget(quality), compact = auroraQualityBudget(quality, true);
    assert.deepEqual(compact, desktop);
    assert.deepEqual(compact, AURORA_QUALITY_BUDGETS[quality]);
  }
});
test("returned quality settings cannot mutate global preset budgets", () => {
  const original = copy(AURORA_QUALITY_BUDGETS);
  const budget = auroraQualityBudget("balanced"); budget.stars = 99999;
  assert.deepEqual(AURORA_QUALITY_BUDGETS, original);
  assert.notEqual(auroraQualityBudget("balanced").stars, 99999);
});
test("hidden pages stop rendering and reduced motion uses demand rendering", () => {
  assert.equal(auroraFrameLoop(false, false), "never");
  assert.equal(auroraFrameLoop(false, true), "never");
  assert.equal(auroraFrameLoop(true, true), "demand");
  assert.equal(auroraFrameLoop(true, false), "always");
  assert.deepEqual(AURORA_DEFAULT_LAYERS, { nebula: true, ribbons: true, glass: true, stardust: true, bloom: true });
});
test("animation time is independent of 30/60/120 fps and bounded across long gaps", () => {
  for (const fps of [30, 60, 120]) {
    let time = 8.3;
    for (let frame = 0; frame < fps * 10; frame++) time = advanceAuroraTime(time, 1 / fps, true);
    assert.ok(Math.abs(time - 18.3) < 1e-9);
  }
  assert.equal(advanceAuroraTime(8.3, 1, false), 8.3);
  assert.ok(Math.abs(advanceAuroraTime(8.3, 30, true) - 8.4) < 1e-9);
  for (const delta of [-1, Number.NaN, Infinity]) assert.equal(advanceAuroraTime(8.3, delta, true), 8.3);
});
test("two to four ribbons have different depth, rotation, curve and wave parameters", () => {
  for (const count of [2, 3, 4]) {
    const shapes = auroraRibbonShapes({ ...AURORA_PRESETS[0], ribbonCount: count });
    assert.equal(shapes.length, count);
    for (const get of [s => s.position[2], s => s.phase, s => s.frequency, s => s.curve, s => s.height, s => s.speed]) assert.equal(new Set(shapes.map(get)).size, count);
    assert.ok(shapes.some(s => s.speed > 0)); assert.ok(shapes.some(s => s.speed < 0));
    assert.ok(shapes.every(s => s.position.every(Number.isFinite) && s.rotation.every(Number.isFinite)));
  }
});
const newPose = () => ({ position: [0, 0, 0], rotation: [0, 0, 0] });
const samplePose = (shape, motion, time) => {
  const pose = newPose(); updateAuroraRibbonPose(shape, motion, time, pose); return pose;
};
test("restrained orbital paths remain curved and distinct within the energy field", () => {
  for (const preset of AURORA_PRESETS) for (const shape of auroraRibbonShapes(preset)) {
    const samples = Array.from({ length: 120 }, (_, i) => samplePose(shape, preset.motion, i));
    for (let axis = 0; axis < 3; axis++) {
      const coordinates = samples.map(p => p.position[axis]);
      const span = Math.max(...coordinates) - Math.min(...coordinates);
      assert.ok(span > 0.02 && span < 0.8);
    }
    const a = samples[0].position, b = samples[10].position, c = samples[20].position;
    const ab = b.map((v, i) => v - a[i]), ac = c.map((v, i) => v - a[i]);
    const area = Math.hypot(ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]);
    assert.ok(area / (Math.hypot(...ab) * Math.hypot(...ac)) > 0.05, "The compact path must still curve through a tilted orbit");
    assert.ok(samples.some(p => p.rotation.some((v, i) => Math.abs(v - samples[0].rotation[i]) > 0.007)));
  }
});
test("each ribbon keeps a distinct orbit and direction within the shared field", () => {
  const preset = AURORA_PRESETS[3], shapes = auroraRibbonShapes(preset);
  assert.equal(new Set(shapes.map(s => s.orbitTilt)).size, 4);
  assert.equal(new Set(shapes.map(s => s.orbitRadii.join(","))).size, 4);
  const displacements = shapes.map(shape => {
    const start = samplePose(shape, preset.motion, 8.3), end = samplePose(shape, preset.motion, 13.3);
    return end.position.map((v, i) => v - start.position[i]);
  });
  assert.ok(displacements.some(p => p[0] > 0)); assert.ok(displacements.some(p => p[0] < 0));
  assert.equal(new Set(displacements.map(p => p.map(v => v.toFixed(3)).join(","))).size, 4);
});
test("default and dynamic orbital poses remain continuous, finite and bounded over long sessions", () => {
  for (const preset of AURORA_PRESETS) for (const shape of auroraRibbonShapes(preset)) for (const intensity of [1, 1.35]) {
    const motion = { ...preset.motion, intensity };
    for (const time of [0, 8.3, 30, 90, 300, 900, 3600]) {
      const a = samplePose(shape, motion, time), b = samplePose(shape, motion, time + 0.1);
      for (let axis = 0; axis < 3; axis++) {
        assert.ok(Number.isFinite(a.position[axis]) && Number.isFinite(a.rotation[axis]));
        assert.ok(Math.abs(a.position[axis] - shape.position[axis]) < 3.3);
        assert.ok(Math.abs(a.rotation[axis] - shape.rotation[axis]) < 0.3);
        assert.ok(Math.abs(b.position[axis] - a.position[axis]) < 0.08);
        assert.ok(Math.abs(b.rotation[axis] - a.rotation[axis]) < 0.01);
      }
    }
  }
});
test("dynamic mode increases travel without accelerating orbital phase or changing geometry", () => {
  const preset = AURORA_PRESETS[0], shape = auroraRibbonShapes(preset)[0];
  const baseline = samplePose(shape, preset.motion, 8.3);
  const dynamic = samplePose(shape, { ...preset.motion, intensity: 1.35 }, 8.3);
  const a = baseline.position.map((v, i) => v - shape.position[i]), b = dynamic.position.map((v, i) => v - shape.position[i]);
  assert.ok(Math.hypot(...b) > Math.hypot(...a));
  assert.ok(a.every((v, i) => Math.sign(v) === Math.sign(b[i])));
  assert.deepEqual(auroraRibbonShapes({ ...preset, motion: { ...preset.motion, intensity: 1.35 } }), auroraRibbonShapes(preset));
});
test("zero motion and reduced-motion time freeze orbits; pose updates reuse owned storage", () => {
  const preset = copy(AURORA_PRESETS[0]), shape = auroraRibbonShapes(preset)[0];
  const original = copy({ preset, shape }), target = newPose(), position = target.position, rotation = target.rotation;
  const frozenTime = advanceAuroraTime(8.3, 1, false);
  updateAuroraRibbonPose(shape, preset.motion, 8.3, target);
  assert.deepEqual(samplePose(shape, preset.motion, frozenTime), target);
  assert.deepEqual(samplePose({ ...shape, speed: 0 }, { ...preset.motion, speed: 0 }, 0), samplePose({ ...shape, speed: 0 }, { ...preset.motion, speed: 0 }, 100));
  assert.deepEqual(samplePose(shape, { ...preset.motion, amplitude: 0 }, 100), samplePose(shape, { ...preset.motion, amplitude: 0 }, 0));
  updateAuroraRibbonPose(shape, preset.motion, 20, target);
  assert.equal(target.position, position); assert.equal(target.rotation, rotation);
  assert.deepEqual({ preset, shape }, original);
});
test("motion intensity is optional, accepts comparison modes and rejects unsafe values", () => {
  for (const intensity of [undefined, 0.5, 1, 1.35, 1.5]) {
    assert.deepEqual(validateAuroraAppearance({ ...AURORA_PRESETS[0], motion: { ...AURORA_PRESETS[0].motion, intensity } }), []);
  }
  for (const intensity of [0, -1, 1.51, Infinity, NaN]) {
    assert.ok(validateAuroraAppearance({ ...AURORA_PRESETS[0], motion: { ...AURORA_PRESETS[0].motion, intensity } }).length > 0);
  }
});
const point = (data, i) => Array.from(data.positions.slice(i * 3, i * 3 + 3));
const sub = (a, b) => a.map((v, i) => v - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
test("primary closed-ribbon topology is indexed, finite, nondegenerate and has real 3D depth", () => {
  for (const preset of AURORA_PRESETS) for (const shape of auroraRibbonShapes(preset)) {
    const segments = 40, rows = 6, data = createAuroraRibbonData(shape, segments, rows), count = (segments + 1) * (rows + 1);
    assert.equal(data.positions.length, count * 3);
    assert.equal(data.uvs.length, count * 2);
    assert.equal(data.indices.length, segments * rows * 6);
    for (const array of [data.positions, data.tangentU, data.tangentV, data.uvs]) assert.ok(array.every(Number.isFinite));
    assert.ok(data.uvs.every(value => value >= 0 && value <= 1));
    assert.ok(data.indices.every(index => index < count));
    for (let i = 0; i < data.indices.length; i += 3) {
      const a = point(data, data.indices[i]), b = point(data, data.indices[i + 1]), c = point(data, data.indices[i + 2]);
      assert.ok(Math.hypot(...cross(sub(b, a), sub(c, a))) > 1e-5);
    }
    const z = Array.from({ length: count }, (_, i) => data.positions[i * 3 + 2]);
    assert.ok(Math.max(...z) - Math.min(...z) > 1);
    const a = point(data, 0), b = point(data, segments / 4), c = point(data, segments / 2), d = point(data, (segments + 1) * rows + segments * 3 / 4);
    const normal = cross(sub(b, a), sub(c, a));
    assert.ok(Math.abs(dot(normal, sub(d, a))) > 0.01, "The curtain must not be a coplanar spectrum sheet");
  }
});
test("surface tangents are nonzero, independent and vary along the curtain", () => {
  const shape = auroraRibbonShapes(AURORA_PRESETS[0])[0], data = createAuroraRibbonData(shape, 40, 6);
  const normals = [];
  for (const index of [0, 10, 20, 30, 40]) {
    const u = Array.from(data.tangentU.slice(index * 3, index * 3 + 3)), v = Array.from(data.tangentV.slice(index * 3, index * 3 + 3));
    const normal = cross(u, v), length = Math.hypot(...normal);
    assert.ok(length > 1);
    normals.push(normal.map(value => value / length));
  }
  assert.ok(normals.slice(1).some(n => Math.abs(dot(normals[0], n)) < 0.98));
});
test("all quality levels fit Uint16 index capacity and invalid geometry budgets are rejected", () => {
  const shape = auroraRibbonShapes(AURORA_PRESETS[0])[0];
  for (const quality of ["low", "balanced", "high"]) for (const compact of [false, true]) {
    const budget = auroraQualityBudget(quality, compact), data = createAuroraRibbonData(shape, budget.segments, budget.rows);
    assert.ok(data.indices instanceof Uint16Array);
    assert.ok(data.positions.length / 3 < 65536);
    assert.ok(data.indices.every(index => index < data.positions.length / 3));
  }
  for (const [segments, rows] of [[0, 4], [257, 4], [20.5, 4], [40, 1], [40, 33]]) assert.throws(() => createAuroraRibbonData(shape, segments, rows));
});
test("geometry and shapes are repeatable and cannot alter their input presets", () => {
  const preset = copy(AURORA_PRESETS[0]), original = copy(preset);
  const shape = auroraRibbonShapes(preset)[0];
  assert.deepEqual(createAuroraRibbonData(shape, 40, 6), createAuroraRibbonData(shape, 40, 6));
  assert.deepEqual(auroraRibbonShapes(preset), auroraRibbonShapes(preset));
  assert.deepEqual(preset, original);
});
test("particles are deterministic, preallocated and occupy genuinely separate depth ranges", () => {
  const far = createAuroraParticleData(600, false, 471), near = createAuroraParticleData(100, true, 913);
  assert.deepEqual(createAuroraParticleData(600, false, 471), far);
  assert.equal(far.positions.length, 1800); assert.equal(near.positions.length, 300);
  for (let i = 0; i < 600; i++) assert.ok(far.positions[i * 3 + 2] <= -28 && far.positions[i * 3 + 2] >= -83);
  for (let i = 0; i < 100; i++) assert.ok(near.positions[i * 3 + 2] >= -8 && near.positions[i * 3 + 2] <= 7);
  for (const data of [near, far]) {
    assert.ok(data.positions.every(Number.isFinite)); assert.ok(data.sizes.every(v => v > 0));
    assert.ok(data.phases.every(v => v >= 0 && v <= Math.PI * 2));
  }
});
test("random sequences are stable and particle budgets reject nonfinite or excessive allocations", () => {
  const a = seededAuroraRandom(42), b = seededAuroraRandom(42);
  for (let i = 0; i < 200; i++) { const value = a(); assert.equal(value, b()); assert.ok(value >= 0 && value < 1); }
  assert.equal(createAuroraParticleData(0, false, 1).positions.length, 0);
  for (const count of [-1, 1.5, Infinity, 5001]) assert.throws(() => createAuroraParticleData(count, false, 1));
});

test("flow modes retain independent counts and add zero, one or two loops with Hybrid as default", () => {
  assert.equal(AURORA_DEFAULT_FLOW_MODE, "hybrid");
  for (const quality of ["low", "balanced", "high"]) for (const compact of [false, true]) {
    const budget = auroraQualityBudget(quality, compact), original = copy(budget);
    for (const [mode, count] of [["independent", 0], ["hybrid", 1], ["loop-emphasis", 2]]) {
      const flow = auroraFlowBudget(mode, budget);
      assert.equal(flow.loopCount, count);
      for (const ribbonCount of [2, 3, 4]) {
        assert.equal(auroraRibbonShapes({ ...AURORA_PRESETS[0], ribbonCount }).length, ribbonCount);
      }
      assert.ok(flow.segments >= 40 && flow.segments <= 128);
      assert.ok(flow.rows <= 14 && flow.rows <= budget.rows);
      const totalVertices = 4 * (budget.segments + 1) * (budget.rows + 1) + 2 * (flow.segments + 1) * (flow.rows + 1)
        + 2 * flow.mistLayers * (flow.mistSegments + 1) * (flow.mistRows + 1)
        + 4 * (flow.curtainMistSegments + 1) * (flow.curtainMistRows + 1);
      assert.ok(totalVertices < { low: 6000, balanced: 15000, high: 24000 }[quality]);
    }
    assert.deepEqual(budget, original);
  }
  assert.throws(() => auroraFlowBudget("unknown", auroraQualityBudget("low")));
});
test("loop profiles are different, translucent ribbon surfaces in the same palette", () => {
  for (const preset of AURORA_PRESETS) {
    const original = copy(preset), loops = auroraLoopShapes(preset);
    assert.equal(loops.length, 2);
    assert.deepEqual(auroraLoopShapes(preset), loops);
    assert.ok(loops.every(s => s.kind === "loop" && s.colorIndex < preset.palette.length && s.height < s.width / 2));
    assert.notEqual(loops[0].position[2], loops[1].position[2]);
    assert.notEqual(loops[0].orbitTilt, loops[1].orbitTilt);
    assert.ok(loops[0].orbitRate > 0 && loops[1].orbitRate < 0);
    assert.deepEqual(preset, original);
  }
});
test("half-twisted loop joins match reversed width with no positional crack in every quality", () => {
  for (const preset of AURORA_PRESETS) for (const shape of auroraLoopShapes(preset)) {
    for (const quality of ["low", "balanced", "high"]) for (const compact of [false, true]) {
      const { segments, rows } = auroraFlowBudget("hybrid", auroraQualityBudget(quality, compact));
      const data = createAuroraRibbonData(shape, segments, rows);
      for (let row = 0; row <= rows; row++) {
        const start = (rows - row) * (segments + 1), end = row * (segments + 1) + segments;
        assert.ok(Math.hypot(...sub(point(data, start), point(data, end))) < 1e-6);
        assert.equal(data.uvs[start * 2], 0); assert.equal(data.uvs[end * 2], 1);
        const a = Array.from(data.tangentV.slice(start * 3, start * 3 + 3));
        const b = Array.from(data.tangentV.slice(end * 3, end * 3 + 3));
        assert.ok(dot(a, b) / (Math.hypot(...a) * Math.hypot(...b)) < -0.999, "The seam must reverse the band width");
      }
    }
  }
});
test("loop triangles and surface tangents remain finite, nondegenerate and genuinely deep", () => {
  for (const preset of AURORA_PRESETS) for (const shape of auroraLoopShapes(preset)) {
    const data = createAuroraRibbonData(shape, 80, 8), count = data.positions.length / 3;
    for (const values of [data.positions, data.tangentU, data.tangentV, data.uvs]) assert.ok(values.every(Number.isFinite));
    assert.ok(data.indices.every(i => i < count));
    for (let i = 0; i < data.indices.length; i += 3) {
      const a = point(data, data.indices[i]), b = point(data, data.indices[i + 1]), c = point(data, data.indices[i + 2]);
      assert.ok(Math.hypot(...cross(sub(b, a), sub(c, a))) > 1e-5);
    }
    for (let i = 0; i < count; i++) {
      const du = Array.from(data.tangentU.slice(i * 3, i * 3 + 3)), dv = Array.from(data.tangentV.slice(i * 3, i * 3 + 3));
      assert.ok(Math.hypot(...cross(du, dv)) > 1);
    }
    const depths = Array.from({ length: count }, (_, i) => data.positions[i * 3 + 2]);
    assert.ok(Math.max(...depths) - Math.min(...depths) > 2);
    // The irregular centerline must not be a planar perfect ellipse.
    const a = point(data, 4 * 81), b = point(data, 4 * 81 + 20), c = point(data, 4 * 81 + 40), d = point(data, 4 * 81 + 60);
    assert.ok(Math.abs(dot(cross(sub(b, a), sub(c, a)), sub(d, a))) > 0.05);
  }
});
test("shared field is curved, bounded and stationary when reduced-motion time is frozen", () => {
  assert.ok(Math.abs(Object.values(AURORA_MOTION_WEIGHTS).reduce((a, b) => a + b, 0) - 1) < 1e-12);
  assert.ok(AURORA_MOTION_WEIGHTS.field > AURORA_MOTION_WEIGHTS.individual && AURORA_MOTION_WEIGHTS.individual > AURORA_MOTION_WEIGHTS.surface);
  for (const preset of AURORA_PRESETS) {
    const pose = newPose(), original = copy(preset);
    const samples = [];
    for (const time of [0, 10, 20, 60, 300, 3600]) {
      updateAuroraFieldPose(preset.motion, time, pose); samples.push(copy(pose));
      assert.ok(pose.position.every(v => Number.isFinite(v) && Math.abs(v) < 2));
      assert.ok(pose.rotation.every(v => Number.isFinite(v) && Math.abs(v) < 0.4));
    }
    const a = sub(samples[1].position, samples[0].position), b = sub(samples[2].position, samples[0].position);
    assert.ok(Math.hypot(...cross(a, b)) / (Math.hypot(...a) * Math.hypot(...b)) > 0.05);
    const frozen = newPose(); updateAuroraFieldPose(preset.motion, advanceAuroraTime(3600, 1, false), frozen);
    assert.deepEqual(frozen, samples.at(-1)); assert.deepEqual(preset, original);
  }
});
test("loop precession stays slow and bounded instead of repeatedly spinning a geometric ring", () => {
  for (const preset of AURORA_PRESETS) for (const loop of auroraLoopShapes(preset)) {
    const start = samplePose(loop, preset.motion, 0), end = samplePose(loop, preset.motion, 90);
    assert.ok(Math.abs(end.rotation[0] - start.rotation[0]) > 0.005);
    assert.ok(Math.abs(end.rotation[2] - start.rotation[2]) > 0.002);
    for (const time of [0, 8.3, 60, 300, 3600, 36000]) {
      const a = samplePose(loop, preset.motion, time), b = samplePose(loop, preset.motion, time + 0.1);
      assert.ok(a.position.every(Number.isFinite) && a.rotation.every(Number.isFinite));
      assert.ok(a.rotation.every((v, i) => Math.abs(v - loop.rotation[i]) < 0.15));
      assert.ok(b.rotation.every((v, i) => Math.abs(v - a.rotation[i]) < 0.002));
      assert.ok(b.position.every((v, i) => Math.abs(v - a.position[i]) < 0.08));
    }
  }
});
test("integrated motion clock preserves long-running phase during presets and freezes on reduced motion", () => {
  const initial = AURORA_PRESETS[0].motion, target = AURORA_PRESETS[2].motion, clock = createAuroraMotionClock(initial);
  advanceAuroraMotionClock(clock, 3600, initial, false);
  const phase = clock.phase, amplitude = clock.motion.amplitude;
  advanceAuroraMotionClock(clock, 3600, target, false);
  assert.equal(clock.phase, phase); assert.equal(clock.motion.amplitude, amplitude);
  advanceAuroraMotionClock(clock, 3600 + 1 / 60, target, false);
  assert.ok(clock.phase > phase && clock.phase - phase < 0.01);
  assert.ok(clock.motion.amplitude > amplitude && clock.motion.amplitude < target.amplitude);
  const nextPhase = clock.phase;
  advanceAuroraMotionClock(clock, 3601, target, true);
  assert.equal(clock.phase, nextPhase); assert.equal(clock.delta, 0);
  const pose = samplePose(auroraLoopShapes(AURORA_PRESETS[0])[0], clock.motion, clock.phase);
  advanceAuroraMotionClock(clock, 3602, target, true);
  assert.deepEqual(samplePose(auroraLoopShapes(AURORA_PRESETS[0])[0], clock.motion, clock.phase), pose);
  advanceAuroraMotionClock(clock, 3602 + 1 / 60, target, false);
  assert.ok(clock.phase - nextPhase < 0.01);
});
test("phase is frame-rate independent at steady speed and clamps long gaps without mutating targets", () => {
  const motion = copy(AURORA_PRESETS[3].motion), original = copy(motion), phases = [];
  for (const fps of [30, 60, 120]) {
    const clock = createAuroraMotionClock(motion); advanceAuroraMotionClock(clock, 8.3, motion, false);
    for (let frame = 1; frame <= fps * 10; frame++) advanceAuroraMotionClock(clock, 8.3 + frame / fps, motion, false);
    phases.push(clock.phase);
    const before = clock.phase; advanceAuroraMotionClock(clock, 1000, motion, false);
    assert.ok(clock.phase - before <= motion.speed * 0.1 + 1e-9);
    const current = clock.phase;
    for (const time of [NaN, Infinity]) { advanceAuroraMotionClock(clock, time, motion, false); assert.equal(clock.phase, current); }
  }
  assert.ok(Math.max(...phases) - Math.min(...phases) < 1e-9);
  assert.deepEqual(motion, original);
});

test("field anchor and all world-space ribbon centers stay concentrated across presets and long sessions", () => {
  const anchor = new Vector3(...AURORA_ORBITAL_ANCHOR);
  for (const preset of AURORA_PRESETS) for (const intensity of [1, 1.35, 1.5]) {
    for (const amplitude of [preset.motion.amplitude, 1.5]) {
      const motion = { ...preset.motion, intensity, amplitude }, field = newPose();
      for (const time of [0, 8.3, 30, 60, 120, 600, 3600, 36000]) {
        updateAuroraFieldPose(motion, time, field);
        assert.ok(new Vector3(...field.position).distanceTo(anchor) < 0.35, "The shared center must not wander away");
        for (const shape of [...auroraRibbonShapes(preset), ...auroraLoopShapes(preset)]) {
          const local = samplePose(shape, motion, time);
          const world = new Vector3(...local.position).applyEuler(new Euler(...field.rotation)).add(new Vector3(...field.position));
          assert.ok(Math.hypot(world.x - anchor.x, world.y - anchor.y) < 2, "All ribbon centers must remain around one anchor");
          assert.ok(world.toArray().every(Number.isFinite));
        }
      }
    }
  }
});
test("mist quality follows the selected tier consistently on all device classes", () => {
  for (const quality of ["low", "balanced", "high"]) {
    const mobile = auroraFlowBudget("hybrid", auroraQualityBudget(quality, true));
    const desktop = auroraFlowBudget("hybrid", auroraQualityBudget(quality));
    assert.equal(mobile.mistLayers, quality === "low" ? 1 : 2);
    assert.deepEqual(mobile, desktop);
    assert.equal(desktop.mistLayers, quality === "low" ? 1 : 2);
    for (const flow of [mobile, desktop]) {
      assert.ok(flow.mistSegments >= 40 && flow.mistSegments <= 80);
      assert.ok(flow.mistRows <= 8 && flow.mistRows >= 6);
      assert.ok((flow.mistSegments + 1) * (flow.mistRows + 1) < 750);
    }
  }
});
test("mist veils widen and separate in depth while sharing the core's anchor, phase and palette", () => {
  for (const preset of AURORA_PRESETS) for (const loop of auroraLoopShapes(preset)) {
    const original = copy(loop), veils = [0, 1].map(layer => auroraLoopMistShape(loop, layer));
    assert.ok(veils[0].depth > loop.depth && veils[1].depth < loop.depth);
    for (const veil of veils) {
      assert.ok(veil.height > loop.height && veil.height < veil.width);
      assert.equal(veil.colorIndex, loop.colorIndex); assert.equal(veil.phase, loop.phase);
      for (const time of [0, 30, 3600]) assert.deepEqual(samplePose(veil, preset.motion, time), samplePose(loop, preset.motion, time));
    }
    assert.deepEqual(loop, original);
  }
  assert.throws(() => auroraLoopMistShape(auroraRibbonShapes(AURORA_PRESETS[0])[0], 0));
  for (const layer of [-1, 2, 0.5, NaN]) assert.throws(() => auroraLoopMistShape(auroraLoopShapes(AURORA_PRESETS[0])[0], layer));
});
test("widened mist layers keep a closed seam and valid triangles at every quality", () => {
  for (const preset of AURORA_PRESETS) for (const loop of auroraLoopShapes(preset)) {
    for (const quality of ["low", "balanced", "high"]) for (const compact of [false, true]) {
      const flow = auroraFlowBudget("hybrid", auroraQualityBudget(quality, compact));
      for (let layer = 0; layer < flow.mistLayers; layer++) {
        const shape = auroraLoopMistShape(loop, layer), data = createAuroraRibbonData(shape, flow.mistSegments, flow.mistRows);
        for (const values of [data.positions, data.tangentU, data.tangentV]) assert.ok(values.every(Number.isFinite));
        for (let row = 0; row <= flow.mistRows; row++) {
          const start = (flow.mistRows - row) * (flow.mistSegments + 1), end = row * (flow.mistSegments + 1) + flow.mistSegments;
          assert.ok(Math.hypot(...sub(point(data, start), point(data, end))) < 1e-6);
        }
        for (let i = 0; i < data.indices.length; i += 3) {
          const a = point(data, data.indices[i]), b = point(data, data.indices[i + 1]), c = point(data, data.indices[i + 2]);
          assert.ok(Math.hypot(...cross(sub(b, a), sub(c, a))) > 1e-5);
        }
      }
    }
  }
});
