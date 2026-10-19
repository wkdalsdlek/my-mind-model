// Real Next.js/React/API/SDK transport. ONLY the upstream model is a local stub.
// No production flags, env-file edits, API route replacement or paid requests.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, symlinkSync, existsSync, lstatSync, unlinkSync, cpSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadModule } from './load-typescript.mjs';
import { universeState } from './aurora-universe-fixture.mjs';

const root=process.cwd(), require=createRequire(import.meta.url);
const { chromium }=require(process.env.AURORA_PLAYWRIGHT_MODULE || '/tmp/aurora-universe-tools/node_modules/playwright');
const output=resolve(root,'.next/aurora-next-integration'), project=resolve(output,'project');
mkdirSync(project,{recursive:true});
const password=readFileSync(resolve(root,'app/page.tsx'),'utf8').match(/const SECRET_PASSWORD = "([^"]+)"/)?.[1];
assert.ok(password); // Local input only; never print values, headers, payloads or JS bundles.
const sentence='내 시간을 지키며 함께 걸어간다';
const variant=process.env.AURORA_NEXT_CASE || 'mobile';assert.ok(['mobile','desktop','api'].includes(variant));
const report={actualNextRuntime:true,realOpenAICalls:0,stage:'setup',screenshots:[],runtimeErrors:[],consoleErrors:[],
  variant,uiRequests:{interpretation:0,closing:0,legacy:0},provider:{interpretation:0,closing:0,legacy:0,configChecks:0},apiChecks:[],compiler:[]};
