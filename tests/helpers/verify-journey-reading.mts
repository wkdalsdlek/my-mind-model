/** Actual Next + PostgreSQL + Better Auth. Only upstream OpenAI is stubbed. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync,writeFileSync,mkdirSync,cpSync,existsSync,symlinkSync,statSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { hashPassword } from 'better-auth/crypto';
import type { Browser } from 'playwright';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.AURORA_PLAYWRIGHT_MODULE||'playwright');
assert.ok(process.env.PRIVATE_BETA_TEST_DATABASE_URL);
const isolatedDatabase=new URL(process.env.PRIVATE_BETA_TEST_DATABASE_URL!);
assert.equal(isolatedDatabase.pathname,'/mmm_security_test');
assert.ok(['127.0.0.1','localhost','[::1]'].includes(isolatedDatabase.hostname),'ONLY_LOOPBACK_DISPOSABLE_DB');
assert.equal(process.env.DATABASE_URL,process.env.PRIVATE_BETA_TEST_DATABASE_URL,'TEST_DB_MUST_MATCH');
assert.notEqual(process.env.NODE_ENV,'production');assert.notEqual(process.env.VERCEL_ENV,'production');
const realAudio=process.env.PRIVATE_BETA_REAL_AUDIO==='1';
const root=process.cwd(),output=resolve(root,realAudio?'node_modules/.cache/journey-real-audio-verification':'node_modules/.cache/journey-reading-verification'),project=resolve('/tmp','mmm-reading-next-'+randomUUID());mkdirSync(output,{recursive:true});mkdirSync(project,{recursive:true});
const db=new Pool({connectionString:process.env.PRIVATE_BETA_TEST_DATABASE_URL});
const ownerId=randomUUID(),ownerEmail=`owner-${randomUUID()}@example.invalid`;
const password='synthetic-'+randomUUID(),email=`next-${randomUUID()}@example.invalid`,userId=randomUUID();
const sentence='내 시간을 지키며 함께 걸어간다',provider={closing:0,interpretation:0,legacy:0};
const report:Record<string,unknown>={realOpenAICalls:0,actualNextRuntime:true,actualPostgreSQL:true,stage:'setup',provider,screenshots:[]};
let browser:Browser|undefined,child:ReturnType<typeof spawn>|undefined;
const progress=setInterval(()=>writeFileSync(resolve(output,'progress.json'),JSON.stringify({stage:report.stage,provider})),2000);progress.unref();
const mock=createServer(async(req,res)=>{
 try{
  assert.equal(req.url,'/v1/chat/completions');let raw='';for await(const b of req)raw+=b;
  const body=JSON.parse(raw),kind=body.response_format?.json_schema?.name;let content;
  if(kind==='closing_message'){provider.closing++;content=JSON.stringify({text:sentence});}
  else if(kind==='question_analysis'){provider.legacy++;content=JSON.stringify({analyses:Object.fromEntries(Array.from({length:10},(_,i)=>{const questionId=`q${i+1}`;return[questionId,{questionId,analysis:'실제 답변을 돌아보는 합성 분석입니다.',detailedAnalysis:'선택한 표현을 성찰하는 합성 분석입니다.'}];}))});}
  else {
   assert.equal(kind,'aurora_interpretation');provider.interpretation++;
   if(realAudio)await new Promise(r=>setTimeout(r,1500));
   const input=JSON.parse(body.messages.at(-1).content);
   const {universeModelResponse}=await import('./aurora-universe-fixture.mjs');
   content=JSON.stringify(universeModelResponse({approvedClosing:input.approvedClosing,situation:input.situation,facts:{questions:input.questions,ribbons:input.ribbons.map((r:{ribbonId:string;name:string;evidenceRefs:string[]})=>({...r,evidence:r.evidenceRefs.map(ref=>({ref}))}))}}));
  }
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:'local-synthetic',object:'chat.completion',created:1,model:body.model,choices:[{index:0,message:{role:'assistant',content,refusal:null},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:100,total_tokens:200,completion_tokens_details:{reasoning_tokens:10},prompt_tokens_details:{cached_tokens:5}}}));
 }catch{res.writeHead(500);res.end('{}');}
});
try{
 await db.query(readFileSync(resolve(root,'db/migrations/001_private_beta.sql'),'utf8'));
 await db.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)',[userId,'Synthetic Tester',email]);
 await db.query('INSERT INTO account(id,"accountId","providerId","userId",password) VALUES($1,$2,\'credential\',$2,$3)',[randomUUID(),userId,await hashPassword(password)]);
 await db.query("INSERT INTO \"user\"(id,name,email,\"emailVerified\",role) VALUES($1,'Synthetic Owner',$2,true,'owner')",[ownerId,ownerEmail]);
 await db.query('INSERT INTO account(id,"accountId","providerId","userId",password) VALUES($1,$2,\'credential\',$2,$3)',[randomUUID(),ownerId,await hashPassword(password)]);
 const port=Number(process.env.PRIVATE_BETA_NEXT_PORT||3002),origin=`http://127.0.0.1:${port}`;
 await new Promise<void>(r=>mock.listen(0,'127.0.0.1',r));const mockPort=(mock.address() as {port:number}).port;
 for(const name of ['app','components','lib','public','package.json','postcss.config.mjs'])cpSync(resolve(root,name),resolve(project,name),{recursive:true,filter:(src,dst)=>statSync(src).isDirectory()||!existsSync(dst)||!readFileSync(src).equals(readFileSync(dst))});
 if(!existsSync(resolve(project,'node_modules')))symlinkSync(resolve(root,'node_modules'),resolve(project,'node_modules'));
 writeFileSync(resolve(project,'next.config.mjs'),'export default { experimental: { webpackMemoryOptimizations: true }, webpack(c){c.parallelism=2;return c;} };');
 const tsconfig=JSON.parse(readFileSync(resolve(root,'tsconfig.json'),'utf8'));tsconfig.compilerOptions.paths={'@/*':['./*']};tsconfig.compilerOptions.baseUrl=project;writeFileSync(resolve(project,'tsconfig.json'),JSON.stringify(tsconfig));
 const guard=resolve(output,'provider-guard.cjs');writeFileSync(guard,`const f=globalThis.fetch;globalThis.fetch=function(input,init){const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);if((u.hostname.endsWith('openai.com')||u.pathname.includes('/chat/completions'))&&u.origin!=='http://127.0.0.1:${mockPort}')throw new Error('PAID_PROVIDER_BLOCKED');return f.call(globalThis,input,init);};`);
 const bootstrap=resolve(output,'server.cjs');writeFileSync(bootstrap,`const next=require(${JSON.stringify(resolve(root,'node_modules/next'))}),http=require('node:http');const app=next({dev:true,webpack:true,dir:${JSON.stringify(project)},hostname:'127.0.0.1',port:${port}});let server;app.prepare().then(()=>{server=http.createServer(app.getRequestHandler());server.listen(${port},'127.0.0.1');}).catch(()=>{console.error('NEXT_PREPARE_FAILED');process.exit(1);});process.on('SIGTERM',async()=>{server?.closeAllConnections();server?.close();await app.close();process.exit(0);});`);
 child=spawn(process.execPath,[bootstrap],{cwd:project,env:{...process.env,DATABASE_URL:process.env.PRIVATE_BETA_TEST_DATABASE_URL,BETTER_AUTH_URL:origin,AUTH_TRUSTED_ORIGINS:origin,NODE_ENV:'development',OPENAI_API_KEY:'local-verification-only',OPENAI_BASE_URL:`http://127.0.0.1:${mockPort}/v1`,OPENAI_LOG:'off',OPENAI_ORG_ID:'',OPENAI_PROJECT_ID:'',NEXT_TELEMETRY_DISABLED:'1',UV_THREADPOOL_SIZE:'2',RAYON_NUM_THREADS:'2',NODE_OPTIONS:`--max-old-space-size=1200 --require=${guard}`},stdio:['ignore','pipe','pipe']});
 const lifecycle:string[]=[];report.lifecycle=lifecycle;
 for(const stream of [child.stdout,child.stderr])stream!.on('data',b=>{for(const line of b.toString().split('\n')){const m=line.match(/(?:GET|POST) \/(?:api\/[a-z/-]+)? \d{3}[^\r\n]*/);if(m)lifecycle.push(m[0]);}});
 report.stage='next-startup';
 for(let i=0;i<40;i++){if(child.exitCode!==null)throw new Error('NEXT_START_FAILED');try{const r=await fetch(origin+'/login',{signal:AbortSignal.timeout(60000)});await r.arrayBuffer();if(r.ok)break;}catch{}if(i===39)throw new Error('NEXT_TIMEOUT');await new Promise(r=>setTimeout(r,500));}
 for(const path of ['/api/auth/get-session','/api/closing-message','/api/aurora-interpretation','/api/analyze']){const r=await fetch(origin+path,{signal:AbortSignal.timeout(120000)});await r.arrayBuffer();assert.ok([401,405].includes(r.status));}
 const denied=await fetch(origin+'/api/closing-message',{method:'POST',headers:{origin,'content-type':'application/json'},body:'{}'});assert.equal(denied.status,401);assert.equal(provider.closing,0);report.anonymousDenied=true;
 const ownerLogin=await fetch(origin+'/api/auth/sign-in/email',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email:ownerEmail,password})});assert.equal(ownerLogin.status,200);
 const ownerCookie=ownerLogin.headers.getSetCookie().find(v=>v.includes('session_token'))!.split(';')[0];
 const {loadModule}=await import('./load-typescript.mjs');const {universeState}=await import('./aurora-universe-fixture.mjs');
 const legacy=await fetch(origin+'/api/analyze',{method:'POST',headers:{origin,'content-type':'application/json',cookie:ownerCookie},body:JSON.stringify({questions:[...loadModule('lib/capsules.ts').QUESTIONS],answers:loadModule('lib/questionnaire-state.ts').serializeLegacyAnswers(universeState('all'))})});assert.equal(legacy.status,200);assert.equal((await legacy.json()).comments.length,10);report.ownerLegacyTenComments=true;
 const launchedBrowser:Browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=document-user-activation-required']});
 browser=launchedBrowser;const page=await launchedBrowser.newPage({viewport:{width:1280,height:850},reducedMotion:'reduce',hasTouch:true});page.setDefaultTimeout(90000);
 const authOnly=process.env.PRIVATE_BETA_NEXT_CASE==='auth';report.authOnly=authOnly;
 const errors:string[]=[];report.runtimeErrors=errors;page.on('console',m=>{const t=m.text();if(m.type()==='error'&&/WebGL|THREE.WebGLProgram|GL_INVALID/.test(t))errors.push('WEBGL_ERROR');});page.on('pageerror',()=>errors.push('PAGE_RUNTIME_ERROR'));page.on('crash',()=>errors.push('BROWSER_PAGE_CRASH'));
 let analysisCalls=0;page.on('request',r=>{if(new URL(r.url()).pathname==='/api/aurora-interpretation'&&r.method()==='POST')analysisCalls++;});
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await page.addInitScript((nativeAudio:boolean)=>{
  const status={play:0,pause:0};Object.assign(window,{__audioTest:status});
  if(nativeAudio){
   const play=HTMLMediaElement.prototype.play,pause=HTMLMediaElement.prototype.pause;
   HTMLMediaElement.prototype.play=function(){status.play++;return play.call(this);};
   HTMLMediaElement.prototype.pause=function(){status.pause++;return pause.call(this);};
   return;
  }
  Object.defineProperty(HTMLMediaElement.prototype,'paused',{configurable:true,get(){return !(this as HTMLMediaElement).dataset.testPlaying;}});
  HTMLMediaElement.prototype.play=function(){status.play++;this.dataset.testPlaying='true';return Promise.resolve();};
  HTMLMediaElement.prototype.pause=function(){status.pause++;delete this.dataset.testPlaying;};
 },realAudio);
 const audioSamples:Record<string,unknown>[]=[];report.audioSamples=audioSamples;
 const sampleAudio=async(stage:string)=>{
  if(!realAudio)return;
  const sample=await page.locator('audio').evaluate((audio:HTMLAudioElement)=>({time:audio.currentTime,duration:audio.duration,volume:audio.volume,paused:audio.paused,loop:audio.loop,readyState:audio.readyState,error:audio.error?.code??null,identity:audio.dataset.verificationId}));
  assert.equal(await page.locator('audio').count(),1);assert.equal(sample.identity,'journey-audio');assert.equal(sample.paused,false);assert.equal(sample.error,null);assert.ok(sample.time>0);assert.equal(sample.loop,true);audioSamples.push({stage,...sample});
 };
 report.stage='login';await page.goto(origin);assert.ok(page.url().endsWith('/login'));
 if(realAudio){
  // Playwright evaluate uses userGesture:true. CDP false is required for a real negative autoplay test.
  const cdp=await page.context().newCDPSession(page);
  const evaluated=await cdp.send('Runtime.evaluate',{expression:"(async()=>{const probe=new Audio('/audio/intro-bgm.mp3');try{await probe.play();probe.pause();return 'ALLOWED';}catch(error){return error instanceof Error?error.name:'UNKNOWN';}finally{probe.removeAttribute('src');probe.load();}})()",awaitPromise:true,returnByValue:true,userGesture:false});
  const policy=evaluated.result.value;await cdp.detach();
  report.nativeAutoplayPolicyResult=policy;report.nativeAutoplayBlocked=policy==='NotAllowedError';
  assert.equal(policy,'NotAllowedError');
 }
 await page.locator('input[name="email"]').fill(email);await page.locator('input[name="password"]').fill(password);await page.getByRole('button',{name:'입장하기',exact:true}).click();await page.waitForURL(origin+'/');
 await page.reload();await page.locator('#journey-situation').waitFor();report.sessionPersists=true;
 assert.equal(await page.locator('canvas').count(),0);assert.equal(await page.evaluate(()=> (window as unknown as {__audioTest:{play:number}}).__audioTest.play),0);
 if(realAudio){
  assert.ok(existsSync(resolve(root,'public/audio/intro-bgm.mp3')));
  await page.locator('audio').evaluate((audio:HTMLAudioElement)=>{audio.dataset.verificationId='journey-audio';});
 }
 const story='아이를 키우며 나만의 시간도 돌보고 싶은 초보 아빠';
 const start=page.getByRole('button',{name:'나의 마음 들여다보기',exact:true});assert.ok(await start.isDisabled());
 await page.locator('#journey-situation').click();assert.equal(await page.getByRole('button',{name:/ 캡슐 추가$/}).count(),0);
 await page.locator('#journey-situation').fill('  ');assert.ok(await start.isDisabled());
 await page.locator('#journey-situation').fill(story);await page.locator('#journey-situation').dispatchEvent('compositionstart');assert.ok(await start.isDisabled());await page.locator('#journey-situation').dispatchEvent('compositionend');
 await page.screenshot({path:resolve(output,'desktop-intro.png')});await start.click();
 if(realAudio){
  await page.waitForFunction(()=>{const a=document.querySelector('audio');return a&&!a.paused&&a.currentTime>0;});
  await sampleAudio('start');
  await page.waitForTimeout(2300);await sampleAudio('fade-complete');
  const first=audioSamples[0] as {volume:number},last=audioSamples.at(-1) as {volume:number};assert.ok(first.volume<.12);assert.ok(Math.abs(last.volume-.12)<.001);report.nativeFadeVerified=true;
 }
 await page.locator('#journey-intro-title').waitFor({state:'detached'});
 await page.getByRole('button',{name:/ 캡슐 추가$/}).first().waitFor();assert.equal(await page.locator('audio').count(),1);assert.equal(await page.evaluate(()=> (window as unknown as {__audioTest:{play:number}}).__audioTest.play),1);
 report.introRequired=true;report.audioPolicyMocked=!realAudio;

 if(!authOnly){
 for(let i=0;i<9;i++){report.stage='questionnaire-'+(i+1);await sampleAudio('q'+(i+1));const capsule=page.getByRole('button',{name:/ 캡슐 추가$/}).first();await capsule.focus();await capsule.press('Enter');await page.getByRole('button',{name:'다음 질문 →',exact:true}).click();}
 await page.locator('#closing-message').fill(sentence);const closingResponse=page.waitForResponse(r=>r.url().endsWith('/api/closing-message')&&r.request().method()==='POST');await page.getByRole('button',{name:'나의 문장 만들기',exact:true}).click();assert.equal((await closingResponse).status(),200);
 await sampleAudio('q10-approved');await page.getByRole('button',{name:'이 문장으로 결정하기',exact:true}).click();const analysisResponse=page.waitForResponse(r=>r.url().endsWith('/api/aurora-interpretation')&&r.request().method()==='POST');await page.getByRole('button',{name:'오로라 만나기 ✦',exact:true}).click();
 if(realAudio){await page.locator('aside[aria-busy="true"]').waitFor();await sampleAudio('analysis-wait');}
 assert.equal((await analysisResponse).status(),200);
 await page.locator('#aurora-result-title').waitFor();assert.equal(await page.locator('#aurora-result-title').innerText(),sentence);assert.equal(await page.locator('blockquote').count(),0);report.resultEntered=true;
 assert.equal(await page.locator('audio').count(),1);assert.equal(await page.evaluate(()=> (window as unknown as {__audioTest:{play:number}}).__audioTest.play),1);
 await sampleAudio('result');
 const interpretationBody=await (await analysisResponse).json();assert.equal(interpretationBody.interpretation.situation.rawText,story);assert.equal(interpretationBody.interpretation.version,'aurora-interpretation-v2');report.contextBinding=true;

 const details=page.locator('details').filter({has:page.locator('#result-quality')});await details.evaluate((n:HTMLDetailsElement)=>n.open=true);await page.locator('#result-quality').selectOption('low');await details.evaluate((n:HTMLDetailsElement)=>n.open=false);
 await page.getByRole('group',{name:'리본 빛 선택점'}).locator('button').first().waitFor();
 report.webgl=await page.evaluate(()=>{const canvas=document.querySelector('canvas');const gl=canvas?.getContext('webgl2');if(!gl)return {available:false};const info=gl.getExtension('WEBGL_debug_renderer_info');return {available:true,renderer:info?gl.getParameter(info.UNMASKED_RENDERER_WEBGL):'unknown',maxTextureSize:gl.getParameter(gl.MAX_TEXTURE_SIZE)};});
 const actualBeacons=page.getByRole('group',{name:'리본 빛 선택점'}).locator('button');assert.equal(await actualBeacons.count(),interpretationBody.interpretation.facts.ribbons.length);
 await actualBeacons.first().click({force:true});await page.waitForFunction(()=>document.querySelector('#ribbon-focus-status')?.getAttribute('data-focus-phase')==='focused');assert.equal(await page.locator('#selected-ribbon-title').innerText(),interpretationBody.interpretation.facts.ribbons[0].name);
 await page.getByRole('button',{name:'전체 오로라로 돌아가기',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#ribbon-focus-status')?.getAttribute('data-focus-phase')==='overview');report.beaconSelection=true;
 assert.equal(await page.getByText('리본 탐색',{exact:true}).first().evaluate(n=>(n.closest('details') as HTMLDetailsElement).open),false);report.beaconReturnKeepsListClosed=true;
 await page.emulateMedia({reducedMotion:'no-preference'});await details.evaluate((n:HTMLDetailsElement)=>n.open=true);
 await page.waitForFunction(()=>!(document.querySelector('#result-camera-mode option[value="auto"]') as HTMLOptionElement).disabled);
 await page.locator('#result-camera-mode').selectOption('auto');await details.evaluate((n:HTMLDetailsElement)=>n.open=false);await page.waitForTimeout(1000);
 await actualBeacons.first().click({force:true});await page.waitForFunction(()=>document.querySelector('#ribbon-focus-status')?.getAttribute('data-focus-phase')==='focused');
 await page.getByRole('button',{name:'전체 오로라로 돌아가기',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#ribbon-focus-status')?.getAttribute('data-focus-phase')==='overview');
 await page.waitForFunction(()=>(document.querySelector('#result-camera-mode') as HTMLSelectElement).value==='auto');report.autoOrbitRestored=true;
 await details.evaluate((n:HTMLDetailsElement)=>n.open=true);await page.locator('#result-camera-mode').selectOption('free');await details.evaluate((n:HTMLDetailsElement)=>n.open=false);
 await page.mouse.move(420,280);await page.mouse.down();await page.mouse.move(490,330,{steps:8});await page.mouse.up();assert.equal(await page.locator('main[data-experience]').getAttribute('data-experience'),'universe');report.orbitDragDoesNotSelect=true;
 await details.evaluate((n:HTMLDetailsElement)=>n.open=true);await page.locator('#result-camera-mode').selectOption('front');await details.evaluate((n:HTMLDetailsElement)=>n.open=false);await page.emulateMedia({reducedMotion:'reduce'});
 await page.screenshot({path:resolve(output,'authenticated-universe.png')});
 await page.getByRole('button',{name:'나의 오로라 읽기',exact:true}).click();assert.equal(await page.getByRole('dialog').count(),1);assert.equal(await page.locator('blockquote').count(),1);assert.equal(await page.locator('[data-report-section]').count(),6);assert.ok(!await page.getByRole('button',{name:'지금의 이야기 수정',exact:true}).isVisible());await page.screenshot({path:resolve(output,'desktop-reading.png')});await page.keyboard.press('Escape');
 const exploreSummary=page.getByText('리본 탐색',{exact:true}).first();if(!await exploreSummary.evaluate(n=>(n.closest('details') as HTMLDetailsElement).open))await exploreSummary.click();
 const first=page.getByRole('group',{name:'리본 탐색'}).locator('button').first();await first.focus();await page.keyboard.press('Enter');report.keyboardSelection=true;assert.equal(await exploreSummary.evaluate(n=>(n.closest('details') as HTMLDetailsElement).open),false);await page.waitForFunction(()=>document.querySelector('#ribbon-focus-status')?.getAttribute('data-focus-phase')==='focused');
 await page.screenshot({path:resolve(output,'authenticated-macro.png')});await page.setViewportSize({width:390,height:844});await page.screenshot({path:resolve(output,'mobile-macro.png')});await page.getByRole('button',{name:'전체 오로라로 돌아가기',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#ribbon-focus-status')?.getAttribute('data-focus-phase')==='overview');
 if(await exploreSummary.evaluate(n=>(n.closest('details') as HTMLDetailsElement).open))await exploreSummary.tap();await page.screenshot({path:resolve(output,'mobile-universe.png')});await page.getByRole('group',{name:'리본 빛 선택점'}).locator('button').last().tap({force:true});await page.waitForFunction(()=>document.querySelector('#ribbon-focus-status')?.getAttribute('data-focus-phase')==='focused');assert.equal(await page.locator('#selected-ribbon-title').innerText(),interpretationBody.interpretation.facts.ribbons.at(-1).name);report.mobileTouchSelection=true;await page.screenshot({path:resolve(output,'mobile-touch-macro.png')});await page.getByRole('button',{name:'전체 오로라로 돌아가기',exact:true}).tap();await page.waitForFunction(()=>document.querySelector('#ribbon-focus-status')?.getAttribute('data-focus-phase')==='overview');await page.getByRole('button',{name:'나의 오로라 읽기',exact:true}).click();await page.screenshot({path:resolve(output,'mobile-reading.png')});await page.keyboard.press('Escape');
 assert.equal(analysisCalls,1);report.navigationNoExtraAI=true;report.macroAndReturn=true;
 if(realAudio){
  await sampleAudio('mobile-reading-return');
  await page.getByRole('button',{name:'배경음악 끄기',exact:true}).tap();
  const stopped=await page.locator('audio').evaluate((a:HTMLAudioElement)=>({paused:a.paused,time:a.currentTime}));assert.equal(stopped.paused,true);await page.waitForTimeout(500);assert.ok(Math.abs((await page.locator('audio').evaluate((a:HTMLAudioElement)=>a.currentTime))-stopped.time)<.02);
  await page.getByRole('button',{name:'배경음악 재생',exact:true}).tap();await page.waitForTimeout(2400);await sampleAudio('mobile-resume');report.nativeMobilePauseResume=true;
  await page.locator('audio').evaluate((a:HTMLAudioElement)=>{a.currentTime=a.duration-.35;});
  await page.waitForFunction(()=>{const a=document.querySelector('audio');return a&&!a.paused&&a.currentTime>0&&a.currentTime<2;});await sampleAudio('native-loop-wrap');report.nativeLoopVerified=true;
  assert.equal(await page.evaluate(()=> (window as unknown as {__audioTest:{play:number}}).__audioTest.play),2);
 }
 await page.getByRole('button',{name:'지금의 이야기 수정',exact:true}).click();await page.locator('#situation-edit').fill(story+' 오늘은 쉬어가고 싶다.');await page.getByRole('button',{name:'이야기 저장',exact:true}).click();
 await page.getByRole('button',{name:'오로라 만나기 ✦',exact:true}).waitFor();assert.equal(await page.locator('#journey-situation').count(),0);assert.equal(await page.locator('audio').count(),1);assert.equal(analysisCalls,1);report.contextEditPreservesApproval=true;
 const ownerDenied=await page.request.post(origin+'/api/analyze',{headers:{origin,'content-type':'application/json'},data:{}});assert.equal(ownerDenied.status(),403);report.ownerOnlyLegacy=true;
 const rows=(await db.query('SELECT feature,state,attempts,estimated_usd,charged_usd FROM ai_request WHERE user_id=$1',[userId])).rows;assert.equal(rows.length,2);assert.ok(rows.every(r=>r.attempts===1&&r.state==='success'));report.persistedUsage=rows;
 }
 report.stage='audio-failure';await page.emulateMedia({reducedMotion:'no-preference'});await page.reload();
 await page.locator('#journey-situation').fill('새로운 시작을 앞두고 있는 직장인');await page.waitForTimeout(3200);await page.screenshot({path:resolve(output,'mobile-intro.png')});
 await page.evaluate(()=>{HTMLMediaElement.prototype.play=function(){return Promise.reject(new Error('SYNTHETIC_MEDIA_BLOCKED'));};});
 await page.getByRole('button',{name:'나의 마음 들여다보기',exact:true}).click();await page.getByRole('button',{name:/ 캡슐 추가$/}).first().waitFor();await page.getByText('음원을 재생할 수 없어요. 감상은 계속할 수 있어요.').waitFor();report.audioFailureDoesNotBlock=true;
 report.stage='logout-click';
 const logout=page.waitForResponse(r=>r.url().endsWith('/api/auth/sign-out')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'로그아웃',exact:true}).click();report.stage='logout-response';const logoutResponse=await logout;report.logoutStatus=logoutResponse.status();assert.equal(logoutResponse.status(),200);
 report.stage='logout-navigation';await page.waitForURL(origin+'/login');assert.equal((await page.request.post(origin+'/api/closing-message',{headers:{origin,'content-type':'application/json'},data:{}})).status(),401);
 await page.goto(origin);assert.ok(page.url().endsWith('/login'));assert.equal(await page.locator('canvas').count(),0);assert.deepEqual(provider,{closing:authOnly?0:1,interpretation:authOnly?0:1,legacy:1});report.logoutDeniesAccess=true;report.runtimeErrors=errors;report.lifecycle=lifecycle;report.screenshots=authOnly?[]:['desktop-intro.png','authenticated-universe.png','desktop-reading.png','authenticated-macro.png','mobile-macro.png','mobile-universe.png','mobile-reading.png','mobile-intro.png','mobile-touch-macro.png'];report.stage='complete';
}catch(error){report.failedStage=report.stage;report.failureName=error instanceof Error?error.name:'UNKNOWN';report.failureLocation=error instanceof Error?error.stack?.split('\n').find(line=>line.includes('verify-journey-reading.mts:'))?.trim():undefined;process.exitCode=1;}
finally{
 clearInterval(progress);
 await browser?.close().catch(()=>{});
 if(child&&child.exitCode===null){child.kill('SIGTERM');await Promise.race([new Promise(r=>child!.once('exit',r)),new Promise(r=>setTimeout(r,5000))]);if(child.exitCode===null)child.kill('SIGKILL');}
 await new Promise<void>(r=>mock.close(()=>r()));await db.end();writeFileSync(resolve(output,'report.json'),JSON.stringify(report,null,2));console.info(JSON.stringify(report,null,2));
}
