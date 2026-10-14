import assert from "node:assert/strict";
import test from "node:test";
import { Euler, PerspectiveCamera, Vector3 } from "three";
import { OrbitControls } from "three-stdlib";
import { loadModule } from "./helpers/load-typescript.mjs";

const { AURORA_CAMERA_TARGET, AURORA_CAMERA_ENVELOPE, AURORA_CAMERA_POLAR_LIMITS, auroraCameraEnvelope, auroraCameraOptions, auroraCameraFraming,
  resolveAuroraCameraMode, readAuroraCameraOrbit, writeAuroraCameraPosition, createAuroraCameraState, requestAuroraCameraMode,
  interruptAuroraAutoOrbit, advanceAuroraCamera } = loadModule("lib/aurora-camera.ts");
const { auroraQualityBudget } = loadModule("lib/aurora-types.ts");
const { AURORA_PRESETS } = loadModule("lib/aurora-presets.ts");
const { auroraRibbonShapes, auroraCurtainMistShape, auroraLoopShapes, auroraLoopMistShape, createAuroraRibbonData, updateAuroraFieldPose, updateAuroraRibbonPose } = loadModule("lib/aurora-geometry.ts");
const frame = auroraCameraFraming(1440, 960), options = auroraCameraOptions();
const near = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) < epsilon, `${a} vs ${b}`);
const corners = [];
for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) corners.push(AURORA_CAMERA_TARGET.map((v, i) => v + [x, y, z][i] * AURORA_CAMERA_ENVELOPE[i]));