let browser,child,mock,mode='ok',invalidRemaining=0,closingPayload,latestPayload,latestInterpretation;
const startupDiagnostics=[];
const listen=(s,port=0)=>new Promise((done,reject)=>{s.once('error',reject);s.listen(port,'127.0.0.1',()=>done(s.address().port));});
function draft(input){
  const anchor=input.approvedClosing.text.slice(0,12);
  const grounded=refs=>({text:'서로 다른 가치를 함께 살펴보려는 가능성을 돌아볼 수 있습니다.',basis:refs.length?'answer-grounded':'insufficient-evidence',evidenceRefs:refs});
  return {auroraName:'나의 시간을 잇는 빛',quoteId:mode==='none'?'none':'seneca-letters-1-1-self',q10Anchor:anchor,
    quoteReason:[`승인한 문장의 ${anchor}라는 표현은 자신의 시간을 돌아보는 시선과 연결됩니다.`],
    overall:{...grounded(input.questions.flatMap(q=>q.evidence.map(e=>e.ref))),text:'선택한 표현에는 여러 가치를 함께 살피려는 가능성이 담겨 있습니다. 서로 다른 리본은 하나의 마음을 고정된 성격으로 정하지 않습니다. 현재의 분위기와 앞으로의 바람을 구분하며 돌아볼 수 있습니다. 승인한 문장을 통해 자신의 시간을 어떻게 지킬지 생각해 볼 수 있습니다. 이 해석은 정답이 아니라 성찰을 위한 하나의 시선입니다.'},
    ribbons:Object.fromEntries(input.ribbons.map((r,i)=>[r.ribbonId,{ribbonId:r.ribbonId,
      psychological:{...grounded(r.evidenceRefs),text:`${r.name}에 연결된 실제 선택에서 함께 돌보고 싶은 가치의 가능성을 살펴볼 수 있습니다.`},
      philosophical:{...grounded(r.evidenceRefs),text:`${i+1}번째 빛의 가치를 일상에서 어떤 태도로 이어갈지 돌아볼 수 있습니다.`},
      reflectionQuestion:`이 ${i+1}번째 빛의 가치를 오늘 어떻게 돌보고 싶나요?`}]))};
}
async function auditApi(origin,payload,closing){
  report.stage='api-auth-audit';mode='ok';
  const post=(path,body,headers={})=>fetch(origin+path,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
  let r=await post('/api/aurora-interpretation',payload);assert.equal(r.status,200);await r.arrayBuffer();report.apiChecks.push({path:'/api/aurora-interpretation',cookies:false,status:r.status});
  r=await post('/api/closing-message',closing);assert.equal(r.status,200);await r.arrayBuffer();report.apiChecks.push({path:'/api/closing-message',cookies:false,status:r.status});
  r=await post('/api/analyze',{answers:loadModule('lib/questionnaire-state.ts').serializeLegacyAnswers(universeState('all')),questions:[...loadModule('lib/capsules.ts').QUESTIONS]});assert.equal(r.status,200);assert.equal((await r.json()).comments.length,10);report.apiChecks.push({path:'/api/analyze',cookies:false,status:r.status,comments:10});
  const before=report.provider.interpretation;r=await post('/api/aurora-interpretation',payload,{'sec-fetch-site':'cross-site','origin':'https://invalid.example'});assert.equal(r.status,403);assert.equal(report.provider.interpretation,before);await r.arrayBuffer();report.crossSiteRejected=true;
  invalidRemaining=1;const retryBefore=report.provider.interpretation;r=await post('/api/aurora-interpretation',payload);assert.equal(r.status,200);assert.equal(report.provider.interpretation-retryBefore,2);await r.arrayBuffer();report.serverSingleRetry=true;
  invalidRemaining=2;const finalBefore=report.provider.interpretation;r=await post('/api/aurora-interpretation',payload);assert.equal(r.status,502);assert.equal((await r.json()).code,'INTERPRETATION_RESPONSE_INVALID');assert.equal(report.provider.interpretation-finalBefore,2);report.finalFailureBounded=true;
  const stale=structuredClone(payload);stale.approval.inputFingerprint='invalid-current-approval';const staleBefore=report.provider.interpretation;
  r=await post('/api/aurora-interpretation',stale);assert.equal(r.status,409);assert.equal(report.provider.interpretation,staleBefore);await r.arrayBuffer();report.invalidApprovalRejected=true;
}
try {
  mock=createServer(async(req,res)=>{
    try{
      assert.equal(req.url,'/v1/chat/completions');assert.equal(req.method,'POST');
      let raw='';for await(const c of req){raw+=c;assert.ok(raw.length<1000000);}
      const body=JSON.parse(raw),kind=body.response_format?.json_schema?.name;
      let content;
      if(kind==='aurora_interpretation'){
        report.provider.interpretation++;assert.equal(body.model,'gpt-6.1-sol');assert.equal(body.reasoning_effort,'high');
        assert.equal(body.response_format.json_schema.strict,true);assert.equal(body.store,false);report.provider.configChecks++;
        if(mode==='fail'){res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'Synthetic provider unavailable',type:'server_error'}}));return;}
        const input=JSON.parse(body.messages.at(-1).content),value=draft(input);
        assert.deepEqual(Object.keys(value.ribbons),body.response_format.json_schema.schema.properties.ribbons.required);
        if(invalidRemaining>0){invalidRemaining--;value.ribbons={};}
        content=JSON.stringify(value);
      }else if(kind==='closing_message'){
        report.provider.closing++;content=JSON.stringify({text:sentence});
      }else if(kind==='question_analysis'){
        report.provider.legacy++;content=JSON.stringify({analyses:Object.fromEntries(Array.from({length:10},(_,i)=>{
          const id=`q${i+1}`;return[id,{questionId:id,analysis:'실제 답변을 돌아보는 합성 분석입니다.',detailedAnalysis:'선택한 표현을 돌아보는 합성 상세 분석입니다. 확정적인 성격 진단은 하지 않습니다.'}];}))});
      }else throw new Error('UNKNOWN_PROVIDER_SCHEMA');
      res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:'local-synthetic-completion',object:'chat.completion',created:1,model:body.model,
        choices:[{index:0,message:{role:'assistant',content,refusal:null},finish_reason:'stop'}],
        usage:{prompt_tokens:100,completion_tokens:100,total_tokens:200,completion_tokens_details:{reasoning_tokens:10}}}));
    }catch{res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'Synthetic fixture validation failed'}}));}
  });
  const mockPort=await listen(mock),port=Number(process.env.AURORA_NEXT_PORT || 3001),origin=`http://127.0.0.1:${port}`;
  // Next's route discovery skips directory symlinks. Use byte-identical source
  // snapshots; isolate generated types/build/env discovery from the live server.
  for(const name of ['app','components','lib','public','package.json','postcss.config.mjs']){
    const target=resolve(project,name);if(existsSync(target)&&lstatSync(target).isSymbolicLink())unlinkSync(target);
    cpSync(resolve(root,name),target,{recursive:true,filter:(src,dst)=>statSync(src).isDirectory()||!existsSync(dst)||!readFileSync(src).equals(readFileSync(dst))});
  }
  if(!existsSync(resolve(project,'node_modules')))symlinkSync(resolve(root,'node_modules'),resolve(project,'node_modules'));
  writeFileSync(resolve(project,'next.config.mjs'),'export default { experimental: { webpackMemoryOptimizations: true }, webpack(config) { config.parallelism = 2; return config; } };\n');
  const tsconfig=JSON.parse(readFileSync(resolve(root,'tsconfig.json'),'utf8'));
  tsconfig.compilerOptions.paths={'@/*':['./*']};tsconfig.compilerOptions.baseUrl=project;
  writeFileSync(resolve(project,'tsconfig.json'),JSON.stringify(tsconfig,null,2));
  const guard=resolve(output,'provider-guard.cjs');
  writeFileSync(guard,`const real=globalThis.fetch;globalThis.fetch=function(input,init){const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);if((u.pathname.includes('/chat/completions')||u.hostname.endsWith('openai.com'))&&u.origin!=='http://127.0.0.1:${mockPort}')throw new Error('PAID_PROVIDER_BLOCKED');return real.call(globalThis,input,init);};`);
  const env={...process.env,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1',OPENAI_API_KEY:'local-verification-only',OPENAI_BASE_URL:`http://127.0.0.1:${mockPort}/v1`,
    OPENAI_ORG_ID:'',OPENAI_PROJECT_ID:'',OPENAI_LOG:'off',RAYON_NUM_THREADS:'2',UV_THREADPOOL_SIZE:'2',NODE_OPTIONS:`--max-old-space-size=1024 --require=${guard}`};
  const bootstrap=resolve(output,'next-server.cjs');
  writeFileSync(bootstrap,`const next=require(${JSON.stringify(resolve(root,'node_modules/next'))});const http=require('node:http');
const app=next({dev:true,webpack:true,dir:${JSON.stringify(project)},hostname:'127.0.0.1',port:${port}});let server;
app.prepare().then(()=>{server=http.createServer(app.getRequestHandler());server.listen(${port},'127.0.0.1');}).catch(e=>{console.error('NEXT_PREPARE_FAILED',e.name);process.exit(1);});
process.on('SIGTERM',async()=>{server?.closeAllConnections();server?.close();await app.close();process.exit(0);});`);
  child=spawn(process.execPath,[bootstrap],{cwd:project,env,detached:true,stdio:['pipe','pipe','pipe']});
  for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{
    // Only allowlisted lifecycle/HTTP metadata, never source frames or payloads.
    for(const line of chunk.toString().split('\n')){
      const clean=line.replace(/\x1b\[[0-9;]*m/g,'');
      if(report.stage==='next-startup'&&/error|Error|panic|thread|failed|Failed|pool|Error:|Aborted|ENOMEM/i.test(clean)
        && !/SECRET_PASSWORD|API_KEY/.test(clean))startupDiagnostics.push(clean.split(password).join('[redacted]').slice(0,350));
      const lifecycle=clean.match(/(?:Ready in|Compiled|Compiling)[^\r\n]*/)?.[0];
      const http=clean.match(/(?:GET|POST) \/(?:api\/[a-z-]+)? \d{3}[^\r\n]*/)?.[0];
      if(lifecycle||http)report.compiler.push((lifecycle||http).split(password).join('[redacted]'));
    }
  });
  report.next={port,pid:child.pid,bundler:'webpack',server:'Next dev custom HTTP server',source:'byte-identical snapshots of workspace app/components/lib/public'};
  report.stage='next-startup';
  for(let i=0;i<120;i++){
    if(child.exitCode!==null){report.next.exitCode=child.exitCode;report.next.signal=child.signalCode;report.next.startupDiagnostics=startupDiagnostics.slice(-20);throw new Error('NEXT_START_FAILED');}
    try{const r=await fetch(origin+(variant==='api'?'/api/aurora-interpretation':''),{signal:AbortSignal.timeout(60000)});if(r.status===(variant==='api'?405:200)){await r.arrayBuffer();break;}}catch{}
    if(i===119)throw new Error('NEXT_START_TIMEOUT');await new Promise(r=>setTimeout(r,500));
  }
  console.log(variant==='api'?'PASS: actual Next API readiness':'PASS: real Next.js HTTP page compiled');
  report.apiWarmup=[];
  for(const path of ['/api/closing-message','/api/aurora-interpretation','/api/analyze']){
    const start=Date.now(),r=await fetch(origin+path,{signal:AbortSignal.timeout(180000)});
    assert.equal(r.status,405);await r.arrayBuffer();report.apiWarmup.push({path,status:r.status,milliseconds:Date.now()-start});
  }
  console.log('PASS: all actual Next API routes compiled (GET 405, no model calls)');
  if(variant==='api'){
    const {buildAuroraInterpretationRequest}=loadModule('lib/aurora-interpretation.ts');
    const payload=buildAuroraInterpretationRequest(universeState('all'));
    await auditApi(origin,payload,{requestId:'next-http-audit',input:payload.closingInput});
  }else{
  browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const context=await browser.newContext({viewport:variant==='mobile'?{width:390,height:844}:{width:1100,height:850},deviceScaleFactor:1,hasTouch:true,reducedMotion:'reduce'});
  const page=await context.newPage();page.setDefaultTimeout(60000);
  page.on('crash',()=>report.runtimeErrors.push({kind:'browser-page-crash',stage:report.stage}));
  page.on('pageerror',e=>report.runtimeErrors.push({name:e.name}));
  page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource:.*status of (502|422)/.test(m.text()))report.consoleErrors.push({kind:'console-error',source:new URL(m.location().url||origin,origin).pathname});});
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  // Observe real requests/responses; NEVER fulfill a frontend API request.
  page.on('request',r=>{
    const path=new URL(r.url()).pathname;if(r.method()!=='POST')return;
    if(path==='/api/aurora-interpretation'){report.uiRequests.interpretation++;latestPayload=r.postDataJSON();}
    if(path==='/api/closing-message'){report.uiRequests.closing++;closingPayload=r.postDataJSON();}
    if(path==='/api/analyze')report.uiRequests.legacy++;
  });
  await page.addInitScript(()=>{
    window.__nextUniverseGL={gl:null,draws:0,energy:0,shaderErrors:[]};
    for(const p of [WebGLRenderingContext.prototype,WebGL2RenderingContext.prototype]){
      const names=new WeakMap(),get=p.getUniformLocation,u=p.uniform1f;
      p.getUniformLocation=function(program,name){const loc=get.call(this,program,name);if(loc)names.set(loc,name);return loc;};
      p.uniform1f=function(loc,v){if(names.get(loc)==='uEnergyTime')window.__nextUniverseGL.energy=v;return u.call(this,loc,v);};
      for(const method of ['drawArrays','drawElements']){const old=p[method];p[method]=function(...a){window.__nextUniverseGL.gl=this;window.__nextUniverseGL.draws++;return old.apply(this,a);};}
      for(const method of ['compileShader','linkProgram']){const old=p[method];p[method]=function(item){const result=old.call(this,item);if(!(method==='compileShader'?this.getShaderParameter(item,this.COMPILE_STATUS):this.getProgramParameter(item,this.LINK_STATUS)))window.__nextUniverseGL.shaderErrors.push(method);return result;};}
    }
  });
  const phase=p=>page.waitForFunction(p=>document.querySelector('#ribbon-focus-status')?.dataset.focusPhase===p,p);
  const live=()=>page.waitForFunction(()=>window.__nextUniverseGL.gl?.canvas===document.querySelector('canvas')&&document.querySelectorAll('[data-beacon-id]').length>0&&Array.from(document.querySelectorAll('[data-beacon-id]')).every(n=>n.dataset.segmentU&&getComputedStyle(n).visibility==='visible'));
  const beacons=()=>page.getByRole('group',{name:'리본 빛 선택점'}).locator('button');
  const list=()=>page.getByRole('group',{name:'리본 탐색'}).locator('button');
  async function shot(name){await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await page.screenshot({path:resolve(output,name+'.png')});report.screenshots.push(name+'.png');}
  async function setting(id,value){const d=page.locator('details').filter({has:page.locator('#result-quality')});await d.evaluate(n=>n.open=true);await page.locator(id).selectOption(value);await d.evaluate(n=>n.open=false);}
  async function back(){await page.getByRole('button',{name:'전체 오로라로 돌아가기',exact:true}).click();await phase('overview');}
  report.stage='questionnaire';
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>{const n=document.querySelector('input[type="password"]');return n&&Object.keys(n).some(k=>k.startsWith('__reactProps$'));});
  await page.locator('input[type="password"]').fill(password);await page.getByRole('button',{name:'입장하기',exact:true}).click();
  for(let i=0;i<9;i++){
    await page.getByRole('button',{name:/ 캡슐 추가$/}).first().click({force:true});await page.getByRole('button',{name:'다음 질문 →',exact:true}).click();
  }
  await page.locator('#closing-message').fill(sentence);
  const closingResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/closing-message'&&r.request().method()==='POST');
  await page.getByRole('button',{name:'나의 문장 만들기',exact:true}).click();assert.equal((await closingResponse).status(),200);
  await page.getByRole('button',{name:'이 문장으로 결정하기',exact:true}).click();
  report.stage='provider-failure';mode='fail';
  const failed=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/aurora-interpretation');
  await page.getByRole('button',{name:'오로라 만나기 ✦',exact:true}).click();assert.equal((await failed).status(),502);
  const failedPayload=structuredClone(latestPayload);
  await page.getByRole('alert').waitFor();assert.equal(await page.locator('#closing-message').inputValue(),sentence);
  assert.ok((await page.getByRole('status').allTextContents()).some(t=>t.includes('이 문장으로 결정했어요')));
  report.failurePreservesApproval=true;
  mode='ok';report.stage='interpretation';
  const succeeded=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/aurora-interpretation');
  await page.getByRole('button',{name:'해석 다시 요청하기',exact:true}).click();const response=await succeeded;assert.equal(response.status(),200);
  assert.deepEqual(latestPayload,failedPayload);report.failurePreservesAnswers=true;
  latestInterpretation=(await response.json()).interpretation;
  const {prepareAuroraInterpretation}=loadModule('lib/aurora-interpretation.ts');
  const {validateAuroraInterpretationResponse}=loadModule('lib/aurora-interpretation-validation.ts');
  const expected=await prepareAuroraInterpretation(latestPayload);validateAuroraInterpretationResponse({interpretation:latestInterpretation},expected);
  assert.ok(expected.facts.questions.every(q=>q.evidence.length));report.bindingValidated=true;
  await page.locator('#aurora-result-title').waitFor();assert.equal(await page.locator('#aurora-result-title').textContent(),latestInterpretation.generated.auroraName);
  assert.equal(await page.getByRole('button',{name:'요약 분석',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'심층 분석',exact:true}).count(),0);
  assert.equal(await page.locator('blockquote').textContent(),latestInterpretation.generated.philosophy.line.text);
  assert.ok(latestInterpretation.generated.philosophy.reason.join(' ').includes(latestInterpretation.generated.philosophy.q10Anchor));
  await page.evaluate(()=>document.fonts.ready);report.penFontLoaded=await page.evaluate(()=>Array.from(document.fonts).some(f=>f.family==='Aurora Pen'&&f.status==='loaded'));assert.ok(report.penFontLoaded);
  await setting('#result-quality','low');await live();await shot(variant+'-universe');
  assert.equal(await page.locator('canvas').count(),1);await page.locator('canvas').evaluate(n=>n.dataset.integrationIdentity='same');
  const calls=report.uiRequests.interpretation,providerCalls=report.provider.interpretation;
  await page.getByText('출처와 번역',{exact:true}).click();assert.equal(await page.getByRole('link',{name:/원문 출처/}).getAttribute('href'),latestInterpretation.generated.philosophy.line.source.url);await page.getByText('출처와 번역',{exact:true}).click();
  await page.getByRole('button',{name:'나의 오로라 읽기',exact:true}).click();assert.equal(await page.getByRole('dialog').count(),1);
  assert.ok((await page.getByRole('dialog').textContent()).includes(latestInterpretation.generated.overall.text));await shot(variant+'-reading');await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('button',{name:'나의 오로라 읽기',exact:true}).evaluate(n=>document.activeElement===n),true);
  const ids=expected.facts.ribbons.map(r=>r.ribbonId);assert.deepEqual(await beacons().evaluateAll(ns=>ns.map(n=>n.dataset.beaconId)),ids);
  report.stage='ribbons';
  for(let i=0;i<(variant==='mobile'?1:ids.length);i++){
    await beacons().nth(i).click();await phase('focused');assert.equal(await list().nth(i).getAttribute('aria-pressed'),'true');
    const r=latestInterpretation.generated.ribbons.find(r=>r.ribbonId===ids[i]);
    assert.equal(await page.getByText(r.psychological.text,{exact:true}).count(),1);assert.equal(await page.getByText(r.philosophical.text,{exact:true}).count(),1);
    assert.equal(await page.getByText(r.reflectionQuestion,{exact:true}).count(),1);assert.equal(await page.locator('canvas').getAttribute('data-integration-identity'),'same');
    if(i===0){await shot(variant+'-macro');await page.getByRole('heading',{name:'이 리본이 말하는 마음',exact:true}).evaluate(n=>{const a=n.closest('aside');a.scrollTop+=n.getBoundingClientRect().top-a.getBoundingClientRect().top-20;});await shot(variant+'-ribbon-analysis');}
    await back();
  }
  report.selectedRibbonIds=variant==='mobile'?ids.slice(0,1):ids;console.log('PASS: real Next API → verified universe → ribbon interpretation');
  if(variant==='desktop'){
  for(const q of ['balanced','high']){await setting('#result-quality',q);assert.deepEqual(await beacons().evaluateAll(ns=>ns.map(n=>n.dataset.beaconId)),ids);await list().first().click();await phase('focused');assert.equal(await page.getByText(latestInterpretation.generated.ribbons.find(r=>r.ribbonId===ids[0]).psychological.text,{exact:true}).count(),1);await back();}
  await setting('#result-quality','low');await page.emulateMedia({reducedMotion:'no-preference'});await setting('#result-camera-mode','auto');
  const energy=await page.evaluate(()=>window.__nextUniverseGL.energy);await page.waitForFunction(e=>window.__nextUniverseGL.energy>e+.05,energy);
  const anchors=await beacons().evaluateAll(ns=>ns.map(n=>({id:n.dataset.beaconId,u:n.dataset.segmentU})));
  await list().first().click();await phase('focused');await back();assert.equal(await page.locator('#result-camera-mode').inputValue(),'auto');
  report.autoRestored=true;report.anchorCount=anchors.length;
  await page.emulateMedia({reducedMotion:'reduce'});await setting('#result-camera-mode','front');
  }else{
    await beacons().first().tap();await phase('focused');await page.setViewportSize({width:440,height:844});await phase('focused');await back();report.mobileTouchAndResize=true;
  }
  assert.equal(report.uiRequests.interpretation,calls);assert.equal(report.provider.interpretation,providerCalls);report.noNavigationCalls=true;
  if(variant==='mobile'){
  mode='none';page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'다시 성찰하기',exact:true}).click();
  for(let i=0;i<9;i++)await page.getByRole('button',{name:'건너뛰기',exact:true}).click();
  await page.locator('#closing-message').fill(sentence);await page.getByRole('button',{name:'AI 없이 내 문장으로 결정하기',exact:true}).click();
  const shortage=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/aurora-interpretation');await page.getByRole('button',{name:'오로라 만나기 ✦',exact:true}).click();
  const shortageResponse=await shortage;assert.equal(shortageResponse.status(),422);assert.equal((await shortageResponse.json()).code,'QUOTE_CANDIDATES_INSUFFICIENT');
  await page.locator('#aurora-result-title').waitFor();assert.equal(await page.locator('blockquote').count(),0);assert.equal(await page.getByText(sentence,{exact:true}).count(),1);
  assert.ok(await page.getByRole('button',{name:'나의 오로라 읽기',exact:true}).isDisabled());await setting('#result-quality','low');await live();await shot('mobile-quote-unavailable');report.quoteShortageSafe=true;
  }
  report.webgl=await page.evaluate(()=>{const p=window.__nextUniverseGL,gl=p.gl,e=gl.getExtension('WEBGL_debug_renderer_info');return {renderer:e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),error:gl.getError(),shaderErrors:p.shaderErrors};});
  assert.equal(report.webgl.error,0);assert.deepEqual(report.webgl.shaderErrors,[]);assert.deepEqual(report.runtimeErrors,[]);assert.deepEqual(report.consoleErrors,[]);assert.equal(report.uiRequests.legacy,0);
  await browser.close();browser=null; // Release software GPU before Node-only audit.
  // Authentication audit: fresh Node HTTP requests have NO browser login/cookies.
  await auditApi(origin,latestPayload,closingPayload);
  }
  report.stage='complete';console.log('PASS: actual Next HTTP/API audit and bounded server retries');
}catch(e){if(child)report.next.processAtFailure={alive:child.exitCode===null&&child.signalCode===null,exitCode:child.exitCode,signal:child.signalCode};report.failure={stage:report.stage,name:e.name,code:/^[A-Z_]+$/.test(e.message)?e.message:'INTEGRATION_ASSERTION_FAILED',
  summary:e.message.split('\n')[0].split(password).join('[redacted]').split(sentence).join('[synthetic-input]').slice(0,220),
  location:e.stack?.split('\n').find(s=>s.includes('verify-next-universe.mjs:'))?.trim()};process.exitCode=1;}
finally{
  await browser?.close();
  if(child&&child.exitCode===null){child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),new Promise(r=>setTimeout(r,5000))]);if(child.exitCode===null)child.kill('SIGKILL');}
  await new Promise(r=>mock?mock.close(r):r());
  writeFileSync(resolve(output,'report.json'),JSON.stringify(report,null,2));
  writeFileSync(resolve(output,`report-${variant}.json`),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}
