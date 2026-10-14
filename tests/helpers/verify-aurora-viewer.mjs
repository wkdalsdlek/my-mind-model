// Optional local WebGL check; Playwright and Chromium may be installed outside the repo.
// See docs/cinematic-orbit-viewer-verification.md. No external/API application requests.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.AURORA_PLAYWRIGHT_MODULE || "playwright");
const url = new URL(process.env.AURORA_VIEWER_URL || "http://127.0.0.1:3000/aurora-lab");
assert.ok(["127.0.0.1", "localhost"].includes(url.hostname) && url.pathname === "/aurora-lab");
const output = resolve(process.env.AURORA_BROWSER_OUTPUT || "/tmp/aurora-viewer-visual");
const captureQuality = process.env.AURORA_CAPTURE_QUALITY === "1";
const captureEnergy = process.env.AURORA_CAPTURE_ENERGY === "1";
mkdirSync(output, { recursive: true });
const outcomes = {}, errors = [];
const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
  if (captureQuality || captureEnergy) await page.emulateMedia({ reducedMotion: "reduce" });
  page.setDefaultTimeout(60000);
  page.on("pageerror", e => errors.push(e.message));
  page.on("crash", () => errors.push("Chromium renderer crashed"));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text().slice(0, 400)); });
  await page.route("**/*", route => {
    const request = new URL(route.request().url());
    return request.origin === url.origin && !request.pathname.startsWith("/api/") ? route.continue() : route.abort();
  });
  // Observe actual view matrices for identity-transform star meshes, without shipping a debug API.
  await page.addInitScript(() => {
    window.__auroraViewerProbe = { camera: null, sceneTime: null, energyTime: null };
    const energyBindings = [];
    window.__auroraSetEnergyTime = value => {
      window.__auroraEnergyTimeOverride = value;
      window.__auroraViewerProbe.energyTime = value;
      for (const { gl, program, loc, scalar } of energyBindings) {
        if (!gl.isProgram(program) || gl.isContextLost()) continue;
        const previous = gl.getParameter(gl.CURRENT_PROGRAM);
        gl.useProgram(program); scalar.call(gl, loc, value); gl.useProgram(previous);
      }
    };
    window.__auroraSetEnergyEvents = config => {
      window.__auroraEnergyEventsOverride = config;
      window.__auroraSetEnergyTime(config.time);
    };
    for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
      const source = new WeakMap(), programs = new WeakSet(), energyPrograms = new WeakSet(), locations = new WeakMap();
      const ss = proto.shaderSource, attach = proto.attachShader, getLocation = proto.getUniformLocation, matrix = proto.uniformMatrix4fv, scalar = proto.uniform1f;
      const vectors = proto.uniform4fv, tails = proto.uniform2fv;
      // Phase fixtures are injected at draw time so each ribbon keeps its own events.
      for (const method of ["drawArrays", "drawElements"]) {
        const draw = proto[method];
        proto[method] = function (...args) {
          const config = window.__auroraEnergyEventsOverride;
          if (config) {
            const program = this.getParameter(this.CURRENT_PROGRAM);
            if (energyPrograms.has(program)) {
              const phase = getLocation.call(this, program, "uPhase");
              const fixture = phase && config.byPhase[Math.round(this.getUniform(program, phase) * 1000)];
              if (fixture) {
                vectors.call(this, getLocation.call(this, program, "uEnergyTiming[0]"), fixture.timing);
                vectors.call(this, getLocation.call(this, program, "uEnergyShape[0]"), fixture.shape);
                tails.call(this, getLocation.call(this, program, "uEnergyWake[0]"), fixture.wake);
                scalar.call(this, getLocation.call(this, program, "uEnergyTime"), config.time);
              }
            }
          }
          return draw.apply(this, args);
        };
      }
      proto.shaderSource = function (shader, text) { source.set(shader, text); return ss.call(this, shader, text); };
      proto.attachShader = function (program, shader) {
        if (source.get(shader)?.includes("uSkyCenter") && source.get(shader)?.includes("gl_PointSize")) programs.add(program);
        if (source.get(shader)?.includes("vec3 ribbonEnergy")) energyPrograms.add(program);
        return attach.call(this, program, shader);
      };
      proto.getUniformLocation = function (program, name) {
        const loc = getLocation.call(this, program, name);
        if (loc && (programs.has(program) || (energyPrograms.has(program) && name === "uEnergyTime"))) locations.set(loc, name);
        if (loc && energyPrograms.has(program) && name === "uEnergyTime") energyBindings.push({ gl: this, program, loc, scalar });
        return loc;
      };
      proto.uniformMatrix4fv = function (loc, transpose, a, ...rest) {
        if (locations.get(loc) === "modelViewMatrix") {
          const p = [-(a[0] * a[12] + a[1] * a[13] + a[2] * a[14]), -(a[4] * a[12] + a[5] * a[13] + a[6] * a[14]), -(a[8] * a[12] + a[9] * a[13] + a[10] * a[14])];
          const d = [p[0], p[1] - 0.15, p[2] + 2.4], r = Math.hypot(...d);
          window.__auroraViewerProbe.camera = { position: p, radius: r, theta: Math.atan2(d[0], d[2]), phi: Math.acos(Math.min(1, Math.max(-1, d[1] / r))) };
        }
        return matrix.call(this, loc, transpose, a, ...rest);
      };
      proto.uniform1f = function (loc, value) {
        if (locations.get(loc) === "uTime") window.__auroraViewerProbe.sceneTime = value;
        if (locations.get(loc) === "uEnergyTime") {
          value = window.__auroraEnergyTimeOverride ?? value; window.__auroraViewerProbe.energyTime = value;
        }
        return scalar.call(this, loc, value);
      };
    }
  });
  await page.goto(url.href, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!window.__auroraViewerProbe.camera);
  const read = () => page.evaluate(() => structuredClone(window.__auroraViewerProbe));
  const pause = async () => { await page.emulateMedia({ reducedMotion: "reduce" }); await page.waitForTimeout(1200); };
  const screenshot = async name => {
    await page.getByRole("button", { name: "조작 패널 접기" }).click();
    await page.screenshot({ path: resolve(output, `${name}.png`) });
    await page.getByRole("button", { name: "조작 패널 펼치기" }).click();
  };
  const select = async mode => { await page.locator("#aurora-camera-mode").selectOption(mode); await page.waitForTimeout(500); };
  const drag = async (dx, dy = 0) => { await page.mouse.move(500, 300); await page.mouse.down(); await page.mouse.move(500 + dx, 300 + dy, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(600); };
  if (captureEnergy) {
    const { loadModule } = await import("./load-typescript.mjs");
    const { auroraEnergyProfiles, createAuroraEnergyEvent, updateAuroraEnergyEvent, sampleAuroraEnergyField, auroraEnergyShader } = loadModule("lib/aurora-energy.ts");
    const resolveEvents = (profiles, time) => profiles.map(profile => { const event = createAuroraEnergyEvent(); updateAuroraEnergyEvent(profile, time, event); return event; });
    const pack = events => ({ timing: events.flatMap(e => [e.start, e.travel, e.speed, e.wakeEnd]),
      shape: events.flatMap(e => [e.length, e.focus, e.direction, e.gain]), wake: events.flatMap(e => [e.wakeLength, e.wakeGain]) });
    const { auroraRibbonShapes, auroraLoopShapes } = loadModule("lib/aurora-geometry.ts");
    const { AURORA_PRESETS } = loadModule("lib/aurora-presets.ts");
    const shapes = [...auroraRibbonShapes(AURORA_PRESETS[0]), ...auroraLoopShapes(AURORA_PRESETS[0])];
    const fixture = time => ({ time, byPhase: Object.fromEntries(shapes.map(shape => [Math.round(shape.phase * 1000), pack(resolveEvents(auroraEnergyProfiles(shape.energySeed), time))])) });
    const lanes = auroraEnergyProfiles(shapes[0].energySeed);
    let overlap = 0;
    for (let step = 0; step < 1600; step++) {
      const time = step / 10;
      if (resolveEvents(lanes, time).every(e => (time - e.start) / e.travel > 0.12 && (time - e.start) / e.travel < 0.85)) { overlap = time; break; }
    }
    assert.ok(overlap > 0); outcomes.overlapPhase = overlap;
    const samples = [43217, 44194, 45171, 78437].flatMap(seed => {
      const profiles = auroraEnergyProfiles(seed);
      return [0, 8.3, 23, 25, 30, 32, 120, 3600].flatMap(time => [0, 0.13, 0.5, 0.99, 1].map(u => ({ ...pack(resolveEvents(profiles, time)), time, u, expected: sampleAuroraEnergyField(profiles, time, u) })));
    });
    outcomes.energyGPU = await page.evaluate(({ shader, samples }) => {
      const canvas = document.createElement("canvas"); canvas.width = 1; canvas.height = 1;
      const gl = canvas.getContext("webgl2");
      const compile = (type, source) => { const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
      const v = compile(gl.VERTEX_SHADER, "#version 300 es\nvoid main(){gl_Position=vec4(gl_VertexID==1?3.0:-1.0,gl_VertexID==2?3.0:-1.0,0.0,1.0);}");
      const f = compile(gl.FRAGMENT_SHADER, `#version 300 es\nprecision highp float;\n${shader}\nuniform float uSample;out vec4 result;void main(){result=vec4(ribbonEnergy(uSample),1.0);}`);
      const p = gl.createProgram(); gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      gl.useProgram(p); gl.viewport(0, 0, 1, 1);
      const timing = gl.getUniformLocation(p, "uEnergyTiming[0]"), shape = gl.getUniformLocation(p, "uEnergyShape[0]"), tail = gl.getUniformLocation(p, "uEnergyWake[0]"), time = gl.getUniformLocation(p, "uEnergyTime"), u = gl.getUniformLocation(p, "uSample");
      const bytes = new Uint8Array(4); let maxError = 0;
      for (const sample of samples) {
        // Bypass the scene-only time override for this independent shader probe.
        gl.uniform4fv(timing, sample.timing); gl.uniform4fv(shape, sample.shape); gl.uniform2fv(tail, sample.wake);
        window.__auroraEnergyTimeOverride = undefined;
        gl.uniform1f(time, sample.time); gl.uniform1f(u, sample.u); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
        ["stream", "wake", "breath"].forEach((key, i) => { maxError = Math.max(maxError, Math.abs(bytes[i] / 255 - sample.expected[key])); });
      }
      const error = gl.getError(); gl.deleteProgram(p); gl.deleteShader(v); gl.deleteShader(f); gl.getExtension("WEBGL_lose_context")?.loseContext();
      return { samples: samples.length, maxError, error };
    }, { shader: auroraEnergyShader, samples });
    assert.equal(outcomes.energyGPU.error, 0); assert.ok(outcomes.energyGPU.maxError < 0.008);
    await page.locator("#aurora-quality").selectOption("balanced");
    for (const [name, phase] of [["layered-a", 8.3], ["layered-b", 10.3], ["overlap", overlap], ["trail", overlap + 3]]) {
      await page.evaluate(config => window.__auroraSetEnergyEvents(config), fixture(phase));
      await page.locator("#aurora-camera-front").click(); await page.waitForTimeout(800);
      await screenshot(`energy-${name}`);
    }
    outcomes.energyPhases = [8.3, 10.3, overlap, overlap + 3];
    // Keep a fully overlapping event fixture through the following quality captures.
    await page.evaluate(config => window.__auroraSetEnergyEvents(config), fixture(overlap));
    outcomes.sceneGLError = await page.locator("canvas").evaluate(c => c.getContext("webgl2").getError());
    assert.equal(outcomes.sceneGLError, 0); assert.equal(errors.length, 0);
    writeFileSync(resolve(output, "energy-results.json"), JSON.stringify({ outcomes, errors }, null, 2));
    console.log(JSON.stringify(outcomes, null, 2));
  }
  if (captureQuality) {
    // Freeze the same scene phase for before/after comparisons at each selected tier.
    const height = (await page.locator("canvas").boundingBox()).height;
    for (const quality of ["low", "balanced", "high"]) {
      await page.locator("#aurora-quality").selectOption(quality);
      await page.locator("#aurora-camera-front").click();
      await page.waitForFunction(() => Math.abs(window.__auroraViewerProbe.camera.theta) < 0.003);
      await page.waitForTimeout(1000); await screenshot(`${quality}-front`);
      await select("free");
      await drag(-height * 0.25 / 0.38);
      await page.waitForFunction(() => Math.abs(Math.abs(window.__auroraViewerProbe.camera.theta) - Math.PI / 2) < 0.01);
      await screenshot(`${quality}-side`);
      await drag(-height * 0.25 / 0.38);
      await page.waitForFunction(() => Math.abs(Math.abs(window.__auroraViewerProbe.camera.theta) - Math.PI) < 0.01);
      await screenshot(`${quality}-rear`);
      outcomes[quality] = { rear: (await read()).camera, sceneTime: (await read()).sceneTime, energyTime: (await read()).energyTime,
        diagnostics: await page.locator("[aria-live='polite']").allTextContents() };
      outcomes[quality].glError = await page.locator("canvas").evaluate(c => c.getContext("webgl2").getError());
      assert.equal(outcomes[quality].glError, 0);
      assert.equal(outcomes[quality].sceneTime, 8.3);
      assert.equal(await page.locator("#aurora-quality").inputValue(), quality);
      console.log(`${quality}: front/side/rear captured`);
    }
    assert.equal(errors.length, 0);
    writeFileSync(resolve(output, "quality-results.json"), JSON.stringify({ outcomes, errors }, null, 2));
  } else if (!captureEnergy) {
  const clockStart = (await read()).sceneTime;
  const energyStart = (await read()).energyTime;
  assert.equal(await page.locator("#aurora-camera-mode").inputValue(), "front");
  outcomes.defaultQuality = await page.locator("#aurora-quality").inputValue();
  const front = (await read()).camera; await page.waitForTimeout(1000);
  assert.ok(Math.abs(angleDiff(front.theta, (await read()).camera.theta)) < 0.001);
  outcomes.defaultFront = front; console.log("Front View ready");
  await page.locator("#aurora-quality").selectOption("low"); await pause(); await screenshot("front");
  await select("free");
  const height = (await page.locator("canvas").boundingBox()).height;
  await drag(-height * 0.25 / 0.38); const side = (await read()).camera;
  assert.ok(Math.abs(Math.abs(side.theta) - Math.PI / 2) < 0.05); outcomes.side = side; await screenshot("side");
  await drag(-height * 0.25 / 0.38); const rear = (await read()).camera;
  assert.ok(Math.abs(Math.abs(rear.theta) - Math.PI) < 0.06); outcomes.rear = rear; await screenshot("rear");
  await drag(-height * 0.125 / 0.38, -height * 0.04 / 0.38);
  outcomes.diagonal = (await read()).camera; await screenshot("diagonal");
  await drag(height * 0.125 / 0.38, height * 0.04 / 0.38);
  await drag(-height * 0.25 / 0.38); await drag(-height * 0.25 / 0.38);
  assert.ok(Math.abs((await read()).camera.theta) < 0.08); outcomes.fullCircle = true;
  console.log("Free Orbit side/rear/360 verified");
  await drag(0, 300); const polar = (await read()).camera.phi;
  assert.ok(Math.min(Math.abs(polar - Math.PI / 6), Math.abs(polar - Math.PI * 5 / 6)) < 0.05); outcomes.polar = polar;
  await page.evaluate(() => { const c = document.querySelector("canvas"); for (let i = 0; i < 30; i++) c.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true })); });
  await page.waitForTimeout(600); outcomes.minZoom = (await read()).camera.radius; assert.ok(Math.abs(outcomes.minZoom - 15.5) < 0.1);
  await page.evaluate(() => { const c = document.querySelector("canvas"); for (let i = 0; i < 80; i++) c.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, bubbles: true, cancelable: true })); });
  await page.waitForTimeout(600); outcomes.maxZoom = (await read()).camera.radius; assert.ok(outcomes.maxZoom > 30 && outcomes.maxZoom < 70);
  const before = (await read()).camera; await page.locator("#aurora-motion").selectOption("dynamic"); await page.waitForTimeout(600);
  const after = (await read()).camera; assert.ok(Math.abs(angleDiff(before.theta, after.theta)) < 0.001 && Math.abs(before.radius - after.radius) < 0.001); outcomes.panelIsolated = true;
  await drag(-height * 0.25 / 0.38); await drag(-height * 0.25 / 0.38);
  await page.locator("#aurora-camera-front").click();
  await page.waitForFunction(goal => {
    const c = window.__auroraViewerProbe.camera;
    return Math.abs(c.theta) < 0.003 && Math.abs(c.phi - Math.PI / 2) < 0.02 && Math.abs(c.radius - goal) < 0.01;
  }, front.radius);
  outcomes.returnFront = (await read()).camera; console.log("Zoom/limits/panel/front return verified");
  await page.emulateMedia({ reducedMotion: "no-preference" }); await select("auto"); const start = (await read()).camera;
  await page.waitForTimeout(3500); const auto = (await read()).camera; assert.ok(angleDiff(auto.theta, start.theta) > 0.015); outcomes.autoMoved = angleDiff(auto.theta, start.theta);
  await drag(-70); assert.equal(await page.locator("#aurora-camera-mode").inputValue(), "free"); await page.waitForTimeout(3000);
  const stopped = (await read()).camera; await page.waitForTimeout(1200);
  assert.ok(Math.abs(angleDiff(stopped.theta, (await read()).camera.theta)) < 0.01); outcomes.autoPauseHeld = true;
  await select("auto"); const resumed = (await read()).camera; assert.ok(Math.abs(angleDiff(resumed.theta, stopped.theta)) < 0.015); outcomes.resumeNoTeleport = true;
  await pause(); assert.equal(await page.locator("#aurora-camera-mode").inputValue(), "front"); assert.equal(await page.locator("#aurora-camera-mode option[value='auto']").isDisabled(), true);
  await page.waitForFunction(goal => {
    const c = window.__auroraViewerProbe.camera;
    return Math.abs(c.theta) < 0.003 && Math.abs(c.phi - Math.PI / 2) < 0.02 && Math.abs(c.radius - goal) < 0.01;
  }, front.radius);
  await page.emulateMedia({ reducedMotion: "no-preference" }); assert.equal(await page.locator("#aurora-camera-mode").inputValue(), "front"); outcomes.reducedNoResume = true;
  console.log("Auto interruption/resume/reduced-motion verified");
  await pause(); await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => window.__auroraViewerProbe.camera.radius > 44); await page.waitForTimeout(1200);
  outcomes.mobileFront = (await read()).camera; await screenshot("mobile-front");
  assert.equal(await page.locator("#aurora-quality").inputValue(), "low");
  assert.ok((await page.locator("[aria-live='polite']").allTextContents()).some(text => text.includes("입자 700")));
  await select("free"); const session = await page.context().newCDPSession(page); await session.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 2 });
  const touchStart = (await read()).camera;
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 110, y: 400, id: 1 }, { x: 270, y: 400, id: 2 }] });
  await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 75, y: 400, id: 1 }, { x: 305, y: 400, id: 2 }] });
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await page.waitForTimeout(800);
  outcomes.pinchRadius = (await read()).camera.radius; assert.ok(outcomes.pinchRadius < touchStart.radius);
  outcomes.sceneClockPreserved = (await read()).sceneTime >= clockStart; assert.ok(outcomes.sceneClockPreserved);
  outcomes.energyClockPreserved = (await read()).energyTime > energyStart; assert.ok(outcomes.energyClockPreserved);
  outcomes.renderer = await page.locator("canvas").evaluate(c => { const gl = c.getContext("webgl2"), d = gl.getExtension("WEBGL_debug_renderer_info"); return { error: gl.getError(), name: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : "unknown" }; });
  assert.equal(outcomes.renderer.error, 0); assert.equal(errors.length, 0);
  writeFileSync(resolve(output, "results.json"), JSON.stringify({ outcomes, errors }, null, 2)); console.log(JSON.stringify(outcomes, null, 2));
  }
} catch (error) {
  writeFileSync(resolve(output, "results-partial.json"), JSON.stringify({ outcomes, errors, error: error.message }, null, 2));
  console.error(error.message); process.exitCode = 1;
} finally { await browser?.close(); }
