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
assert.equal(new URL(process.env.PRIVATE_BETA_TEST_DATABASE_URL!).pathname,'/mmm_security_test');
const root=process.cwd(),output=resolve(root,'.next/private-beta-verification'),project=resolve(output,'project');mkdirSync(project,{recursive:true});
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
  else{
   assert.equal(kind,'aurora_interpretation');provider.interpretation++;
   const input=JSON.parse(body.messages.at(-1).content),anchor=input.approvedClosing.text.slice(0,12);
   const grounded=(refs:string[])=>({text:'실제 선택에서 함께 살펴보고 싶은 가치의 가능성을 돌아볼 수 있습니다.',basis:refs.length?'answer-grounded':'insufficient-evidence',evidenceRefs:refs});
   content=JSON.stringify({auroraName:'나의 시간을 잇는 빛',quoteId:'seneca-letters-1-1-self',q10Anchor:anchor,quoteReason:[`승인한 문장의 ${anchor}라는 표현은 자신의 시간을 돌아보는 시선과 연결됩니다.`],
    overall:{...grounded(input.questions.flatMap((q:{evidence:{ref:string}[]})=>q.evidence.map(e=>e.ref))),text:'선택한 표현에는 여러 가치를 함께 살피려는 가능성이 담겨 있습니다. 서로 다른 리본은 마음을 고정된 성격으로 정하지 않습니다. 현재의 분위기와 앞으로의 바람을 구분하며 돌아볼 수 있습니다. 승인한 문장은 자신의 시간을 어떻게 돌볼지 묻는 출발점입니다. 이 해석은 정답이 아니라 성찰을 위한 하나의 시선입니다.'},
    ribbons:Object.fromEntries(input.ribbons.map((r:{ribbonId:string;evidenceRefs:string[]},i:number)=>[r.ribbonId,{ribbonId:r.ribbonId,psychological:grounded(r.evidenceRefs),philosophical:{...grounded(r.evidenceRefs),text:`${i+1}번째 빛의 가치를 일상에서 어떤 태도로 이어갈지 돌아볼 수 있습니다.`},reflectionQuestion:`이 ${i+1}번째 빛을 오늘 어떻게 돌보고 싶나요?`}]))});
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
 const launchedBrowser:Browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 browser=launchedBrowser;const page=await launchedBrowser.newPage({viewport:{width:1280,height:850},reducedMotion:'reduce'});page.setDefaultTimeout(90000);
 const authOnly=process.env.PRIVATE_BETA_NEXT_CASE==='auth';report.authOnly=authOnly;
 const errors:string[]=[];report.runtimeErrors=errors;page.on('pageerror',()=>errors.push('PAGE_RUNTIME_ERROR'));page.on('crash',()=>errors.push('BROWSER_PAGE_CRASH'));
 let analysisCalls=0;page.on('request',r=>{if(new URL(r.url()).pathname==='/api/aurora-interpretation'&&r.method()==='POST')analysisCalls++;});
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 report.stage='login';await page.goto(origin);assert.ok(page.url().endsWith('/login'));
 await page.locator('input[name="email"]').fill(email);await page.locator('input[name="password"]').fill(password);await page.getByRole('button',{name:'입장하기',exact:true}).click();await page.waitForURL(origin+'/');
 await page.reload();await page.getByRole('button',{name:/ 캡슐 추가$/}).first().waitFor();report.sessionPersists=true;
 if(!authOnly){
 report.stage='questionnaire';for(let i=0;i<9;i++){await page.getByRole('button',{name:/ 캡슐 추가$/}).first().click({force:true});await page.getByRole('button',{name:'다음 질문 →',exact:true}).click();}
 await page.locator('#closing-message').fill(sentence);const closingResponse=page.waitForResponse(r=>r.url().endsWith('/api/closing-message')&&r.request().method()==='POST');await page.getByRole('button',{name:'나의 문장 만들기',exact:true}).click();assert.equal((await closingResponse).status(),200);
 await page.getByRole('button',{name:'이 문장으로 결정하기',exact:true}).click();const analysisResponse=page.waitForResponse(r=>r.url().endsWith('/api/aurora-interpretation')&&r.request().method()==='POST');await page.getByRole('button',{name:'오로라 만나기 ✦',exact:true}).click();assert.equal((await analysisResponse).status(),200);
 await page.locator('#aurora-result-title').waitFor();assert.equal(await page.locator('blockquote').count(),1);report.resultEntered=true;
 const details=page.locator('details').filter({has:page.locator('#result-quality')});await details.evaluate((n:HTMLDetailsElement)=>n.open=true);await page.locator('#result-quality').selectOption('low');await details.evaluate((n:HTMLDetailsElement)=>n.open=false);
 await page.getByRole('group',{name:'리본 빛 선택점'}).locator('button').first().waitFor();await page.screenshot({path:resolve(output,'authenticated-universe.png')});
 await page.getByRole('button',{name:'나의 오로라 읽기',exact:true}).click();assert.equal(await page.getByRole('dialog').count(),1);await page.keyboard.press('Escape');
 const first=page.getByRole('group',{name:'리본 탐색'}).locator('button').first();await first.click();await page.waitForFunction(()=>document.querySelector('#ribbon-focus-status')?.getAttribute('data-focus-phase')==='focused');
 await page.screenshot({path:resolve(output,'authenticated-macro.png')});await page.getByRole('button',{name:'전체 오로라로 돌아가기',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#ribbon-focus-status')?.getAttribute('data-focus-phase')==='overview');
 assert.equal(analysisCalls,1);report.navigationNoExtraAI=true;report.macroAndReturn=true;
 const ownerDenied=await page.request.post(origin+'/api/analyze',{headers:{origin,'content-type':'application/json'},data:{}});assert.equal(ownerDenied.status(),403);report.ownerOnlyLegacy=true;
 const rows=(await db.query('SELECT feature,state,attempts,estimated_usd,charged_usd FROM ai_request WHERE user_id=$1',[userId])).rows;assert.equal(rows.length,2);assert.ok(rows.every(r=>r.attempts===1&&r.state==='success'));report.persistedUsage=rows;
 }
 report.stage='logout-click';
 const logout=page.waitForResponse(r=>r.url().endsWith('/api/auth/sign-out')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'로그아웃',exact:true}).click();report.stage='logout-response';const logoutResponse=await logout;report.logoutStatus=logoutResponse.status();assert.equal(logoutResponse.status(),200);
 report.stage='logout-navigation';await page.waitForURL(origin+'/login');assert.equal((await page.request.post(origin+'/api/closing-message',{headers:{origin,'content-type':'application/json'},data:{}})).status(),401);
 await page.goto(origin);assert.ok(page.url().endsWith('/login'));assert.equal(await page.locator('canvas').count(),0);assert.deepEqual(provider,{closing:authOnly?0:1,interpretation:authOnly?0:1,legacy:1});report.logoutDeniesAccess=true;report.runtimeErrors=errors;report.lifecycle=lifecycle;report.screenshots=authOnly?[]:['authenticated-universe.png','authenticated-macro.png'];report.stage='complete';
}catch(error){report.failedStage=report.stage;report.failureName=error instanceof Error?error.name:'UNKNOWN';report.failureLocation=error instanceof Error?error.stack?.split('\n').find(line=>line.includes('verify-private-beta.mts:'))?.trim():undefined;process.exitCode=1;}
finally{
 clearInterval(progress);
 await browser?.close().catch(()=>{});
 if(child&&child.exitCode===null){child.kill('SIGTERM');await Promise.race([new Promise(r=>child!.once('exit',r)),new Promise(r=>setTimeout(r,5000))]);if(child.exitCode===null)child.kill('SIGKILL');}
 await new Promise<void>(r=>mock.close(()=>r()));await db.end();writeFileSync(resolve(output,'report.json'),JSON.stringify(report,null,2));console.info(JSON.stringify(report,null,2));
}