test("front is the default and reduced motion cannot request an automatic orbit", () => {
  assert.equal(createAuroraCameraState().mode, "front");
  for (const mode of ["front", "free", "auto"]) assert.equal(resolveAuroraCameraMode(mode, false), mode);
  assert.equal(resolveAuroraCameraMode("auto", true), "front");
  assert.equal(resolveAuroraCameraMode("free", true), "free");
  assert.equal(resolveAuroraCameraMode("invalid", false), "front");
});
test("cinematic defaults and custom values are bounded to calm speeds and returns", () => {
  assert.deepEqual(options, { autoOrbitSeconds: 120, returnSeconds: 1.2 });
  assert.deepEqual(auroraCameraOptions({ autoOrbitSeconds: 1, returnSeconds: 0 }), { autoOrbitSeconds: 90, returnSeconds: 0.8 });
  assert.deepEqual(auroraCameraOptions({ autoOrbitSeconds: 900, returnSeconds: 5 }), { autoOrbitSeconds: 150, returnSeconds: 1.5 });
  assert.deepEqual(auroraCameraOptions({ autoOrbitSeconds: NaN, returnSeconds: Infinity }), options);
});
test("front and full horizontal auto paths frame the primary envelope in portrait and landscape", () => {
  for (const [width, height] of [[1440, 960], [1920, 1080], [390, 844], [844, 390], [768, 1024], [400, 1600]]) {
    const framing = auroraCameraFraming(width, height), camera = new PerspectiveCamera(framing.fov, width / height, 0.1, 400);
    for (let angle = 0; angle < 96; angle++) {
      const position = [0, 0, 0];
      writeAuroraCameraPosition({ theta: angle * Math.PI / 48, phi: Math.PI / 2, radius: framing.autoDistance }, position);
      camera.position.set(...position); camera.lookAt(...AURORA_CAMERA_TARGET); camera.updateMatrixWorld();
      for (const point of corners) {
        const ndc = new Vector3(...point).project(camera);
        assert.ok(Math.abs(ndc.x) < 1 && Math.abs(ndc.y) < 1 && ndc.z > -1 && ndc.z < 1);
      }
    }
    const front = [0, 0, 0];
    writeAuroraCameraPosition({ theta: 0, phi: Math.acos(0.25 / framing.frontDistance), radius: framing.frontDistance }, front);
    camera.position.set(...front); camera.lookAt(...AURORA_CAMERA_TARGET); camera.updateMatrixWorld();
    assert.ok(corners.every(point => { const p = new Vector3(...point).project(camera); return Math.abs(p.x) < 1 && Math.abs(p.y) < 1; }));
  }
});
test("portrait fitting changes camera distance and field of view without lowering fidelity", () => {
  const portrait = auroraCameraFraming(390, 844), landscape = auroraCameraFraming(1440, 960);
  assert.ok(portrait.frontDistance > landscape.frontDistance);
  assert.ok(portrait.fov >= landscape.fov && portrait.fov <= 53);
  for (const quality of ["low", "balanced", "high"]) assert.deepEqual(auroraQualityBudget(quality, true), auroraQualityBudget(quality, false));
});
test("camera distance limits keep the observer outside the primary safe envelope", () => {
  for (const [w, h] of [[1440, 960], [390, 844]]) {
    const f = auroraCameraFraming(w, h);
    assert.ok(f.minDistance > Math.hypot(...AURORA_CAMERA_ENVELOPE));
    assert.ok(f.maxDistance > f.autoDistance && f.maxDistance / f.autoDistance < 1.8);
  }
  assert.ok(Object.values(auroraCameraFraming(0, NaN)).every(Number.isFinite));
});
test("spherical position conversion preserves arbitrary front, side and rear poses in owned storage", () => {
  const position = [0, 0, 0], orbit = { theta: 0, phi: 0, radius: 0 };
  for (const theta of [0, 0.6, Math.PI / 2, Math.PI, -2.9]) for (const phi of [Math.PI / 6, Math.PI / 2, Math.PI * 5 / 6]) {
    const source = { theta, phi, radius: 25 }, original = structuredClone(source);
    writeAuroraCameraPosition(source, position); readAuroraCameraOrbit(position, orbit);
    near(orbit.theta, theta); near(orbit.phi, phi); near(orbit.radius, 25);
    assert.deepEqual(source, original);
  }
});
test("front return takes the shortest spherical path and stays outside the ribbons", () => {
  const state = createAuroraCameraState();
  Object.assign(state.orbit, { theta: 3.5, phi: Math.PI / 3, radius: frame.minDistance });
  const start = structuredClone(state.orbit); requestAuroraCameraMode(state, "front", false);
  assert.deepEqual(state.orbit, start); assert.ok(Math.abs(state.thetaTravel) <= Math.PI);
  let previous = start.theta;
  for (let i = 0; i < 72; i++) {
    advanceAuroraCamera(state, 1 / 60, frame, options, false, true);
    assert.ok(state.orbit.radius >= frame.minDistance);
    // Compare angles modulo 2pi: the final normalization is the same orientation.
    const difference = Math.atan2(Math.sin(state.orbit.theta - previous), Math.cos(state.orbit.theta - previous));
    assert.ok(difference >= -1e-8 && difference < 0.13); previous = state.orbit.theta;
  }
  near(state.orbit.theta, 0); near(state.orbit.radius, frame.frontDistance);
  assert.equal(state.returning, false);
});
test("return slows smoothly over 1.2 seconds", () => {
  const state = createAuroraCameraState();
  state.orbit.theta = -2; requestAuroraCameraMode(state, "front", false);
  const deltas = [];
  for (let i = 0; i < 12; i++) { const before = state.orbit.theta; advanceAuroraCamera(state, 0.1, frame, options, false, true); deltas.push(state.orbit.theta - before); }
  assert.ok(deltas[0] > deltas[5] && deltas[5] > deltas[11]);
  near(state.orbit.theta, 0); near(state.elapsed, 1.2);
});
test("automatic motion starts from the current direction with a gentle velocity and radius ramp", () => {
  const state = createAuroraCameraState(); Object.assign(state.orbit, { theta: 2.7, phi: 1.2, radius: 16 });
  const before = structuredClone(state.orbit); requestAuroraCameraMode(state, "auto", false);
  assert.deepEqual(state.orbit, before);
  advanceAuroraCamera(state, 1 / 60, frame, options, false, true);
  assert.ok(state.orbit.theta - before.theta > 0 && state.orbit.theta - before.theta < 0.002);
  assert.ok(Math.abs(state.orbit.radius - before.radius) < 0.5 && Math.abs(state.orbit.phi - before.phi) < 0.02);
});
test("auto velocity is frame-rate independent and takes 120 seconds per settled revolution", () => {
  const results = [];
  for (const fps of [30, 60, 120]) {
    const state = createAuroraCameraState(); requestAuroraCameraMode(state, "auto", false);
    for (let i = 0; i < fps * 2; i++) advanceAuroraCamera(state, 1 / fps, frame, options, false, true);
    const start = state.orbit.theta;
    for (let i = 0; i < fps * 120; i++) advanceAuroraCamera(state, 1 / fps, frame, options, false, true);
    near(state.orbit.theta - start, Math.PI * 2, 0.0001);
    results.push(state.orbit.theta);
  }
  assert.ok(Math.max(...results) - Math.min(...results) < 1e-9);
});
test("manual interruption holds its direction until an explicit auto request resumes it", () => {
  const state = createAuroraCameraState(); requestAuroraCameraMode(state, "auto", false);
  advanceAuroraCamera(state, 0.1, frame, options, false, true);
  assert.equal(interruptAuroraAutoOrbit(state), true); assert.equal(interruptAuroraAutoOrbit(state), false);
  state.orbit.theta = -1.7; const before = structuredClone(state.orbit);
  for (let i = 0; i < 200; i++) assert.equal(advanceAuroraCamera(state, 0.1, frame, options, false, true), false);
  assert.deepEqual(state.orbit, before);
  requestAuroraCameraMode(state, "auto", false); assert.deepEqual(state.orbit, before);
  advanceAuroraCamera(state, 1 / 60, frame, options, false, true); assert.ok(Math.abs(state.orbit.theta + 1.7) < 0.002);
});
test("reduced motion and hidden tabs stop auto without forcing a teleport or future restart", () => {
  const state = createAuroraCameraState(); state.orbit.theta = 2; requestAuroraCameraMode(state, "auto", true);
  near(state.orbit.theta, 2); assert.equal(state.mode, "front");
  advanceAuroraCamera(state, 0.1, frame, options, true, true); assert.ok(state.orbit.theta > 0 && state.orbit.theta < 2);
  for (let i = 0; i < 20; i++) advanceAuroraCamera(state, 0.1, frame, options, true, true);
  const stopped = structuredClone(state.orbit); advanceAuroraCamera(state, 0.1, frame, options, false, true); assert.deepEqual(state.orbit, stopped);
  requestAuroraCameraMode(state, "auto", false); const before = structuredClone(state.orbit);
  advanceAuroraCamera(state, 120, frame, options, false, false); assert.deepEqual(state.orbit, before);
  state.returning = false; state.mode = "auto";
  assert.equal(advanceAuroraCamera(state, 0.1, frame, options, true, true), false);
});
test("long gaps and invalid deltas cannot jump the automatic camera", () => {
  const state = createAuroraCameraState(); requestAuroraCameraMode(state, "auto", false);
  for (const delta of [0, -1, NaN, Infinity]) { const old = structuredClone(state); advanceAuroraCamera(state, delta, frame, options, false, true); assert.deepEqual(state, old); }
  const theta = state.orbit.theta; advanceAuroraCamera(state, 300, frame, options, false, true);
  assert.ok(state.orbit.theta - theta < Math.PI / 90);
});
test("real OrbitControls support 360-degree azimuth, polar caps and bounded wheel zoom without pan", () => {
  const camera = new PerspectiveCamera(43, 1.5, 0.1, 400); camera.position.set(0, 0.4, 20);
  const controls = new OrbitControls(camera); controls.target.set(...AURORA_CAMERA_TARGET);
  controls.enableDamping = false; controls.enablePan = false;
  controls.minAzimuthAngle = -Infinity; controls.maxAzimuthAngle = Infinity;
  [controls.minPolarAngle, controls.maxPolarAngle] = AURORA_CAMERA_POLAR_LIMITS;
  controls.minDistance = frame.minDistance; controls.maxDistance = frame.maxDistance; controls.update();
  const center = controls.target.clone();
  for (const angle of [-Math.PI, -Math.PI / 2, 0, Math.PI / 2, Math.PI]) { controls.setAzimuthalAngle(angle); near(Math.cos(controls.getAzimuthalAngle()), Math.cos(angle)); }
  controls.setPolarAngle(0); near(controls.getPolarAngle(), controls.minPolarAngle);
  controls.setPolarAngle(Math.PI); near(controls.getPolarAngle(), controls.maxPolarAngle);
  for (let i = 0; i < 100; i++) controls.dollyIn(); near(controls.getDistance(), frame.minDistance);
  for (let i = 0; i < 200; i++) controls.dollyOut(); near(controls.getDistance(), frame.maxDistance);
  assert.ok(controls.target.equals(center)); controls.dispose();
});

