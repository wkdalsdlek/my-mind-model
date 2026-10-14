// Optional actual-browser integration check. All application API calls are mocked/blocked.
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.AURORA_PLAYWRIGHT_MODULE || "playwright");
const url = new URL(process.env.AURORA_RESULT_URL || "http://127.0.0.1:3000/");
assert.ok(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/");
const output = resolve(process.env.AURORA_RESULT_OUTPUT || "/tmp/aurora-result-visual");
mkdirSync(output, { recursive: true });
// Use the existing local login only; never log/write its value or change authentication.
const password = readFileSync(new URL("../../app/page.tsx", import.meta.url), "utf8").match(/const SECRET_PASSWORD = "([^"]+)"/)?.[1];
assert.ok(password, "Existing local login must be available");
const fixtures = { title: "LEGACY TITLE 날씨: SHOULD NOT APPEAR", colors: ["#FFFFFF", "#FFFFFF", "#FFFFFF"], speed: 8, distort: 1.2, scale: 1.2,
  comments: Array.from({ length: 10 }, (_, i) => ({ analysis: `테스트 요약 ${i + 1}`, detailedAnalysis: `테스트 상세 ${i + 1}`, effect: "LEGACY EFFECT SHOULD NOT APPEAR" })) };
const report = {}, errors = [];
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: 1, reducedMotion: "reduce" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  page.setDefaultTimeout(60000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error" && !message.text().includes("503")) errors.push(message.text()); });
  page.on("crash", () => errors.push("Browser renderer crashed"));
  let analyzeCount = 0, failOnce = true, lastAnswerCount = 0;
  await page.route("**/*", async route => {
    const request = new URL(route.request().url());
    if (request.origin !== url.origin) return route.abort();
    if (request.pathname === "/api/analyze") {
      analyzeCount++;
      const body = route.request().postDataJSON();
      assert.deepEqual(Object.keys(body).sort(), ["answers", "questions"]);
      lastAnswerCount = body.answers.length;
      // Delay makes the real loading state and duplicate-click lock observable.
      await new Promise(resolve => setTimeout(resolve, 350));
      if (failOnce) { failOnce = false; return route.fulfill({ status: 503, json: { code: "AI_NOT_CONFIGURED" } }); }
      return route.fulfill({ status: 200, json: fixtures });
    }
    if (request.pathname.startsWith("/api/")) return route.abort();
    return route.continue();
  });
  await page.addInitScript(() => {
    window.__resultProbe = { draws: 0, errors: [], colors: [], theta: null };
    for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
      const sources = new WeakMap(), sky = new WeakSet(), uniforms = new WeakMap();
      const shaderSource = proto.shaderSource, attach = proto.attachShader, location = proto.getUniformLocation, matrix = proto.uniformMatrix4fv, color = proto.uniform3f;
      proto.shaderSource = function (shader, text) { sources.set(shader, text); return shaderSource.call(this, shader, text); };
      proto.attachShader = function (program, shader) {
        const text = sources.get(shader);
        if (text?.includes("uSkyCenter") && text.includes("gl_PointSize")) sky.add(program);
        return attach.call(this, program, shader);
      };
      proto.getUniformLocation = function (program, name) {
        const result = location.call(this, program, name);
        if (result && (name === "uColorA" || (sky.has(program) && name === "modelViewMatrix"))) uniforms.set(result, name);
        return result;
      };
      proto.uniform3f = function (loc, a, b, c) {
        if (uniforms.get(loc) === "uColorA") {
          const values = [a, b, c].map(v => Math.round(v * 10000) / 10000);
          if (!window.__resultProbe.colors.some(value => JSON.stringify(value) === JSON.stringify(values))) window.__resultProbe.colors.push(values);
        }
        return color.call(this, loc, a, b, c);
      };
      proto.uniformMatrix4fv = function (loc, transpose, a, ...rest) {
        if (uniforms.get(loc) === "modelViewMatrix") {
          const x = -(a[0] * a[12] + a[1] * a[13] + a[2] * a[14]);
          const z = -(a[8] * a[12] + a[9] * a[13] + a[10] * a[14]);
          window.__resultProbe.theta = Math.atan2(x, z + 2.4);
        }
        return matrix.call(this, loc, transpose, a, ...rest);
      };
      for (const method of ["drawArrays", "drawElements"]) {
        const original = proto[method];
        proto[method] = function (...args) {
          const result = original.apply(this, args);
          window.__resultProbe.draws++;
          const error = this.getError();
          if (error) window.__resultProbe.errors.push(error);
          return result;
        };
      }
    }
  });
  await page.goto(url.href, { waitUntil: "networkidle" });
  await page.waitForFunction(() => {
    const input = document.querySelector('input[type="password"]');
    return input && Object.keys(input).some(key => key.startsWith("__reactProps$"));
  });
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "입장하기", exact: true }).click();
  await page.locator("#question-title").waitFor();
  console.log("Local login and question screen ready");
  async function answerFlow(text, firstKeyword = null) {
    if (firstKeyword) {
      await page.getByRole("button", { name: `${firstKeyword} 캡슐 추가`, exact: true }).click({ force: true });
      await page.getByRole("button", { name: "다음 질문 →", exact: true }).click();
    } else await page.getByRole("button", { name: "건너뛰기", exact: true }).click();
    for (let i = 1; i < 9; i++) await page.getByRole("button", { name: "건너뛰기", exact: true }).click();
    await page.locator("#closing-message").fill(text);
    assert.equal(await page.getByRole("button", { name: "오로라 만나기 ✦", exact: true }).isDisabled(), true);
    await page.getByRole("button", { name: "AI 없이 내 문장으로 결정하기", exact: true }).click();
  }
  const approved = "내 속도로\n천천히 빛나는 오늘";
  await answerFlow(approved, "목표를 이뤘을 때");
  let dialogCount = 0;
  page.on("dialog", async dialog => { dialogCount++; await dialog.accept(); });
  await page.getByRole("button", { name: "오로라 만나기 ✦", exact: true }).click();
  await page.getByRole("button", { name: "오로라를 읽는 중…", exact: true }).waitFor();
  await page.getByRole("button", { name: "오로라 만나기 ✦", exact: true }).waitFor();
  assert.equal(dialogCount, 1);
  assert.equal(await page.locator("#closing-message").inputValue(), approved);
  assert.ok((await page.getByRole("status").allTextContents()).some(value => value.includes("이 문장으로 결정했어요")));
  report.failurePreservesApprovalAndInput = true;
  console.log("Mocked API failure preserved approval and input");
  await page.getByRole("button", { name: "오로라 만나기 ✦", exact: true }).click();
  await page.locator("#aurora-result-title").waitFor();
  assert.equal(await page.locator("#aurora-result-title").textContent(), approved);
  assert.equal(analyzeCount, 2); assert.equal(lastAnswerCount, 10);
  await page.waitForFunction(() => window.__resultProbe.draws > 0);
  await page.locator("canvas").evaluate(node => { node.dataset.sessionIdentity = "same-canvas"; });
  for (const [button, expected] of [["요약 분석", "테스트 요약 1"], ["심층 분석", "테스트 상세 1"]]) {
    await page.getByRole("button", { name: button, exact: true }).click();
    assert.ok((await page.locator("#result-analysis").textContent()).includes(expected));
    assert.equal(await page.locator("canvas").getAttribute("data-session-identity"), "same-canvas");
  }
  const text = await page.locator("main").textContent();
  assert.equal(text.includes("LEGACY"), false);
  await page.getByRole("button", { name: "분석 패널 닫기", exact: true }).click();
  report.titleAndAnalysisPanels = true;
  console.log("Approved title, real WebGL and analysis panels verified");
  for (const quality of ["low", "balanced", "high"]) {
    const before = await page.evaluate(() => window.__resultProbe.draws);
    await page.locator("#result-quality").selectOption(quality);
    await page.waitForFunction(previous => window.__resultProbe.draws > previous, before);
    await page.screenshot({ path: resolve(output, `desktop-${quality}.png`) });
    assert.equal(await page.locator("canvas").getAttribute("data-session-identity"), "same-canvas");
  }
  report.selectedQualityAndStableCanvas = true;
  console.log("Desktop quality tiers and Canvas identity verified");
  assert.equal(await page.locator('#result-camera-mode option[value="auto"]').evaluate(option => option.disabled), true);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.locator("#result-quality").selectOption("low");
  await page.locator("#result-camera-mode").selectOption("free");
  const canvas = await page.locator("canvas").boundingBox();
  const beforeDrag = await page.evaluate(() => window.__resultProbe.theta);
  await page.mouse.move(canvas.x + canvas.width * .55, canvas.y + canvas.height * .55);
  await page.mouse.down(); await page.mouse.move(canvas.x + canvas.width * .80, canvas.y + canvas.height * .55, { steps: 8 }); await page.mouse.up();
  await page.waitForFunction(previous => Math.abs(window.__resultProbe.theta - previous) > .05, beforeDrag);
  await page.getByRole("button", { name: "정면으로 돌아오기", exact: true }).click();
  await page.waitForFunction(() => Math.abs(window.__resultProbe.theta) < .02);
  await page.locator("#result-camera-mode").selectOption("auto");
  const beforeAuto = await page.evaluate(() => window.__resultProbe.theta);
  await page.waitForFunction(previous => Math.abs(window.__resultProbe.theta - previous) > .025, beforeAuto);
  await page.mouse.move(canvas.x + canvas.width * .5, canvas.y + canvas.height * .5); await page.mouse.down(); await page.mouse.up();
  await page.waitForFunction(() => document.querySelector("#result-camera-mode").value === "free");
  await page.emulateMedia({ reducedMotion: "reduce" });
  report.cameraModesAndReducedMotion = true;
  console.log("Camera interaction, auto orbit and reduced motion verified");
  const firstColors = await page.evaluate(() => window.__resultProbe.colors);
  await page.getByRole("button", { name: "다시 성찰하기", exact: true }).click();
  await page.locator("#question-title").waitFor();
  assert.equal(await page.locator("#aurora-result-title").count(), 0);
  assert.equal(await page.getByRole("button", { name: "목표를 이뤘을 때 캡슐 제거", exact: true }).count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { window.__resultProbe.colors = []; });
  const longTitle = "빛의 흐름을 따라\n" + "내가 직접 남긴 긴 문장 ".repeat(45);
  await answerFlow(longTitle, "무언가를 창작할 때");
  // Approval invalidates immediately when the authored input changes.
  await page.locator("#closing-message").fill(longTitle + "변경");
  assert.equal(await page.getByRole("button", { name: "오로라 만나기 ✦", exact: true }).isDisabled(), true);
  await page.getByRole("button", { name: "AI 없이 내 문장으로 결정하기", exact: true }).click();
  await page.getByRole("button", { name: "오로라 만나기 ✦", exact: true }).click();
  await page.locator("#aurora-result-title").waitFor();
  assert.equal(await page.locator("#aurora-result-title").textContent(), longTitle + "변경");
  assert.equal(await page.locator("#result-quality").inputValue(), "balanced");
  await page.waitForFunction(() => window.__resultProbe.colors.length > 0);
  const secondColors = await page.evaluate(() => window.__resultProbe.colors);
  assert.notDeepEqual(firstColors, secondColors);
  const layout = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth,
    titleBottom: document.querySelector("#aurora-result-title").getBoundingClientRect().bottom,
    stageTop: document.querySelector("canvas").getBoundingClientRect().top }));
  assert.equal(layout.overflow, false); assert.ok(layout.titleBottom < layout.stageTop);
  await page.getByRole("button", { name: "요약 분석", exact: true }).click();
  const boxes = await Promise.all([page.locator("canvas").boundingBox(), page.locator("#result-analysis").boundingBox()]);
  assert.ok(boxes[0].y + boxes[0].height < boxes[1].y);
  await page.screenshot({ path: resolve(output, "mobile-long-title.png"), fullPage: true });
  await page.getByRole("button", { name: "분석 패널 닫기", exact: true }).click();
  for (const quality of ["low", "balanced", "high"]) {
    await page.locator("#result-quality").selectOption(quality);
    await page.locator("canvas").scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(output, `mobile-${quality}.png`) });
  }
  report.mobileLongTitlePanelsAndDifferentAnswerColors = true;
  console.log("Mobile layout, long title, reset and different answer colors verified");
  report.webglErrors = await page.evaluate(() => window.__resultProbe.errors);
  assert.deepEqual(report.webglErrors, []);
  report.mockedAnalyzeRequests = analyzeCount;
  await page.goto(new URL("/aurora-lab", url).href, { waitUntil: "domcontentloaded" });
  await page.locator("#aurora-quality").waitFor();
  assert.equal(await page.locator("#aurora-quality").inputValue(), "balanced");
  assert.equal(await page.getByRole("button", { name: "Serenity", exact: true }).getAttribute("aria-pressed"), "true");
  report.independentLab = true;
  assert.deepEqual(errors, []);
  report.errors = errors;
  writeFileSync(resolve(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser?.close(); }
