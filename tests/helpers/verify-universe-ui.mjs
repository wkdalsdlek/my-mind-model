// Browser-only harness for the actual Home/result sources. All API and external
// requests are intercepted; no Next server, secrets or paid calls are required.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { universeFixture, universeState, interpretationForRequest } from './aurora-universe-fixture.mjs';
const require = createRequire(import.meta.url), tools = process.env.AURORA_UI_TOOLS || '/tmp/aurora-universe-tools/node_modules';
const { chromium } = require(resolve(tools, 'playwright')), esbuild = require(resolve(tools, 'esbuild'));
const output = resolve(process.env.AURORA_UI_OUTPUT || '/tmp/aurora-universe-browser'); mkdirSync(output, { recursive: true });
const root = process.cwd(), origin = 'http://127.0.0.1:3000';
const password = readFileSync(resolve(root, 'app/page.tsx'), 'utf8').match(/const SECRET_PASSWORD = "([^"]+)"/)?.[1];
assert.ok(password); // Read locally; never print or persist this login value in reports.
const fixtures = { two: await universeFixture(universeState('single'), 'low', 'independent'),
  six: await universeFixture(universeState(), 'low', 'loop-emphasis'), neutral: await universeFixture(universeState('neutral'), 'low') };
const {loadModule}=await import('./load-typescript.mjs');
fixtures.long=await universeFixture(universeState('all'),'low');
fixtures.long.interpretation.generated.philosophy.line=loadModule('lib/philosophy-quotes.ts').resolvePhilosophyQuote('cicero-duties-1-22-together');
fixtures.long.interpretation.generated.philosophy.q10Anchor='함께 걸어간다';
fixtures.long.interpretation.generated.philosophy.reason=['함께 걸어간다는 승인 문장은 자신의 삶과 타인의 삶이 만나는 자리를 돌아보게 하며 서로의 시간을 어떻게 돌볼지 묻는 시선으로 이어질 수 있습니다.','서로 다른 가치를 함께 두고 바라보는 태도를 조심스럽게 생각해 볼 수 있습니다.'];
loadModule('lib/aurora-interpretation-validation.ts').validateAuroraInterpretationResponse({interpretation:fixtures.long.interpretation},fixtures.long.context);
await esbuild.build({ absWorkingDir: root, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', external: ['/fonts/*'],
  outfile: resolve(output, 'preview.js'), alias: { '@': root }, define: { 'process.env.NODE_ENV': '"production"' },
  stdin: { sourcefile: 'universe-harness.tsx', resolveDir: root, loader: 'tsx', contents: `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import Home from '@/app/page';import Result from '@/components/result/AuroraResultScreen';
function Harness(){const[fixture,setFixture]=useState(null);window.__universeShow=(id)=>setFixture(window.__universeFixtures[id]);
return fixture?<Result key={fixture.context.binding.requestDigest} result={fixture} onReset={()=>setFixture(null)}/>:<Home/>;}
createRoot(document.getElementById('root')).render(<Harness/>);` } });
const report = { actualNextRuntime: false, source: 'actual Home + result component bundle', realOpenAICalls: 0, newApiRequests: 0, legacyApiRequests: 0, errors: [], expectedHttpErrors: [], screenshots: [] };
const injectedHttpErrors=[];
let browser, page, mode = 'hold', release, released = new Promise(r => { release = r; });
const sentence = '내 시간을 지키며 함께 걸어간다';
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 900, height: 700 }, hasTouch: true, reducedMotion: 'reduce' });
  page = await context.newPage(); page.setDefaultTimeout(60000);
  page.on('pageerror', e => report.errors.push(e.message.split(password).join('[redacted]')));
  page.on('console', m => {
    if(m.type()!=='error')return;
    const status=Number(m.text().match(/^Failed to load resource:.*status of (\d+)/)?.[1]);
    const index=injectedHttpErrors.indexOf(status);
    if(m.location().url===origin+'/api/aurora-interpretation' && index>=0){injectedHttpErrors.splice(index,1);report.expectedHttpErrors.push(status);}
    else report.errors.push(m.text().split(password).join('[redacted]'));
  });
  await page.addInitScript(() => {
    window.__universeProbe = { gl: null, energy: 0, draws: 0, shaders: [], resources: { buffers: 0, textures: 0, programs: 0 } };
    for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
      const locations = new WeakMap(), get = proto.getUniformLocation, uniform = proto.uniform1f;
      proto.getUniformLocation = function(program, name) { const value = get.call(this, program, name); if (value) locations.set(value,name); return value; };
      proto.uniform1f = function(loc, v) { if (locations.get(loc) === 'uEnergyTime') window.__universeProbe.energy=v; return uniform.call(this,loc,v); };
      for (const [method, status, info] of [['compileShader','COMPILE_STATUS','getShaderInfoLog'],['linkProgram','LINK_STATUS','getProgramInfoLog']]) {
        const original=proto[method]; proto[method]=function(item) { const result=original.call(this,item);
          if (!(method==='compileShader'?this.getShaderParameter(item,this[status]):this.getProgramParameter(item,this[status]))) window.__universeProbe.shaders.push(this[info](item)); return result; };
      }
      for (const [create, drop, key] of [['createBuffer','deleteBuffer','buffers'],['createTexture','deleteTexture','textures'],['createProgram','deleteProgram','programs']]) {
        const make=proto[create],remove=proto[drop],live=new WeakSet();
        proto[create]=function(...a){const o=make.apply(this,a);if(o&&!live.has(o)){live.add(o);window.__universeProbe.resources[key]++;}return o;};
        proto[drop]=function(o){if(o&&live.has(o)){live.delete(o);window.__universeProbe.resources[key]--;}return remove.call(this,o);};
      }
      for(const method of ['drawArrays','drawElements']) { const original=proto[method];proto[method]=function(...args){window.__universeProbe.gl=this;window.__universeProbe.draws++;return original.apply(this,args);}; }
    }
  });
  await page.route('**/*', async route => {
    const u = new URL(route.request().url()); if (u.origin !== origin) return route.abort();
    if (u.pathname === '/api/analyze') { report.legacyApiRequests++; return route.abort(); }
    if (u.pathname === '/api/aurora-interpretation') {
      report.newApiRequests++;
      if (mode === 'hold') await released;
      if (mode === 'fail-once') { mode='ok';injectedHttpErrors.push(502);return route.fulfill({ status:502, json:{code:'INTERPRETATION_FAILED'} }); }
      if (mode === 'no-quote') {injectedHttpErrors.push(422);return route.fulfill({status:422,json:{code:'QUOTE_CANDIDATES_INSUFFICIENT'}});}
      return route.fulfill({json:await interpretationForRequest(route.request().postDataJSON())});
    }
    if (u.pathname.startsWith('/api/')) return route.abort();
    if (u.pathname === '/__universe.js') return route.fulfill({body:readFileSync(resolve(output,'preview.js')),contentType:'text/javascript; charset=utf-8'});
    if (u.pathname === '/__universe.css') return route.fulfill({body:readFileSync(resolve(output,'preview.css')),contentType:'text/css'});
    if (u.pathname === '/fonts/nanum-pen-script/NanumPenScript-Regular.ttf') return route.fulfill({body:readFileSync(resolve(root,'public'+u.pathname)),contentType:'font/ttf'});
    if (u.pathname === '/') return route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><html lang="ko"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/__universe.css"><style>*{box-sizing:border-box}body{margin:0;font-family:Arial,'Noto Sans KR',sans-serif;background:#080d23;color:#edf1fa}button,input,select,textarea{font:inherit}</style></head><body><div id="root"></div><script>window.__universeFixtures=${JSON.stringify(fixtures).replaceAll('<','\\u003c')}</script><script src="/__universe.js"></script></body></html>`});
    return route.abort();
  });
  async function shot(name) {
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await page.screenshot({path:resolve(output,name+'.png')}); report.screenshots.push(name+'.png');
  }
  const phases = async phase => page.waitForFunction(p=>document.querySelector('#ribbon-focus-status')?.dataset.focusPhase===p,phase);
  const live = () => page.waitForFunction(()=>window.__universeProbe.gl?.canvas===document.querySelector('canvas')
    && document.querySelectorAll('[data-beacon-id]').length>0
    && Array.from(document.querySelectorAll('[data-beacon-id]')).every(n=>n.dataset.segmentU && getComputedStyle(n).visibility==='visible'));
  async function showFixture(name) {
    const old=await page.locator('canvas').count()?await page.locator('canvas').elementHandle():null;
    await page.evaluate(name=>window.__universeShow(name),name);
    if(old){await page.waitForFunction(n=>!n.isConnected,old);await old.dispose();}
    await live();
  }
  const list = () => page.getByRole('group',{name:'리본 탐색'}).locator('button');
  const beacons = () => page.getByRole('group',{name:'리본 빛 선택점'}).locator('button');
  async function setting(id,value) { const details=page.locator('details').filter({has:page.locator('#result-quality')});await details.evaluate(n=>n.open=true);await page.locator(id).selectOption(value);await details.evaluate(n=>n.open=false); }
  async function back() { await page.getByRole('button',{name:'전체 오로라로 돌아가기',exact:true}).click();await phases('overview'); }
  async function completeQuestions(kind='mixed') {
    await page.locator('#question-title').waitFor();
    for(const label of (kind==='single'?['목표를 이뤘을 때']:kind==='neutral'?[]:['깊은 대화','무언가를 창작할 때','새로운 도전을 할 때','목표를 이뤘을 때']))
      await page.getByRole('button',{name:label+' 캡슐 추가',exact:true}).click({force:true});
    if(kind==='neutral') await page.getByRole('button',{name:'건너뛰기',exact:true}).click();
    else await page.getByRole('button',{name:'다음 질문 →',exact:true}).click();
    for(let i=1;i<9;i++) {
      if(kind==='all'){await page.getByRole('button',{name:/ 캡슐 추가$/}).first().click({force:true});await page.getByRole('button',{name:'다음 질문 →',exact:true}).click();}
      else await page.getByRole('button',{name:'건너뛰기',exact:true}).click();
    }
    await page.locator('#closing-message').fill(sentence);await page.getByRole('button',{name:'AI 없이 내 문장으로 결정하기',exact:true}).click();
  }
  await page.goto(origin);await page.locator('input[type="password"]').fill(password);await page.getByRole('button',{name:'입장하기',exact:true}).click();
  if(process.env.AURORA_UI_CASE==='six') {
    await showFixture('six');await shot('final-fixture-six');
    const buttons=await list().all();for(const b of buttons)await b.focus();
    await page.keyboard.press('Home');assert.equal(await list().first().evaluate(n=>document.activeElement===n),true);
    await page.keyboard.press('End');assert.equal(await list().last().evaluate(n=>document.activeElement===n),true);
    await page.keyboard.press('Enter');await phases('focused');assert.equal(await list().last().getAttribute('aria-pressed'),'true');
    await shot('final-sixth-ribbon-macro');await back();report.sixthRibbonAndKeyboard=true;
  } else if(['full','captures'].includes(process.env.AURORA_UI_CASE)) {
    if(process.env.AURORA_UI_CASE==='full') {
    mode='ok';await completeQuestions('all');await page.getByRole('button',{name:'오로라 만나기 ✦',exact:true}).click();
    await page.locator('#aurora-result-title').waitFor();await setting('#result-quality','low');await live();
    assert.equal(report.newApiRequests,1);await shot('desktop-universe-final');report.fullQuestionnaire=true;
    console.log('PASS: all Q1–Q9 answered + approved Q10 → one interpretation request');
    await list().first().click();await phases('focused');await shot('desktop-macro-final');
    await page.getByRole('heading',{name:'이 리본이 말하는 마음',exact:true}).scrollIntoViewIfNeeded();await shot('desktop-macro-analysis-final');await back();
    await page.setViewportSize({width:390,height:844});await shot('mobile-universe-final');await beacons().first().tap();await phases('focused');await shot('mobile-macro-final');await back();
    page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'다시 성찰하기',exact:true}).click();
    }
    await completeQuestions('neutral');mode='no-quote';
    await page.getByRole('button',{name:'오로라 만나기 ✦',exact:true}).click();await page.locator('#aurora-result-title').waitFor();await setting('#result-quality','low');await live();await shot('quote-unavailable-final');
    for(const name of ['two','six','neutral']) {await showFixture(name);await shot('final-fixture-'+name);await list().first().tap();await phases('focused');await shot('final-fixture-'+name+'-macro');await back();}
    report.twoAndSixAndNeutral=true;
    await showFixture('long');await page.setViewportSize({width:320,height:740});await live();
    await page.evaluate(()=>document.fonts.ready);await shot('mobile-longest-catalog-quote');
    assert.ok(await page.getByText('키케로 · 플라톤의 말을 전하며',{exact:true}).count());
    const reason=page.getByLabel('철학자 문장 선정 이유');await reason.focus();await page.keyboard.press('End');
    assert.ok(await reason.evaluate(n=>n.clientHeight<=50 && n.scrollHeight>n.clientHeight));
    await page.getByRole('button',{name:'나의 오로라 읽기',exact:true}).click();await page.getByRole('dialog').waitFor();await shot('mobile-overall');await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('button',{name:'나의 오로라 읽기',exact:true}).evaluate(n=>document.activeElement===n),true);
    report.longQuoteAndMobileReader=true;
  } else {
  await completeQuestions();const generate=page.getByRole('button',{name:'오로라 만나기 ✦',exact:true});
  await generate.evaluate(n=>{n.click();n.click();});await page.getByRole('button',{name:'요청 취소',exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('[aria-label="오로라 해석 요청"]')?.getAttribute('aria-busy')==='true');
  assert.equal(report.newApiRequests,1);mode='ok';release();
  await page.locator('#aurora-result-title').waitFor();assert.equal(await page.locator('#aurora-result-title').textContent(),'조용히 이어지는 나의 빛');
  console.log('PASS: questionnaire approval → new API → universe (one request)');
  assert.equal(await page.getByRole('button',{name:'요약 분석',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'심층 분석',exact:true}).count(),0);
  await page.evaluate(()=>document.fonts.ready);report.quoteFontLoaded=await page.evaluate(()=>Array.from(document.fonts).some(f=>f.family==='Aurora Pen'&&f.status==='loaded'));assert.equal(report.quoteFontLoaded,true);
  await setting('#result-quality','low');await live();assert.equal(await page.locator('canvas').count(),1);
  await page.locator('canvas').evaluate(n=>n.dataset.identity='original');assert.equal(await beacons().count(),5);await shot('desktop-universe');
  await page.getByText('출처와 번역',{exact:true}).click();assert.ok((await page.getByRole('link',{name:/원문 출처/}).getAttribute('href')).startsWith('https://www.thelatinlibrary.com/'));
  await page.getByText('출처와 번역',{exact:true}).click();
  const count=report.newApiRequests;
  await page.getByRole('button',{name:'나의 오로라 읽기',exact:true}).click();await page.getByRole('dialog').waitFor();assert.ok(await page.getByRole('dialog').getByText(sentence,{exact:true}).count());await shot('desktop-overall');
  await page.keyboard.press('Tab');assert.equal(await page.getByRole('button',{name:'오로라 해석 닫기',exact:true}).evaluate(n=>document.activeElement===n),true);
  await page.keyboard.press('Escape');assert.equal(await page.getByRole('button',{name:'나의 오로라 읽기',exact:true}).evaluate(n=>document.activeElement===n),true);
  console.log('PASS: source, reader, keyboard focus restoration');
  const ids=await list().evaluateAll(nodes=>nodes.map(n=>n.dataset.ribbonId));
  for(let i=0;i<ids.length;i++) { await beacons().nth(i).click();await phases('focused');assert.equal(await list().nth(i).getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('canvas').getAttribute('data-identity'),'original');
    for(const label of ['이 빛을 만든 나의 선택','이 리본이 말하는 마음','철학적 시선','빛으로 표현된 방식','나에게 남기는 질문'])assert.equal(await page.getByRole('heading',{name:label,exact:true}).count(),1);
    if(i===0)await shot('desktop-macro');await back(); }
  report.allFiveBeacons=true;assert.equal(report.newApiRequests,count);
  console.log('PASS: all five ribbon beacons + macro interpretation + return');
  await page.emulateMedia({reducedMotion:'no-preference'});await setting('#result-camera-mode','auto');await list().nth(0).click();await list().nth(2).click();await phases('focused');
  const energy=await page.evaluate(()=>window.__universeProbe.energy);await page.waitForFunction(e=>window.__universeProbe.energy>e+.05,energy);await back();assert.equal(await page.locator('#result-camera-mode').inputValue(),'auto');
  await page.emulateMedia({reducedMotion:'reduce'});await setting('#result-camera-mode','front');
  const resources=await page.evaluate(()=>({...window.__universeProbe.resources}));
  for(let i=0;i<3;i++){await list().nth(i).click();await phases('focused');await back();}
  const after=await page.evaluate(()=>({...window.__universeProbe.resources}));assert.deepEqual(after,resources);report.focusResources={before:resources,after};
  await page.setViewportSize({width:390,height:844});await shot('mobile-universe');await beacons().first().tap();await phases('focused');await shot('mobile-macro');
  await page.setViewportSize({width:440,height:844});await phases('focused');await back();
  for(const quality of ['balanced','high']) { await setting('#result-quality',quality);await list().nth(0).tap();await phases('focused');await shot('mobile-macro-'+quality);await back(); }
  assert.equal(report.newApiRequests,count);report.navigationHasNoRequests=true;report.autoReturnAndMobile=true;
  console.log('PASS: auto mode restoration, energy, resource stability, mobile and all qualities');
  page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'다시 성찰하기',exact:true}).click();await completeQuestions('single');mode='fail-once';
  await page.getByRole('button',{name:'오로라 만나기 ✦',exact:true}).click();await page.getByRole('alert').waitFor();assert.equal(await page.locator('#closing-message').inputValue(),sentence);
  await page.getByRole('button',{name:'해석 다시 요청하기',exact:true}).click();await page.locator('#aurora-result-title').waitFor();report.manualRetryPreservesApproval=true;
  page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'다시 성찰하기',exact:true}).click();await completeQuestions('neutral');mode='no-quote';
  await page.getByRole('button',{name:'오로라 만나기 ✦',exact:true}).click();await page.locator('#aurora-result-title').waitFor();assert.equal(await page.locator('#aurora-result-title').textContent(),'나의 오로라');
  assert.equal(await page.getByRole('button',{name:'나의 오로라 읽기',exact:true}).isDisabled(),true);assert.equal(await page.getByText(sentence,{exact:true}).count(),1);await setting('#result-quality','low');await live();await shot('quote-unavailable');
  const fallbackCount=report.newApiRequests;await beacons().first().tap();await phases('focused');assert.equal(await page.getByRole('heading',{name:'나에게 남기는 질문',exact:true}).count(),0);await back();assert.equal(report.newApiRequests,fallbackCount);
  for(const name of ['two','six','neutral']) { await showFixture(name);await phases('overview');
    assert.equal(await beacons().count(),name==='two'?2:name==='six'?6:4);await shot('fixture-'+name);await list().first().tap();await phases('focused');await shot('fixture-'+name+'-macro');await back(); }
  report.twoAndSixAndNeutral=true;
  }
  report.webgl=await page.evaluate(()=>{const p=window.__universeProbe,gl=p.gl,e=gl.getExtension('WEBGL_debug_renderer_info');return {renderer:gl.getParameter(e.UNMASKED_RENDERER_WEBGL),error:gl.getError(),shaderErrors:p.shaders};});
  assert.equal(report.webgl.error,0);assert.deepEqual(report.webgl.shaderErrors,[]);assert.deepEqual(report.errors,[]);assert.equal(report.legacyApiRequests,0);
  writeFileSync(resolve(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
} catch(e) {
  const message=String(e.message).split(password).join('[redacted]');report.failure=message;
  await page?.screenshot({path:resolve(output,'failure.png')}).catch(()=>{});writeFileSync(resolve(output,'report.json'),JSON.stringify(report,null,2));throw new Error(message);
} finally {await browser?.close();}
