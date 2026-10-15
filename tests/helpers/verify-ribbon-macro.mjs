// Optional real Chromium/WebGL integration. Every application API is mocked/blocked.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.AURORA_PLAYWRIGHT_MODULE || "playwright");
const url = new URL(process.env.AURORA_RESULT_URL || "http://127.0.0.1:3000/");
assert.ok(["127.0.0.1", "localhost"].includes(url.hostname) && url.pathname === "/");
const output = resolve(process.env.AURORA_FOCUS_OUTPUT || "/tmp/aurora-macro-browser");
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
    window.__focusProbe = { draws: 0, energy: 0, camera: null, picks: [], resources: { buffers: 0, textures: 0, programs: 0 }, colors: [], shaderErrors: [], gl: null };
    for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
      const sources = new WeakMap(), sky = new WeakSet(), locations = new WeakMap();
      const compile = proto.compileShader, link = proto.linkProgram;
      proto.compileShader = function(shader){const result=compile.call(this,shader);if(!this.getShaderParameter(shader,this.COMPILE_STATUS))window.__focusProbe.shaderErrors.push(this.getShaderInfoLog(shader));return result;};
      proto.linkProgram = function(program){const result=link.call(this,program);if(!this.getProgramParameter(program,this.LINK_STATUS))window.__focusProbe.shaderErrors.push(this.getProgramInfoLog(program));return result;};
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
  const beacons=page.getByRole("group",{name:"리본 빛 선택점"}).locator("button");
  async function checkBeacons(){
    assert.equal(await beacons.count(),ids.length);
    await page.waitForFunction(()=>Array.from(document.querySelectorAll("[data-beacon-id]")).every(n=>n.dataset.segmentU));
    await page.waitForFunction(()=>Array.from(document.querySelectorAll("[data-beacon-id]")).every(n=>{
      const r=n.getBoundingClientRect();return r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest("button")===n;
    }));
    const boxes=await beacons.evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {id:n.dataset.beaconId,u:Number(n.dataset.segmentU),x:r.x,y:r.y,w:r.width,h:r.height,
      hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest("button")===n};}));
    boxes.forEach((a,i)=>{assert.equal(a.id,ids[i]);assert.ok(a.u>0&&a.u<1);assert.ok(a.w>=44&&a.h>=44);assert.equal(a.hit,true);
      boxes.slice(0,i).forEach(b=>assert.ok(Math.hypot(a.x-b.x,a.y-b.y)>=48));});return boxes;
  }
  const full=await page.locator("canvas").boundingBox();assert.equal(full.x,0);assert.equal(full.y,0);assert.equal(full.width,820);assert.equal(full.height,640);
  report.fullScreenCanvas=true;report.beacons=await checkBeacons();
  await page.screenshot({path:resolve(output,"desktop-universe.png")});
  for(let i=0;i<(process.env.AURORA_MACRO_QUICK ? 1 : ids.length);i++){
    await beacons.nth(i).click();await waitPhase("focused");
    assert.equal(await buttons.nth(i).getAttribute("aria-pressed"),"true");
    assert.equal(await page.locator("canvas").getAttribute("data-focus-identity"),"original");
    assert.ok((await page.locator("#selected-ribbon-title").textContent()).length>0);
    await page.screenshot({path:resolve(output,`desktop-macro-${i}.png`)});
    await back();console.log(`Beacon ${i+1}/${ids.length} and macro captured`);
  }
  report.everyBeaconMatchesList=!process.env.AURORA_MACRO_QUICK;report.sameCanvas=true;
  const returned=await page.evaluate(()=>window.__focusProbe.camera);assert.ok(Math.hypot(...returned.map((v,i)=>v-overview[i]))<.15);report.returnPosition=true;
  await beacons.nth(1).focus();await page.keyboard.press("Enter");await waitPhase("focused");await page.keyboard.press("Escape");await waitPhase("overview");
  report.beaconKeyboardAndReducedMotion=true;console.log("Beacon and keyboard selection verified");
  // Secondary genuine GPU surface picking, avoiding HTML overlays/beacons.
  let direct=false;
  for(const y of [.42,.5,.58,.35]){
    for(const x of [.5,.4,.6,.3,.7]){
      const point={x:x*820,y:y*640};
      if(!await page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.tagName==="CANVAS",point))continue;
      await page.mouse.click(point.x,point.y);
      if(await list.locator('[aria-pressed="true"]').count()){direct=true;break;}
    }if(direct)break;
  }
  assert.equal(direct,true);await waitPhase("focused");
  const pixel=await page.evaluate(()=>window.__focusProbe.picks.at(-1));assert.equal(pixel[1],85);assert.equal(pixel[2],170);assert.equal(pixel[3],255);
  report.secondaryGpuPicking=true;await back();console.log("GPU backup picking and empty-overlay input verified");
  await page.emulateMedia({reducedMotion:"no-preference"});await option("#result-camera-mode","free");
  await page.mouse.move(320,340);await page.mouse.down();await page.mouse.move(520,410,{steps:8});await page.mouse.up();
  assert.equal(await list.locator('[aria-pressed="true"]').count(),0);await checkBeacons();report.freeDragAndBeaconVisibility=true;
  await buttons.nth(0).click();await page.waitForTimeout(120);await buttons.nth(2).click();
  await page.getByRole("button",{name:"전체 오로라로 돌아가기",exact:true}).click();await buttons.nth(1).click();await waitPhase("focused");
  const energy=await page.evaluate(()=>window.__focusProbe.energy);await page.waitForFunction(v=>window.__focusProbe.energy>v+.1,energy);
  await page.screenshot({path:resolve(output,"desktop-macro-animated.png")});
  await page.waitForFunction(v=>window.__focusProbe.energy>v+1.5,energy);
  await page.screenshot({path:resolve(output,"desktop-macro-animated-later.png")});
  report.reselectionAndRealEnergyContinuation=true;await back();console.log("Drag, rapid re-selection, real energy and camera return verified");
  await option("#result-camera-mode","auto");
  const moving=await beacons.nth(4).boundingBox();await page.mouse.move(moving.x+24,moving.y+24);
  await beacons.nth(4).click();await waitPhase("focused");await back();
  assert.equal(await page.locator("#result-camera-mode").inputValue(),"auto");
  const autoX=await page.evaluate(()=>window.__focusProbe.camera[0]);await page.waitForFunction(x=>Math.abs(window.__focusProbe.camera[0]-x)>.02,autoX);report.autoModeRestoredAndMoving=true;console.log("Automatic orbit mode resumed");
  await page.emulateMedia({reducedMotion:"reduce"});
  const resources=await page.evaluate(()=>({...window.__focusProbe.resources}));
  for(let i=0;i<5;i++){await buttons.nth(i).click();await waitPhase("focused");await back();}
  const afterResources=await page.evaluate(()=>({...window.__focusProbe.resources}));assert.deepEqual(afterResources,resources);report.focusResources={before:resources,after:afterResources};
  await page.setViewportSize({width:390,height:844});report.mobileBeacons=await checkBeacons();
  await page.screenshot({path:resolve(output,"mobile-universe.png")});
  await beacons.nth(0).tap();await waitPhase("focused");await page.screenshot({path:resolve(output,"mobile-macro.png")});
  await page.setViewportSize({width:440,height:844});await waitPhase("focused");assert.equal(await buttons.nth(0).getAttribute("aria-pressed"),"true");await back();report.mobileTouchAndResize=true;console.log("Mobile beacon tap and focused resize verified");
  for(const quality of ["balanced","high"]){await option("#result-quality",quality);await buttons.nth(1).tap();await waitPhase("focused");await page.screenshot({path:resolve(output,`mobile-macro-${quality}.png`)});await back();assert.equal(await page.locator("#result-quality").inputValue(),quality);}
  report.userQualityPreserved=true;
  await page.getByRole("button",{name:"요약 분석",exact:true}).click();assert.ok((await page.locator("#result-analysis").textContent()).includes("테스트 요약"));
  assert.equal(await page.locator("#aurora-result-title").textContent(),approved);report.titleAndExistingAnalysisPreserved=true;
  report.webgl=await page.evaluate(()=>{const gl=window.__focusProbe.gl,ext=gl.getExtension("WEBGL_debug_renderer_info");return {version:gl.getParameter(gl.VERSION),renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),error:gl.getError()};});
  report.shaderErrors=await page.evaluate(()=>window.__focusProbe.shaderErrors);assert.deepEqual(report.shaderErrors,[]);
  assert.equal(report.webgl.error,0);assert.deepEqual(errors,[]);assert.equal(analyzeRequests,1);report.errors=errors;report.mockedAnalyzeRequests=analyzeRequests;
  writeFileSync(resolve(output,"report.json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
} catch(error){
  const safeMessage=String(error.message).split(password).join("[redacted]");
  if(activePage){report.shaderErrors=await activePage.evaluate(()=>window.__focusProbe?.shaderErrors).catch(()=>[]);await activePage.screenshot({path:resolve(output,"failure.png")}).catch(()=>{});report.failurePhase=await activePage.locator("#ribbon-focus-status").getAttribute("data-focus-phase").catch(()=>null);}
  writeFileSync(resolve(output,"failure.json"),JSON.stringify({checks:report,errors,message:safeMessage},null,2));throw new Error(safeMessage);
} finally {await browser?.close();}
