import assert from "node:assert/strict";
import test from "node:test";
import { loadModule } from "./helpers/load-typescript.mjs";

const { auroraEnergyProfile, auroraEnergyProfiles, createAuroraEnergyEvent, updateAuroraEnergyEvent, sampleAuroraEnergy, sampleAuroraEnergyField, auroraEnergyBreath } = loadModule("lib/aurora-energy.ts");
const { AURORA_PRESETS } = loadModule("lib/aurora-presets.ts");
const { auroraQualityBudget, auroraFlowBudget, createAuroraMotionClock, advanceAuroraMotionClock } = loadModule("lib/aurora-types.ts");
const { auroraRibbonShapes, auroraLoopShapes, auroraCurtainMistShape, auroraLoopMistShape, createAuroraRibbonData } = loadModule("lib/aurora-geometry.ts");
const seeds = [...auroraRibbonShapes(AURORA_PRESETS[3]), ...auroraLoopShapes(AURORA_PRESETS[3])].map(s => s.energySeed);
const profiles = seeds.map(auroraEnergyProfile);
const near = (a, b, epsilon = 1e-6) => assert.ok(Math.abs(a - b) < epsilon, `${a} vs ${b}`);

test("primary ribbons and both mist families close positions and tangents at every quality", () => {
  for (const preset of AURORA_PRESETS) for (const quality of ["low", "balanced", "high"]) {
    const budget = auroraQualityBudget(quality), flow = auroraFlowBudget("hybrid", budget);
    for (const main of auroraRibbonShapes(preset)) for (const [shape, segments, rows] of [
      [main, budget.segments, budget.rows], [auroraCurtainMistShape(main), flow.curtainMistSegments, flow.curtainMistRows],
    ]) {
      assert.equal(shape.closed, true);
      const data = createAuroraRibbonData(shape, segments, rows);
      for (let y = 0; y <= rows; y++) {
        const a = y * (segments + 1), b = a + segments;
        for (let axis = 0; axis < 3; axis++) {
          near(data.positions[a * 3 + axis], data.positions[b * 3 + axis]);
          near(data.tangentU[a * 3 + axis], data.tangentU[b * 3 + axis]);
          near(data.tangentV[a * 3 + axis], data.tangentV[b * 3 + axis]);
        }
      }
    }
    for (const loop of auroraLoopShapes(preset)) assert.equal(auroraLoopMistShape(loop, 0).energySeed, loop.energySeed);
  }
});
test("independent seeds vary timing, speed, length, rest, focus and direction without re-seeding on presets", () => {
  assert.equal(new Set(seeds).size, seeds.length);
  for (const key of ["cycle", "travel", "offset", "speed", "length", "focus", "gain"]) assert.equal(new Set(profiles.map(p => p[key])).size, profiles.length);
  assert.equal(new Set(profiles.map(p => p.direction)).size, 2);
  for (const p of profiles) {
    assert.ok(p.cycle >= 16 && p.cycle <= 22 && p.travel >= 8.5 && p.travel <= 10);
    assert.ok(p.cycle - p.travel * 1.07 * 1.3 - p.jitter > 0.3 && p.offset >= 0 && p.offset < p.cycle);
    assert.ok(p.speed >= 0.065 && p.speed <= 0.12 && p.length >= 0.14 && p.length <= 0.26);
  }
  for (const preset of AURORA_PRESETS) {
    const shapes = auroraRibbonShapes(preset);
    assert.deepEqual(shapes.map(s => s.energySeed), seeds.slice(0, shapes.length));
    for (const shape of shapes) assert.equal(auroraCurtainMistShape(shape).energySeed, shape.energySeed);
  }
  profiles.forEach((p, i) => assert.deepEqual(p, auroraEnergyProfile(seeds[i])));
});
test("streams cross the spatial seam continuously, leave a wake and remain bounded", () => {
  for (const p of profiles) for (const time of [0, 8.3, 23, 32, 120, 3600, 36000]) {
    const start = sampleAuroraEnergy(p, time, 0), end = sampleAuroraEnergy(p, time, 1);
    near(start.stream, end.stream); near(start.wake, end.wake);
    for (let u = 0; u <= 1; u += 0.02) {
      const e = sampleAuroraEnergy(p, time, u);
      assert.ok(e.stream >= 0 && e.stream <= 1 && e.wake >= 0 && e.wake <= 0.4);
      assert.ok(e.breath >= 0.88 && e.breath <= 1);
    }
    // Values on either side of the UV join must agree as well.
    near(sampleAuroraEnergy(p, time, 1e-6).stream, sampleAuroraEnergy(p, time, 1 - 1e-6).stream, 1e-4);
  }
  for (const p of profiles) {
    const event = createAuroraEnergyEvent(); updateAuroraEnergyEvent(p, p.cycle - p.offset + p.jitter, event);
    const t = event.start + event.travel * 1.1;
    let wake = 0, stream = 0;
    for (let u = 0; u < 1; u += 0.005) { const e = sampleAuroraEnergy(p, t, u); wake = Math.max(wake, e.wake); stream = Math.max(stream, e.stream); }
    assert.equal(stream, 0); assert.ok(wake > 0);
  }
});
test("both directions advect their brightest stream along the ribbon instead of pulsing uniformly", () => {
  const peak = (p, time) => {
    let best = -1, at = 0;
    for (let u = 0; u < 1; u += 0.001) { const e = sampleAuroraEnergy(p, time, u); if (e.stream > best) { best = e.stream; at = u; } }
    return at;
  };
  for (const p of profiles) {
    const event = createAuroraEnergyEvent(); updateAuroraEnergyEvent(p, p.cycle - p.offset + p.jitter, event);
    const t = event.start + event.travel * 0.3, a = peak(p, t), b = peak(p, t + 1);
    const distance = Math.atan2(Math.sin((b - a) * Math.PI * 2), Math.cos((b - a) * Math.PI * 2)) / (Math.PI * 2);
    assert.equal(Math.sign(distance), event.direction); assert.ok(Math.abs(distance) > 0.04 && Math.abs(distance) < 0.15);
  }
});
test("independent activity stays smooth without a shared field blackout or frame-sized jumps", () => {
  near(auroraEnergyBreath(0), auroraEnergyBreath(43));
  let minimum = Infinity, maximum = 0, maxStep = 0;
  for (let frame = 0; frame < 64 * 60; frame++) {
    const time = frame / 60; let total = 0;
    for (const p of profiles) {
      let localMax = 0;
      for (const u of [0, 0.15, 0.33, 0.5, 0.71, 0.9]) {
        const e = sampleAuroraEnergy(p, time, u), next = sampleAuroraEnergy(p, time + 1.28 / 60, u);
        localMax = Math.max(localMax, e.stream + e.wake);
        maxStep = Math.max(maxStep, Math.abs(e.stream + e.wake - next.stream - next.wake));
      }
      total += localMax;
    }
    minimum = Math.min(minimum, total); maximum = Math.max(maximum, total);
  }
  assert.ok(minimum < maximum && maximum > 0.8); assert.ok(maxStep < 0.04);
});
test("cycle boundaries and long sessions remain continuous with no on/off strobe", () => {
  for (const p of profiles) for (const cycle of [0, 1, 40, 1000]) {
    const t = p.cycle * cycle - p.offset;
    for (const u of [0, 0.3, 0.7, 1]) {
      const a = sampleAuroraEnergy(p, t - 1e-4, u), b = sampleAuroraEnergy(p, t + 1e-4, u);
      near(a.stream, b.stream, 1e-4); near(a.wake, b.wake, 1e-4);
    }
  }
});
test("energy time is FPS independent and survives presets, frozen time and invalid input", () => {
  const initial = AURORA_PRESETS[0].motion, values = [];
  for (const fps of [30, 60, 120]) {
    const clock = createAuroraMotionClock(initial); advanceAuroraMotionClock(clock, 8.3, initial, false);
    for (let f = 1; f <= fps * 10; f++) advanceAuroraMotionClock(clock, 8.3 + f / fps, initial, false);
    values.push(clock.energyTime);
    const before = clock.energyTime;
    advanceAuroraMotionClock(clock, 18.3, AURORA_PRESETS[2].motion, false); near(clock.energyTime, before);
    advanceAuroraMotionClock(clock, 19.3, AURORA_PRESETS[2].motion, true); near(clock.energyTime, before);
    for (const time of [NaN, Infinity]) advanceAuroraMotionClock(clock, time, initial, false);
    near(clock.energyTime, before);
  }
  near(values[0], values[1]); near(values[1], values[2]);
});

