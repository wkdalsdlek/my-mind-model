// Browser UI + actual analysis handler with a mocked model. No real OpenAI requests.
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { loadModule } from "./load-typescript.mjs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.AURORA_PLAYWRIGHT_MODULE || "playwright");
const { createAnalysisHandler } = loadModule("lib/server/analysis-service.ts");
const { QUESTION_DATA } = loadModule("lib/question-data.ts");
const url = new URL(process.env.AURORA_RESULT_URL || "http://127.0.0.1:3000/");
assert.ok(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/");
const output = resolve(process.env.AURORA_ANALYSIS_OUTPUT || "/tmp/aurora-analysis-browser");
mkdirSync(output, { recursive: true });
const password = readFileSync(new URL("../../app/page.tsx", import.meta.url), "utf8").match(/const SECRET_PASSWORD = "([^"]+)"/)?.[1];
assert.ok(password, "Existing local login must be available");
const title = "서두르지 않고 내 마음의 속도를 따라 걸어가고 싶다";
let modelCalls = 0, analyzeRequests = 0, closingRequests = 0;
const diagnostics = [], runtimeErrors = [];
const handler = createAnalysisHandler({
  apiKey: () => "mock-model-only",
  diagnostic: value => diagnostics.push(value),
  complete: async ({ input }) => {
    modelCalls++;
    assert.equal(input.questions.length, 10);
    assert.ok(input.questions.every(q => q.status === "provided"));
    const ids = modelCalls === 1 ? QUESTION_DATA.slice(0, 5) : QUESTION_DATA;
    return { content: JSON.stringify({ analyses: Object.fromEntries(ids.map(q => [q.id, {
      questionId: q.id, analysis: `테스트 요약 ${q.id}`, detailedAnalysis: `테스트 상세 ${q.id}`,
    }])) }), finishReason: "stop", refused: false, usage: { promptTokens: 2100, completionTokens: 3900, totalTokens: 6000 } };
  },
});
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 }, deviceScaleFactor: 1, reducedMotion: "reduce" });
  page.setDefaultTimeout(60000);
  await page.addInitScript(() => {
    window.__analysisGL = { draws: 0, errors: [] };
    for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) for (const method of ["drawArrays", "drawElements"]) {
      const original = proto[method];
      proto[method] = function (...args) {
        const result = original.apply(this, args);
        window.__analysisGL.draws++;
        const error = this.getError();
        if (error) window.__analysisGL.errors.push(error);
        return result;
      };
    }
  });
  page.on("pageerror", () => runtimeErrors.push("React/browser runtime error"));
  page.on("dialog", async dialog => { await dialog.accept(); throw new Error("Unexpected error dialog"); });
  await page.route("**/*", async route => {
    const requestURL = new URL(route.request().url());
    if (requestURL.origin !== url.origin) return route.abort();
    if (requestURL.pathname === "/api/closing-message") {
      closingRequests++;
      return route.fulfill({ status: 200, json: { requestId: route.request().postDataJSON().requestId, text: title } });
    }
    if (requestURL.pathname === "/api/analyze") {
      analyzeRequests++;
      const response = await handler(new Request(route.request().url(), { method: "POST", headers: { "Content-Type": "application/json" }, body: route.request().postData() }));
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.comments.length, 10);
      return route.fulfill({ status: response.status, json: body });
    }
    if (requestURL.pathname.startsWith("/api/")) return route.abort();
    return route.continue();
  });
  await page.goto(url.href, { waitUntil: "networkidle" });
  await page.waitForFunction(() => {
    const field = document.querySelector('input[type="password"]');
    return field && Object.keys(field).some(key => key.startsWith("__reactProps$"));
  });
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "입장하기", exact: true }).click();
  await page.locator("#question-title").waitFor();
  for (const question of QUESTION_DATA.slice(0, 9)) {
    await page.getByRole("button", { name: `${question.keywords[0].label} 캡슐 추가`, exact: true }).click({ force: true });
    await page.getByRole("button", { name: "다음 질문 →", exact: true }).click();
  }
  await page.locator("#closing-message").fill("테스트용으로 남긴 마음의 문장");
  await page.getByRole("button", { name: "나의 문장 만들기", exact: true }).click();
  await page.getByRole("button", { name: "이 문장으로 결정하기", exact: true }).click();
  await page.getByRole("button", { name: "오로라 만나기 ✦", exact: true }).click();
  await page.locator("#aurora-result-title").waitFor();
  assert.equal(await page.locator("#aurora-result-title").textContent(), title);
  await page.locator("canvas").waitFor();
  await page.waitForFunction(() => window.__analysisGL.draws > 0);
  await page.getByRole("button", { name: "요약 분석", exact: true }).click();
  assert.ok((await page.locator("#result-analysis").textContent()).includes("테스트 요약 q10"));
  await page.getByRole("button", { name: "심층 분석", exact: true }).click();
  assert.ok((await page.locator("#result-analysis").textContent()).includes("테스트 상세 q10"));
  await page.getByRole("button", { name: "분석 패널 닫기", exact: true }).click();
  await page.screenshot({ path: resolve(output, "result.png") });
  assert.equal(analyzeRequests, 1); assert.equal(modelCalls, 2); assert.equal(closingRequests, 1);
  assert.deepEqual(diagnostics.map(d => d.outcome), ["invalid-output", "success"]);
  assert.deepEqual(runtimeErrors, []);
  const webglErrors = await page.evaluate(() => window.__analysisGL.errors);
  assert.deepEqual(webglErrors, []);
  const report = { allNineAnswered: true, q10AIDraftApproved: true, actualHandlerValidated: true,
    modelCalls, analyzeRequests, closingRequests, automaticRetryRecovered: true, approvedTitlePreserved: true,
    bothAnalysisPanels: true, canvasPresent: true, runtimeErrors, webglErrors, actualOpenAICalls: 0 };
  writeFileSync(resolve(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser?.close(); }