test("static framing envelopes contain sampled transformed ribbons, loops and mist with deformation padding", () => {
  for (const count of [2, 3, 4]) for (const preset of AURORA_PRESETS) {
    const appearance = { ...preset, ribbonCount: count }, loops = auroraLoopShapes(appearance);
    const curtains = auroraRibbonShapes(appearance);
    const shapes = [...curtains, ...curtains.map(auroraCurtainMistShape), ...loops, ...loops.flatMap(s => [auroraLoopMistShape(s, 0), auroraLoopMistShape(s, 1)])];
    const envelope = auroraCameraEnvelope(count), motion = { ...preset.motion, intensity: 1.35 };
    for (const shape of shapes) {
      const data = createAuroraRibbonData(shape, 40, 6);
      for (const time of [0, 10, 30, 60, 100, 180]) {
        const field = { position: [0, 0, 0], rotation: [0, 0, 0] }, local = { position: [0, 0, 0], rotation: [0, 0, 0] };
        updateAuroraFieldPose(motion, time, field); updateAuroraRibbonPose(shape, motion, time, local);
        const a = new Euler(...local.rotation), b = new Euler(...field.rotation), p = new Vector3(), lp = new Vector3(...local.position), fp = new Vector3(...field.position);
        for (let i = 0; i < data.positions.length; i += 3) {
          p.fromArray(data.positions, i).applyEuler(a).add(lp).applyEuler(b).add(fp);
          for (let axis = 0; axis < 3; axis++) assert.ok(Math.abs(p.getComponent(axis) - AURORA_CAMERA_TARGET[axis]) + 0.9 < envelope[axis]);
        }
      }
    }
  }
});
