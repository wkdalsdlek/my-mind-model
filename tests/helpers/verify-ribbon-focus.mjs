// Optional real Chromium/WebGL integration. Every application API is mocked/blocked.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.AURORA_PLAYWRIGHT_MODULE || "playwright");
const url = new URL(process.env.AURORA_RESULT_URL || "http://127.0.0.1:3000/");
assert.ok(["127.0.0.1", "localhost"].includes(url.hostname) && url.pathname === "/");
const output = resolve(process.env.AURORA_FOCUS_OUTPUT || "/tmp/aurora-focus-browser");
mkdirSync(output, { recursive: true });
const password = readFileSync(new URL("../../app/page.tsx", import.meta.url), "utf8").match(/const SECRET_PASSWORD = "([^"]+)"/)?.[1];
assert.ok(password); // Never print or persist this local login value.
const report = { realOpenAICalls: 0 }, errors = [];
let browser, activePage;
try {
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const context = await browser.newContext({ viewport: { width: 820, height: 640 }, hasTouch: true, reducedMotion: "reduce" });
  const page = await context.newPage(); activePage = page; page.setDefaultTimeout(60000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  let analyzeRequests = 0;
  await page.route("**/*", async route => {
    const request = new URL(route.request().url());
    if (request.origin !== url.origin) return route.abort();
    if (request.pathname === "/api/analyze") {
      analyzeRequests++;
      return route.fulfill({ json: { comments: Array.from({ length: 10 }, (_, i) => ({ questionId: `q${i + 1}`, analysis: `테스트 요약 ${i + 1}`, detailedAnalysis: `테스트 상세 ${i + 1}` })) } });
    }
    if (request.pathname.startsWith("/api/")) return route.abort();
    return route.continue();
  });
  await page.addInitScript(() => {
    window.__focusProbe = { draws: 0, energy: 0, camera: null, picks: [], resources: { buffers: 0, textures: 0, programs: 0 }, colors: [], gl: null };
    for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
      const sources = new WeakMap(), sky = new WeakSet(), locations = new WeakMap();
      const shaderSource = proto.shaderSource, attach = proto.attachShader, location = proto.getUniformLocation;
      const matrix = proto.uniformMatrix4fv, uniform1f = proto.uniform1f, uniform3f = proto.uniform3f, read = proto.readPixels;
      proto.shaderSource = function(shader,text){sources.set(shader,text);return shaderSource.call(this,shader,text);};
      proto.attachShader = function(program,shader){if(sources.get(shader)?.includes("uSkyCenter"))sky.add(program);return attach.call(this,program,shader);};
      proto.getUniformLocation = function(program,name){const value=location.call(this,program,name);if(value)locations.set(value,{name,sky:sky.has(program)});return value;};
      proto.uniformMatrix4fv = function(loc,transpose,a,...rest){
        if(locations.get(loc)?.sky && locations.get(loc)?.name==="modelViewMatrix")window.__focusProbe.camera=[
          -(a[0]*a[12]+a[1]*a[13]+a[2]*a[14]),-(a[4]*a[12]+a[5]*a[13]+a[6]*a[14]),-(a[8]*a[12]+a[9]*a[13]+a[10]*a[14])];
        return matrix.call(this,loc,transpose,a,...rest);
      };
      proto.uniform1f = function(loc,value){if(locations.get(loc)?.name==="uEnergyTime")window.__focusProbe.energy=value;return uniform1f.call(this,loc,value);};
      proto.uniform3f = function(loc,a,b,c){if(locations.get(loc)?.name==="uColorA"){
        const color=[a,b,c].map(v=>Math.round(v*10000)/10000),p=window.__focusProbe;
        if(!p.colors.some(v=>JSON.stringify(v)===JSON.stringify(color)))p.colors.push(color);
      }return uniform3f.call(this,loc,a,b,c);};
      proto.readPixels = function(...args){const result=read.apply(this,args);if(args[2]===1&&args[3]===1&&args[6] instanceof Uint8Array)window.__focusProbe.picks.push(Array.from(args[6]));return result;};
      for(const [create,remove,key] of [["createBuffer","deleteBuffer","buffers"],["createTexture","deleteTexture","textures"],["createProgram","deleteProgram","programs"]]){
        const make=proto[create],drop=proto[remove],alive=new WeakSet();
        proto[create]=function(...args){const object=make.apply(this,args);if(object&&!alive.has(object)){alive.add(object);window.__focusProbe.resources[key]++;}return object;};
        proto[remove]=function(object){if(object&&alive.has(object)){alive.delete(object);window.__focusProbe.resources[key]--;}return drop.call(this,object);};
      }
      for(const name of ["drawArrays","drawElements"]){const draw=proto[name];proto[name]=function(...args){window.__focusProbe.draws++;window.__focusProbe.gl=this;return draw.apply(this,args);};}
    }
  });
  await page.goto(url.href, { waitUntil: "networkidle" });
  await page.waitForFunction(() => {
    const input=document.querySelector('input[type="password"]');return input&&Object.keys(input).some(k=>k.startsWith("__reactProps$"));
  });
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "입장하기", exact: true }).click();
  await page.locator("#question-title").waitFor();
  for (const label of ["무언가를 창작할 때", "깊은 대화", "목표를 이뤘을 때"]) await page.getByRole("button", { name: `${label} 캡슐 추가`, exact: true }).click({ force: true });
  await page.getByRole("button", { name: "다음 질문 →", exact: true }).click();
  for(let i=1;i<9;i++)await page.getByRole("button", { name: "건너뛰기", exact: true }).click();
  const approved="내가 정한 빛의 흐름을 천천히 바라본다";
  await page.locator("#closing-message").fill(approved);
  await page.getByRole("button", { name: "AI 없이 내 문장으로 결정하기", exact: true }).click();
  await page.getByRole("button", { name: "오로라 만나기 ✦", exact: true }).click();
  await page.locator("#aurora-result-title").waitFor();
  console.log("Mocked questionnaire and approval reached result");
  const settings=page.locator("details").filter({has:page.locator("#result-quality")});
  async function option(selector,value){await settings.evaluate(n=>n.open=true);await page.locator(selector).selectOption(value);await settings.evaluate(n=>n.open=false);}
  await option("#result-quality","low");
  await page.waitForFunction(()=>window.__focusProbe.draws>0&&window.__focusProbe.camera);
  const list=page.getByRole("group",{name:"리본 탐색"}), buttons=list.locator("button");
  const ids=await buttons.evaluateAll(nodes=>nodes.map(n=>n.dataset.ribbonId));
  assert.equal(ids.length,5);assert.equal(new Set(ids).size,5);
  await page.locator("canvas").evaluate(n=>{n.dataset.focusIdentity="original";});
  const overview=await page.evaluate(()=>window.__focusProbe.camera);
  console.log("Live WebGL and five mapped ribbon IDs ready");
  const waitPhase=async value=>page.waitForFunction(p=>document.querySelector("#ribbon-focus-status").dataset.focusPhase===p,value);
  async function back(){await page.getByRole("button",{name:"전체 오로라로 돌아가기",exact:true}).click();await waitPhase("overview");}
  for(const ribbonId of ids){
    await list.locator(`[data-ribbon-id="${ribbonId}"]`).click();await waitPhase("focused");
    assert.equal(await list.locator(`[data-ribbon-id="${ribbonId}"]`).getAttribute("aria-pressed"),"true");
    assert.equal(await page.locator("canvas").getAttribute("data-focus-identity"),"original");
  }
  await page.screenshot({path:resolve(output,"desktop-focus.png")});
  await back();
  const returned=await page.evaluate(()=>window.__focusProbe.camera);
  assert.ok(Math.hypot(...returned.map((v,i)=>v-overview[i]))<.15);
  report.listMainAndLoopSelection=true;report.sameCanvas=true;report.returnPosition=true;
  console.log("All main/loop list selections and overview return verified");
  // GPU hit grid: genuine mouse events, all motion reduced for a stable overview.
  await page.locator("canvas").scrollIntoViewIfNeeded();
  let hit=null;
  for(const v of [.5,.38,.62,.26,.74]){
    for(const u of [.5,.4,.6,.3,.7,.2,.8]){
      const box=await page.locator("canvas").boundingBox();
      if(!await page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.tagName==="CANVAS",{x:box.x+box.width*u,y:box.y+box.height*v}))continue;
      await page.mouse.click(box.x+box.width*u,box.y+box.height*v);
      const selected=await list.locator('[aria-pressed="true"]').getAttribute("data-ribbon-id").catch(()=>null);
      if(selected){hit={id:selected,u,v};break;}
    }
    if(hit)break;
  }
  assert.ok(hit,"A visible core ribbon must be selectable in the actual GPU pass");await waitPhase("focused");
  const gpu=await page.evaluate(()=>window.__focusProbe.picks.at(-1));
  assert.equal(gpu[1],85);assert.equal(gpu[2],170);assert.equal(gpu[3],255);
  assert.equal(await page.getByRole("button",{name:"전체 오로라로 돌아가기",exact:true}).evaluate(n=>n===document.activeElement),true);
  await page.keyboard.press("Escape");await waitPhase("overview");
  report.directClickMatchesList=true;report.directClickKeyboardReturn=true;report.gpuHit={id:hit.id,pixel:gpu};
  console.log("Actual GPU pixel selection matched the list");
  await page.emulateMedia({reducedMotion:"no-preference"});
  await option("#result-camera-mode","free");
  const box=await page.locator("canvas").boundingBox();
  await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5);await page.mouse.down();
  await page.mouse.move(box.x+box.width*.7,box.y+box.height*.6,{steps:8});await page.mouse.up();
  assert.equal(await list.locator('[aria-pressed="true"]').count(),0);report.dragDoesNotSelect=true;
  await page.getByRole("button",{name:"정면으로 돌아오기",exact:true}).click();
  await page.waitForTimeout(1500);
  await buttons.nth(0).click();await page.waitForTimeout(120);await buttons.nth(1).click();
  await page.getByRole("button",{name:"전체 오로라로 돌아가기",exact:true}).click();await buttons.nth(2).click();
  await waitPhase("focused");assert.equal(await buttons.nth(2).getAttribute("aria-pressed"),"true");
  const before=await page.evaluate(()=>window.__focusProbe.energy);
  await page.waitForFunction(v=>window.__focusProbe.energy>v+.1,before);
  report.reselectionAndEnergyContinuation=true;
  await back();await option("#result-camera-mode","auto");
  await buttons.nth(4).click();await waitPhase("focused");await back();
  assert.equal(await page.locator("#result-camera-mode").inputValue(),"auto");report.autoModeRestored=true;
  const autoPosition=await page.evaluate(()=>window.__focusProbe.camera[0]);
  await page.waitForFunction(x=>Math.abs(window.__focusProbe.camera[0]-x)>.02,autoPosition);
  report.autoOrbitResumed=true;
  await page.emulateMedia({reducedMotion:"reduce"});await buttons.nth(0).focus();await page.keyboard.press("ArrowRight");
  assert.equal(await buttons.nth(1).evaluate(n=>n===document.activeElement),true);
  await page.keyboard.press("Enter");await waitPhase("focused");await page.keyboard.press("Escape");await waitPhase("overview");
  report.keyboardAndReducedMotion=true;
  console.log("Drag, rapid re-selection, auto return and keyboard verified");
  // Warm ID shaders before comparing live resource counts.
  const resources=await page.evaluate(()=>({...window.__focusProbe.resources}));
  for(let i=0;i<5;i++){await buttons.nth(i%ids.length).click();await waitPhase("focused");await back();}
  const afterResources=await page.evaluate(()=>({...window.__focusProbe.resources}));
  assert.deepEqual(afterResources,resources);report.noGrowthAcrossRepeatedFocus={before:resources,after:afterResources};
  await page.setViewportSize({width:390,height:844});await buttons.nth(3).tap();await waitPhase("focused");
  assert.equal(await buttons.nth(3).getAttribute("aria-pressed"),"true");
  await page.setViewportSize({width:440,height:844});await waitPhase("focused");
  assert.equal(await buttons.nth(3).getAttribute("aria-pressed"),"true");
  await page.screenshot({path:resolve(output,"mobile-focus.png"),fullPage:true});await back();
  await page.locator("canvas").scrollIntoViewIfNeeded();
  let touchHit=false;
  for(const v of [.4,.5,.6]){
    for(const u of [.3,.45,.55,.7]){
      const canvas=await page.locator("canvas").boundingBox();
      if(!await page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.tagName==="CANVAS",{x:canvas.x+canvas.width*u,y:canvas.y+canvas.height*v}))continue;
      await page.touchscreen.tap(canvas.x+canvas.width*u,canvas.y+canvas.height*v);
      if(await list.locator('[aria-pressed="true"]').count()){touchHit=true;break;}
    }
    if(touchHit)break;
  }
  assert.equal(touchHit,true);await waitPhase("focused");await back();report.mobileDirectTouch=true;
  for(const quality of ["low","balanced","high"]){await option("#result-quality",quality);await buttons.nth(0).tap();await waitPhase("focused");await back();assert.equal(await page.locator("#result-quality").inputValue(),quality);}
  report.mobileTouchResizeAndQualities=true;
  await page.getByRole("button",{name:"요약 분석",exact:true}).click();assert.ok((await page.locator("#result-analysis").textContent()).includes("테스트 요약"));
  assert.equal(await page.locator("#aurora-result-title").textContent(),approved);report.titleAndExistingAnalysisPreserved=true;
  report.webgl=await page.evaluate(()=>{
    const gl=window.__focusProbe.gl,ext=gl.getExtension("WEBGL_debug_renderer_info");
    return {version:gl.getParameter(gl.VERSION),renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),error:gl.getError(),colors:window.__focusProbe.colors};
  });
  assert.equal(report.webgl.error,0);assert.deepEqual(errors,[]);assert.equal(analyzeRequests,1);
  report.errors=errors;report.mockedAnalyzeRequests=analyzeRequests;
  writeFileSync(resolve(output,"report.json"),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} catch(error){
  const safeMessage=String(error.message).split(password).join("[redacted]");
  if(activePage){
    await activePage.screenshot({path:resolve(output,"failure.png"),fullPage:true}).catch(()=>{});
    report.failurePhase=await activePage.locator("#ribbon-focus-status").getAttribute("data-focus-phase").catch(()=>null);
  }
  writeFileSync(resolve(output,"failure.json"),JSON.stringify({checks:report,errors,message:safeMessage},null,2));
  throw new Error(safeMessage);
} finally {await browser?.close();}