test("three independently seeded lanes increase cadence and can overlap in every ribbon", () => {
  for (const seed of seeds) {
    const lanes = auroraEnergyProfiles(seed), events = lanes.map(createAuroraEnergyEvent);
    assert.equal(lanes.length, 3); assert.equal(new Set(lanes.map(p => p.seed)).size, 3);
    let maximum = 0, activeSum = 0, gap = 0, longestGap = 0, starts = 0;
    for (let step = 0; step < 1600; step++) {
      const time = step / 10; let active = 0;
      lanes.forEach((p, i) => {
        const changed = updateAuroraEnergyEvent(p, time, events[i]);
        if (changed && events[i].start >= 0 && events[i].start < 160) starts++;
        const age = (time - events[i].start) / events[i].travel;
        if (age > 0.12 && age < 0.85) active++;
      });
      maximum = Math.max(maximum, active); activeSum += active;
      gap = active ? 0 : gap + 0.1; longestGap = Math.max(longestGap, gap);
    }
    assert.equal(maximum, 3); assert.ok(activeSum / 1600 > 0.85);
    assert.ok(starts >= 18 && longestGap < 12);
    assert.deepEqual(lanes, auroraEnergyProfiles(seed));
  }
});
test("event attributes and start intervals vary by cycle while travel speed stays near its original range", () => {
  for (const seed of seeds) for (const p of auroraEnergyProfiles(seed)) {
    const event = createAuroraEnergyEvent(), values = [];
    for (let i = 0; i < 12; i++) {
      updateAuroraEnergyEvent(p, i * p.cycle - p.offset + p.jitter, event);
      values.push({ ...event });
      assert.ok(event.speed >= p.speed * 0.96 && event.speed <= p.speed * 1.04);
      assert.ok(event.start + event.travel * event.wakeEnd < (i + 1) * p.cycle - p.offset);
    }
    for (const key of ["travel", "length", "speed", "gain", "focus", "wakeLength", "wakeGain", "wakeEnd"]) assert.ok(new Set(values.map(e => e[key])).size > 8);
    assert.equal(new Set(values.map(e => e.direction)).size, 2);
    const intervals = values.slice(1).map((e, i) => e.start - values[i].start);
    assert.ok(new Set(intervals.map(v => v.toFixed(4))).size > 8);
  }
});
test("event storage is reused and stable within a cell rather than randomized on every frame", () => {
  const profile = profiles[0], event = createAuroraEnergyEvent();
  assert.equal(updateAuroraEnergyEvent(profile, 0, event), true);
  const original = { ...event };
  assert.equal(updateAuroraEnergyEvent(profile, 1 / 60, event), false); assert.deepEqual(event, original);
  assert.equal(updateAuroraEnergyEvent(profile, profile.cycle, event), true);
  assert.notDeepEqual(event, original);
});
test("overlapping light uses a bounded soft union, keeps the seam closed and never triples its peak", () => {
  const lanes = auroraEnergyProfiles(seeds[0]); let peak = 0, maxStep = 0;
  for (let frame = 0; frame < 60 * 60; frame++) for (const u of [0, 0.13, 0.33, 0.5, 0.71, 0.9, 1]) {
    const time = frame / 60, e = sampleAuroraEnergyField(lanes, time, u), next = sampleAuroraEnergyField(lanes, time + 1.28 / 60, u);
    assert.ok(e.stream >= 0 && e.stream <= 1 && e.wake >= 0 && e.wake <= 1);
    peak = Math.max(peak, e.stream); maxStep = Math.max(maxStep, Math.abs(e.stream + e.wake - next.stream - next.wake));
    if (u === 0) near(e.stream, sampleAuroraEnergyField(lanes, time, 1).stream);
  }
  assert.ok(peak > 0.5 && maxStep < 0.06);
});
