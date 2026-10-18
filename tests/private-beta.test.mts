import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { getMigrations } from 'better-auth/db/migration';
import { securityPool, locked } from '../lib/server/security/database';
import { getAuth, principal, type Principal } from '../lib/server/security/auth';
import { authConfig, budgetConfig, checkOrigin, seoulPeriods, cost, SecurityError } from '../lib/server/security/policy';
import { reserveUsage, requestDigest } from '../lib/server/security/usage';
import { protectAI } from '../lib/server/security/api';
import { GET, POST } from '../app/api/auth/[...all]/route';
import { POST as closing } from '../app/api/closing-message/route';
import { POST as interpretation } from '../app/api/aurora-interpretation/route';
import { POST as analyze } from '../app/api/analyze/route';
import { spawn } from 'node:child_process';

// Explicit opt-in and isolated database name: never truncate an application DB.
const enabled=!!process.env.PRIVATE_BETA_TEST_DATABASE_URL;
if(enabled){assert.equal(new URL(process.env.PRIVATE_BETA_TEST_DATABASE_URL!).pathname,'/mmm_security_test');process.env.DATABASE_URL=process.env.PRIVATE_BETA_TEST_DATABASE_URL;}
const origin=process.env.BETTER_AUTH_URL||'http://127.0.0.1:3002';
const password='synthetic-test-'+randomUUID();
const ids={tester:randomUUID(),other:randomUUID(),owner:randomUUID(),disabled:randomUUID()};
const cookies:Record<string,string>={};let user:Principal;let providerCalls=0;
const oldFetch=globalThis.fetch;
const json=(path:string,body:unknown={},cookie?:string,extra:Record<string,string>={})=>new Request(origin+path,{method:'POST',headers:{'content-type':'application/json',origin,...(cookie?{cookie}:{}),...extra},body:JSON.stringify(body)});
const login=(email:string,pass=password)=>POST(json('/api/auth/sign-in/email',{email,password:pass}));
async function clearUsage(){await securityPool().query('TRUNCATE ai_attempt, ai_request');await securityPool().query("DELETE FROM beta_login_limit WHERE key LIKE 'ai-%'");await securityPool().query('UPDATE "user" SET "closingDaily"=5,"interpretationDaily"=3,"analyzeDaily"=3,"monthlyBudget"=NULL');}
const syntheticParams={model:'gpt-4o-mini',max_completion_tokens:180,messages:[{role:'user',content:'synthetic'}]};
const complete=async()=>{providerCalls++;return{usage:{prompt_tokens:100,completion_tokens:50,prompt_tokens_details:{cached_tokens:20},completion_tokens_details:{reasoning_tokens:10}}};};
async function spend(digest:string=randomUUID()){const permit=await reserveUsage(user,'closing',digest);await permit.run(syntheticParams,complete);await permit.finish(true);return permit;}
const suite=(name:string,fn:()=>void|Promise<void>)=>test(name,{skip:!enabled},fn);
before(async()=>{
 if(!enabled)return;
 globalThis.fetch=async(input,init)=>{const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(url.hostname.endsWith('openai.com')){providerCalls++;throw new Error('PAID_PROVIDER_BLOCKED');}return oldFetch(input,init);};
 await securityPool().query(readFileSync('db/migrations/001_private_beta.sql','utf8'));
 await securityPool().query('TRUNCATE "user",session,account,ai_attempt,ai_request,beta_login_limit,"rateLimit" CASCADE');
 const hash=await hashPassword(password);
 for(const [name,id]of Object.entries(ids)){
  await securityPool().query(`INSERT INTO "user"(id,name,email,"emailVerified",role,status) VALUES($1,$2,$3,true,$4,$5)`,[id,name,`${name}@example.invalid`,name==='owner'?'owner':'tester',name==='disabled'?'disabled':'active']);
  await securityPool().query(`INSERT INTO account(id,"accountId","providerId","userId",password) VALUES($1,$2,'credential',$2,$3)`,[randomUUID(),id,hash]);
 }
 for(const name of ['tester','other','owner']){
  const r=await login(`${name}@example.invalid`);assert.equal(r.status,200);
  assert.deepEqual(await r.json(),{ok:true});const set=r.headers.getSetCookie().find(c=>c.includes('session_token'))!;assert.ok(set);
  assert.ok(set.includes('HttpOnly'));assert.ok(set.includes('SameSite=Lax'));assert.ok(!set.includes('Secure'));
  cookies[name]=set.split(';')[0];
 }
 user=await principal(new Headers({cookie:cookies.tester}));
});
after(async()=>{globalThis.fetch=oldFetch;if(enabled)await securityPool().end().catch(()=>{});});

suite('installed Better Auth schema matches checked-in PostgreSQL migration',async()=>{
 const plan=await getMigrations(getAuth().options);assert.deepEqual(plan.toBeCreated,[]);assert.deepEqual(plan.toBeAdded,[]);assert.deepEqual(plan.schemaProblems,[]);
});
suite('library password hashing stores no plaintext',async()=>{const r=await securityPool().query('SELECT password FROM account');assert.ok(r.rows.every(r=>r.password!==password&&r.password.length>60));});
suite('distinct invited accounts have distinct validated principals',async()=>{assert.equal(user.id,ids.tester);assert.equal((await principal(new Headers({cookie:cookies.other}))).id,ids.other);});
suite('wrong password and unknown account are rejected generically',async()=>{for(const [email,p]of [['tester@example.invalid','incorrect'],['missing@example.invalid',password]]){const r=await login(email,p);assert.equal(r.status,401);assert.equal((await r.json()).code,'LOGIN_FAILED');}});
suite('public signup, role updates, account creation and all other auth endpoints blocked',async()=>{for(const path of ['sign-up/email','admin/create-user','update-user','change-password'])assert.equal((await POST(json('/api/auth/'+path,{role:'owner'}))).status,404);});
suite('extra role/status input cannot escalate login',async()=>{assert.equal((await POST(json('/api/auth/sign-in/email',{email:'tester@example.invalid',password,role:'owner'}))).status,401);assert.equal((await principal(new Headers({cookie:cookies.tester}))).role,'tester');});
suite('tampered and absent sessions rejected',async()=>{for(const cookie of ['',cookies.tester+'bad','better-auth.session_token=forged'])assert.equal((await GET(new Request(origin+'/api/auth/get-session',{headers:{cookie}}))).status,401);});
suite('expired session rejected against database',async()=>{const r=await login('other@example.invalid');const cookie=r.headers.getSetCookie().find(v=>v.includes('session_token'))!.split(';')[0];await securityPool().query('UPDATE session SET "expiresAt"=now()-interval \'1 minute\' WHERE "userId"=$1',[ids.other]);assert.equal((await GET(new Request(origin+'/api/auth/get-session',{headers:{cookie}}))).status,401);});
suite('disabled account cannot create a session',async()=>{assert.ok((await login('disabled@example.invalid')).status>=400);});
suite('account status is fresh even for already valid sessions',async()=>{await securityPool().query('UPDATE "user" SET status=\'disabled\' WHERE id=$1',[ids.tester]);assert.equal((await GET(new Request(origin+'/api/auth/get-session',{headers:{cookie:cookies.tester}}))).status,403);await securityPool().query('UPDATE "user" SET status=\'active\' WHERE id=$1',[ids.tester]);});
suite('logout revokes server session',async()=>{const r=await login('owner@example.invalid');const cookie=r.headers.getSetCookie().find(v=>v.includes('session_token'))!.split(';')[0];assert.equal((await POST(json('/api/auth/sign-out',{},cookie))).status,200);assert.equal((await GET(new Request(origin+'/api/auth/get-session',{headers:{cookie}}))).status,401);});
suite('atomic login throttling works with spoofed IP headers',async()=>{for(let i=0;i<5;i++)await POST(json('/api/auth/sign-in/email',{email:'brute@example.invalid',password:'wrong'},undefined,{'x-forwarded-for':`10.0.0.${i}`}));assert.equal((await login('brute@example.invalid','wrong')).status,429);});
for(const [name,route]of [['closing',closing],['interpretation',interpretation],['analyze',analyze]] as const){
 suite(`${name}: absent/forged/expired sessions denied before body or SDK`,async()=>{
  const before=providerCalls;
  for(const cookie of ['', 'better-auth.session_token=forged',cookies.other])assert.equal((await route(json('/api/'+name,{},cookie))).status,401);
  assert.equal(providerCalls,before);
 });
 suite(`${name}: disabled user denied before SDK`,async()=>{
  await securityPool().query('UPDATE "user" SET status=\'disabled\' WHERE id=$1',[ids.tester]);const before=providerCalls;
  assert.equal((await route(json('/api/'+name,{},cookies.tester))).status,403);assert.equal(providerCalls,before);
  await securityPool().query('UPDATE "user" SET status=\'active\' WHERE id=$1',[ids.tester]);
 });
}
suite('Tester allowed Q10/interpretation guard, legacy analyze requires Owner',async()=>{
 await clearUsage();let calls=0;
 for(const f of ['closing','interpretation'] as const){const guard=protectAI(f,async()=>{calls++;return Response.json({ok:true});});assert.equal((await guard(json('/api/'+f,{},cookies.tester))).status,200);}
 const guard=protectAI('analyze',async()=>{calls++;return Response.json({comments:Array(10).fill({})});});
 assert.equal((await guard(json('/api/analyze',{},cookies.tester))).status,403);assert.equal((await guard(json('/api/analyze',{},cookies.owner))).status,200);assert.equal(calls,3);
});
suite('Origin mandatory, Host/forwarded headers cannot expand trusted set',async()=>{
 const before=providerCalls;
 for(const originValue of ['https://evil.invalid','null']){
  const r=await interpretation(json('/api/aurora-interpretation',{},cookies.tester,{origin:originValue,host:'evil.invalid','x-forwarded-host':'127.0.0.1:3002'}));assert.equal(r.status,403);
 }
 const req=json('/api/closing-message',{},cookies.tester);req.headers.delete('origin');assert.equal((await closing(req)).status,403);
 assert.equal(providerCalls,before);
});
suite('JSON type and cross-site Fetch Metadata rejected',async()=>{assert.equal((await closing(json('/api/closing-message',{},cookies.tester,{'content-type':'text/plain'}))).status,415);assert.equal((await closing(json('/api/closing-message',{},cookies.tester,{'sec-fetch-site':'cross-site'}))).status,403);});
suite('missing budgets fail closed without entering model handler',async()=>{
 const before=process.env.AI_GLOBAL_MONTH_USD;delete process.env.AI_GLOBAL_MONTH_USD;let called=false;
 const r=await protectAI('closing',async()=>{called=true;return Response.json({});})(json('/api/closing-message',{},cookies.tester));
 assert.equal(r.status,503);assert.equal(called,false);process.env.AI_GLOBAL_MONTH_USD=before;
});
suite('daily Tester quota enforced, no-model request refunds count',async()=>{await clearUsage();await securityPool().query('UPDATE "user" SET "closingDaily"=1 WHERE id=$1',[ids.tester]);const p=await reserveUsage(user,'closing',randomUUID());await p.finish(false);await spend();await assert.rejects(reserveUsage(user,'closing',randomUUID()),(e:unknown)=>e instanceof SecurityError&&e.code==='USER_DAILY_LIMIT');});
suite('last quota slot cannot be shared by concurrent reservations',async()=>{
 await clearUsage();await securityPool().query('UPDATE "user" SET "closingDaily"=1 WHERE id=$1',[ids.tester]);
 const results=await Promise.allSettled([reserveUsage(user,'closing',randomUUID()),reserveUsage(user,'closing',randomUUID())]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 for(const r of results)if(r.status==='fulfilled'){await r.value.run(syntheticParams,complete);await r.value.finish(true);}
});
suite('Owner has separate configurable daily limits but shares global budget',async()=>{await clearUsage();await securityPool().query('UPDATE "user" SET "closingDaily"=8 WHERE id=$1',[ids.owner]);const owner=await principal(new Headers({cookie:cookies.owner}));const p=await reserveUsage(owner,'closing',randomUUID());await p.finish(false);const value=process.env.AI_GLOBAL_DAY_USD;process.env.AI_GLOBAL_DAY_USD='0.000001';await assert.rejects(reserveUsage(owner,'closing',randomUUID()));process.env.AI_GLOBAL_DAY_USD=value;});
suite('duplicate digest ignores requestId and JSON key ordering, includes user scope',async()=>{
 await clearUsage();const a=requestDigest('closing',{input:{b:2,a:1},requestId:'one'}),b=requestDigest('closing',{requestId:'two',input:{a:1,b:2}});assert.equal(a,b);
 await spend(a);await assert.rejects(reserveUsage(user,'closing',b),(e:unknown)=>e instanceof SecurityError&&e.code==='DUPLICATE_REQUEST');
 const owner=await principal(new Headers({cookie:cookies.owner}));const p=await reserveUsage(owner,'closing',b);await p.finish(false);
});
suite('two internal attempts count as one user request and include cached/reasoning usage correctly',async()=>{
 await clearUsage();const p=await reserveUsage(user,'interpretation',randomUUID());const params={...syntheticParams,model:'gpt-6.1-sol',max_completion_tokens:25000};await p.run(params,complete);await p.run(params,complete);await assert.rejects(p.run(params,complete));await p.finish(true);
 const r=(await securityPool().query('SELECT * FROM ai_request WHERE id=$1',[p.id])).rows[0];assert.equal(r.attempts,2);assert.equal(r.state,'success');assert.equal(r.price_snapshot.model,'gpt-6.1-sol');assert.equal(r.price_snapshot.verifiedAt,'2026-10-16');assert.ok(Math.abs(Number(r.estimated_usd)-2*cost(budgetConfig().prices['gpt-6.1-sol'],100,50,20))<0.00000003);assert.equal((await securityPool().query('SELECT * FROM ai_attempt WHERE request_id=$1',[p.id])).rowCount,2);
});
suite('ambiguous provider failure remains charged, never treated as free',async()=>{await clearUsage();const p=await reserveUsage(user,'closing',randomUUID());await assert.rejects(p.run(syntheticParams,async()=>{throw new Error('synthetic network failure');}));await p.finish(false);const r=(await securityPool().query('SELECT * FROM ai_request WHERE id=$1',[p.id])).rows[0];assert.equal(r.attempts,1);assert.equal(r.charged_usd,r.reserved_usd);});
suite('expired lease recovered while a late worker cannot start a model',async()=>{await clearUsage();const p=await reserveUsage(user,'closing',randomUUID());await securityPool().query('UPDATE ai_request SET expires_at=now()-interval \'1 second\' WHERE id=$1',[p.id]);const next=await reserveUsage(user,'closing',randomUUID());await assert.rejects(p.run(syntheticParams,complete));await next.finish(false);assert.equal((await securityPool().query('SELECT state FROM ai_request WHERE id=$1',[p.id])).rows[0].state,'expired');});
suite('monthly user cap and global request count fail before provider',async()=>{await clearUsage();await securityPool().query('UPDATE "user" SET "monthlyBudget"=0.000001 WHERE id=$1',[ids.tester]);await assert.rejects(reserveUsage(user,'closing',randomUUID()));await clearUsage();await spend();const old=process.env.AI_GLOBAL_DAY_REQUESTS;process.env.AI_GLOBAL_DAY_REQUESTS='1';await assert.rejects(reserveUsage(user,'closing',randomUUID()));process.env.AI_GLOBAL_DAY_REQUESTS=old;});
suite('Korean midnight, year and leap-month boundaries',()=>{
 assert.deepEqual(seoulPeriods(new Date('2026-10-31T14:59:59Z')),{day:'2026-10-31',month:'2026-10'});
 assert.deepEqual(seoulPeriods(new Date('2026-10-31T15:00:00Z')),{day:'2026-11-01',month:'2026-11'});
 assert.deepEqual(seoulPeriods(new Date('2026-12-31T15:00:00Z')),{day:'2027-01-01',month:'2027-01'});
 assert.deepEqual(seoulPeriods(new Date('2028-02-28T15:00:00Z')),{day:'2028-02-29',month:'2028-02'});
});
suite('budget and origin configuration reject missing/insecure production values',()=>{assert.throws(()=>budgetConfig({NODE_ENV:"development"}));assert.throws(()=>authConfig({DATABASE_URL:'unused',BETTER_AUTH_SECRET:'x'.repeat(40),BETTER_AUTH_URL:'http://localhost:3000',NODE_ENV:'production'}));assert.throws(()=>checkOrigin(json('/api/x',{},undefined,{origin:'https://evil.invalid'}),[origin]));});
suite('two independent server processes share last slot through PostgreSQL',async()=>{
 await clearUsage();await securityPool().query('UPDATE "user" SET "closingDaily"=1 WHERE id=$1',[ids.tester]);
 const worker=()=>new Promise<boolean>((resolve,reject)=>{
  const child=spawn(process.execPath,['--import','tsx','tests/helpers/beta-reserve-worker.mts'],{env:{...process.env,BETA_TEST_USER_ID:ids.tester},stdio:['ignore','pipe','pipe']});let out='';child.stdout.on('data',b=>out+=b);child.on('error',reject);child.on('exit',code=>{if(code!==0)reject(new Error('TEST_WORKER_FAILED'));else resolve(JSON.parse(out).reserved);});
 });
 const results=await Promise.all([worker(),worker()]);assert.equal(results.filter(Boolean).length,1);
 assert.equal((await securityPool().query('SELECT count(*)::int AS n FROM ai_request WHERE attempts=1')).rows[0].n,1);
});
suite('session lifetime capped at seven days and IP/User-Agent minimized',async()=>{
 const rows=(await securityPool().query('SELECT EXTRACT(EPOCH FROM ("expiresAt"-"createdAt")) AS seconds,"ipAddress","userAgent" FROM session')).rows;
 assert.ok(rows.length);assert.ok(rows.every(r=>Number(r.seconds)<=604800&&r.ipAddress===null&&r.userAgent===null));
});
suite('HTTPS library session cookie is Secure, HttpOnly, Lax with bounded expiry',async()=>{
 const result=await new Promise<string>((resolve,reject)=>{
  const child=spawn(process.execPath,['--import','tsx','tests/helpers/beta-secure-cookie-worker.mts'],{env:{...process.env,BETTER_AUTH_URL:'https://beta.example.invalid',AUTH_TRUSTED_ORIGINS:'https://beta.example.invalid'},stdio:['pipe','pipe','pipe']});let out='';child.stdout.on('data',b=>out+=b);child.on('error',reject);child.on('exit',code=>code===0?resolve(out):reject(new Error('COOKIE_WORKER_FAILED')));child.stdin.end(JSON.stringify({email:'owner@example.invalid',password}));
 });
 const info=JSON.parse(result);assert.equal(info.status,200);assert.equal(info.secure,true);assert.equal(info.httpOnly,true);assert.equal(info.sameSite,true);assert.ok(info.maxAge<=604800&&info.maxAge>0);
});
suite('global concurrency includes Owner and other user requests',async()=>{
 await clearUsage();const old=process.env.AI_GLOBAL_CONCURRENCY;process.env.AI_GLOBAL_CONCURRENCY='1';
 const first=await reserveUsage(user,'closing',randomUUID());const owner=await principal(new Headers({cookie:cookies.owner}));
 await assert.rejects(reserveUsage(owner,'interpretation',randomUUID()),(e:unknown)=>e instanceof SecurityError&&e.code==='AI_BUSY');await first.finish(false);process.env.AI_GLOBAL_CONCURRENCY=old;
});
suite('prior month charges do not consume current Korean month budget',async()=>{
 await clearUsage();const date=(await securityPool().query('SELECT now() AS time')).rows[0].time as Date;
 const previous=seoulPeriods(new Date(date.getTime()-70*86400000));
 await securityPool().query("INSERT INTO ai_request(id,user_id,feature,digest,day,month,state,attempts,reserved_usd,charged_usd,created_at,expires_at) VALUES($1,$2,'closing',$3,$4,$5,'success',1,10000,10000,now()-interval '70 days',now()-interval '70 days')",[randomUUID(),user.id,randomUUID(),previous.day,previous.month]);
 const next=await reserveUsage(user,'closing',randomUUID());await next.finish(false);
});
suite('model/output/input mismatch blocked before calling provider',async()=>{
 await clearUsage();const p=await reserveUsage(user,'closing',randomUUID());const before=providerCalls;
 await assert.rejects(p.run({...syntheticParams,max_completion_tokens:99999},complete));assert.equal(providerCalls,before);assert.equal(p.fault?.code,'MODEL_BUDGET_MISMATCH');await p.finish(false);
});
suite('missing guard row causes reservation infrastructure failure',async()=>{
 await clearUsage();await securityPool().query('DELETE FROM beta_guard');
 try{await assert.rejects(reserveUsage(user,'closing',randomUUID()),(e:unknown)=>e instanceof SecurityError&&e.code==='SECURITY_SCHEMA_UNAVAILABLE');}
 finally{await securityPool().query('INSERT INTO beta_guard VALUES(1)');}
});
suite('expired attempted request preserves worst-case budget while recovering concurrency',async()=>{
 await clearUsage();const p=await reserveUsage(user,'closing',randomUUID());await p.run(syntheticParams,complete);
 await securityPool().query("UPDATE ai_request SET expires_at=now()-interval '1 second' WHERE id=$1",[p.id]);
 const next=await reserveUsage(user,'closing',randomUUID());await next.finish(false);await p.finish(true);
 const old=(await securityPool().query('SELECT state,charged_usd,reserved_usd FROM ai_request WHERE id=$1',[p.id])).rows[0];assert.equal(old.state,'expired');assert.equal(old.charged_usd,old.reserved_usd);
});
suite('approval timestamps and per-click IDs cannot reset duplicate digest',()=>{
 assert.equal(requestDigest('interpretation',{approval:{text:'synthetic',approvedAt:'one',inputFingerprint:'one'},closingInput:{selectionId:'one'}}),requestDigest('interpretation',{closingInput:{selectionId:'two'},approval:{inputFingerprint:'two',approvedAt:'two',text:'synthetic'}}));
});
suite('unauthenticated routes never access the request body',async()=>{
 let reads=0;for(const route of [closing,interpretation,analyze]){const req=json('/api/test');Object.defineProperty(req,'body',{get(){reads++;throw new Error('BODY_MUST_NOT_BE_READ');}});assert.equal((await route(req)).status,401);}assert.equal(reads,0);
});
suite('invalid requests have durable short-window abuse limits even without model calls',async()=>{
 await clearUsage();const guard=protectAI('closing',async()=>{throw new Error('MUST_NOT_REACH_MODEL');});
 for(let i=0;i<20;i++){const req=new Request(origin+'/api/closing-message',{method:'POST',headers:{origin,'content-type':'application/json',cookie:cookies.tester},body:'{'});assert.equal((await guard(req)).status,400);}
 assert.equal((await guard(json('/api/closing-message',{},cookies.tester))).status,429);
});
suite('deleting an account cannot erase its global budget charge',async()=>{
 await clearUsage();const id=randomUUID(),requestId=randomUUID();const periods=seoulPeriods((await securityPool().query('SELECT now() AS time')).rows[0].time);
 await securityPool().query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',[id,'Synthetic deletion',id+'@example.invalid']);
 await securityPool().query("INSERT INTO ai_request(id,user_id,feature,digest,day,month,state,attempts,reserved_usd,charged_usd,expires_at) VALUES($1,$2,'closing','synthetic',$3,$4,'success',1,10,10,now())",[requestId,id,periods.day,periods.month]);
 await securityPool().query('DELETE FROM "user" WHERE id=$1',[id]);const row=(await securityPool().query('SELECT user_id,charged_usd FROM ai_request WHERE id=$1',[requestId])).rows[0];assert.equal(row.user_id,null);assert.equal(Number(row.charged_usd),10);
 const old=process.env.AI_GLOBAL_MONTH_USD;process.env.AI_GLOBAL_MONTH_USD='10';await assert.rejects(reserveUsage(user,'closing',randomUUID()),(e:unknown)=>e instanceof SecurityError&&e.code==='AI_BUDGET_LIMIT');process.env.AI_GLOBAL_MONTH_USD=old;
});
suite('transaction timeout applies locally without leaking session settings',async()=>{
 const before=(await securityPool().query('SHOW statement_timeout')).rows[0].statement_timeout;
 await locked(async db=>{assert.equal((await db.query('SHOW statement_timeout')).rows[0].statement_timeout,'10s');});
 assert.equal((await securityPool().query('SHOW statement_timeout')).rows[0].statement_timeout,before);
});
suite('failed locked transaction rolls back writes and releases the guard',async()=>{
 const before=(await securityPool().query('SELECT "closingDaily" FROM "user" WHERE id=$1',[ids.tester])).rows[0].closingDaily;
 await assert.rejects(locked(async db=>{await db.query('UPDATE "user" SET "closingDaily"="closingDaily"+1 WHERE id=$1',[ids.tester]);throw new Error('SYNTHETIC_ROLLBACK');}));
 assert.equal((await securityPool().query('SELECT "closingDaily" FROM "user" WHERE id=$1',[ids.tester])).rows[0].closingDaily,before);
 await locked(async db=>{assert.equal((await db.query('SELECT id FROM beta_guard')).rowCount,1);});
});
suite('120KB Preview cap persists matching reservation and token bounds for 60/90/110/120KB inputs',async()=>{
 await clearUsage();const previous=process.env.AI_INTERPRETATION_MAX_INPUT_BYTES;process.env.AI_INTERPRETATION_MAX_INPUT_BYTES='120000';
 try{
  await securityPool().query('UPDATE "user" SET "interpretationDaily"=10,"monthlyBudget"=25 WHERE id=$1',[user.id]);
  for(const size of [60000,90000,110000,120000,120001]){
   const p=await reserveUsage(user,'interpretation',randomUUID());
   const params={model:'gpt-6.1-sol',max_completion_tokens:25000,messages:[{role:'user',content:'합성 🌌'}]};
   params.messages[0].content+='x'.repeat(size-Buffer.byteLength(JSON.stringify(params),'utf8')-4096);
   assert.equal(Buffer.byteLength(JSON.stringify(params),'utf8')+4096,size);
   const before=providerCalls;
   const call=async()=>{providerCalls++;return{usage:{prompt_tokens:size,completion_tokens:1000}};};
   if(size>120000){await assert.rejects(p.run(params,call),(e:unknown)=>e instanceof SecurityError&&e.code==='MODEL_BUDGET_MISMATCH');await p.finish(false);assert.equal(providerCalls,before);}
   else{await p.run(params,call);await p.finish(true);assert.equal(providerCalls,before+1);}
   const row=(await securityPool().query('SELECT price_snapshot,reserved_usd,charged_usd,attempts FROM ai_request WHERE id=$1',[p.id])).rows[0];
   assert.equal(row.price_snapshot.maxInputTokens,120000);
   assert.equal(Number(row.reserved_usd),Math.ceil(2*cost(p.config.prices['gpt-6.1-sol'],120000,25000)*1e8)/1e8);
   assert.equal(row.attempts,size>120000?0:1);
   assert.ok(Math.abs(Number(row.charged_usd)-(size>120000?0:cost(p.config.prices['gpt-6.1-sol'],size,1000)))<1e-8);
  }
 }finally{if(previous===undefined)delete process.env.AI_INTERPRETATION_MAX_INPUT_BYTES;else process.env.AI_INTERPRETATION_MAX_INPUT_BYTES=previous;}
});
suite('120KB concurrent reservations cannot spend the same final global slot',async()=>{
 await clearUsage();const cap=process.env.AI_INTERPRETATION_MAX_INPUT_BYTES,day=process.env.AI_GLOBAL_DAY_USD;
 process.env.AI_INTERPRETATION_MAX_INPUT_BYTES='120000';process.env.AI_GLOBAL_DAY_USD='.98';
 try{
  const owner=await principal(new Headers({cookie:cookies.owner})),before=providerCalls;
  const results=await Promise.allSettled([reserveUsage(user,'interpretation',randomUUID()),reserveUsage(owner,'interpretation',randomUUID())]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const rejected=results.find(r=>r.status==='rejected');assert.ok(rejected&&rejected.reason instanceof SecurityError);assert.equal(rejected.reason.code,'AI_BUDGET_LIMIT');
  assert.equal(providerCalls,before);
  for(const result of results)if(result.status==='fulfilled')await result.value.finish(false);
 }finally{process.env.AI_GLOBAL_DAY_USD=day;if(cap===undefined)delete process.env.AI_INTERPRETATION_MAX_INPUT_BYTES;else process.env.AI_INTERPRETATION_MAX_INPUT_BYTES=cap;}
});
suite('test-only account can admit ten interpretations with $25 override while Q10 limits remain unchanged',async()=>{
 await clearUsage();const cap=process.env.AI_INTERPRETATION_MAX_INPUT_BYTES,monthly=process.env.AI_USER_MONTH_USD;
 process.env.AI_INTERPRETATION_MAX_INPUT_BYTES='120000';process.env.AI_USER_MONTH_USD='.01';
 try{
  await securityPool().query('UPDATE "user" SET "interpretationDaily"=10,"monthlyBudget"=25 WHERE id=$1',[user.id]);
  const periods=seoulPeriods((await securityPool().query('SELECT now() AS time')).rows[0].time);
  for(let i=0;i<9;i++)await securityPool().query("INSERT INTO ai_request(id,user_id,feature,digest,day,month,state,attempts,reserved_usd,charged_usd,expires_at) VALUES($1,$2,'interpretation',$3,$4,$5,'success',1,.01,.01,now())",[randomUUID(),user.id,randomUUID(),periods.day,periods.month]);
  const tenth=await reserveUsage(user,'interpretation',randomUUID());
  await tenth.run({model:'gpt-6.1-sol',max_completion_tokens:25000},complete);await tenth.finish(true);
  await assert.rejects(reserveUsage(user,'interpretation',randomUUID()),(e:unknown)=>e instanceof SecurityError&&e.code==='USER_DAILY_LIMIT');
  const q10=await reserveUsage(user,'closing',randomUUID());await q10.finish(false);
  const account=(await securityPool().query('SELECT "closingDaily","interpretationDaily","analyzeDaily","monthlyBudget" FROM "user" WHERE id=$1',[user.id])).rows[0];
  assert.equal(account.closingDaily,5);assert.equal(account.interpretationDaily,10);assert.equal(account.analyzeDaily,3);assert.equal(Number(account.monthlyBudget),25);
 }finally{process.env.AI_USER_MONTH_USD=monthly;if(cap===undefined)delete process.env.AI_INTERPRETATION_MAX_INPUT_BYTES;else process.env.AI_INTERPRETATION_MAX_INPUT_BYTES=cap;}
});
suite('DB outage produces 503 and zero provider calls on all routes',async()=>{await securityPool().end();const before=providerCalls;for(const route of [closing,interpretation,analyze])assert.equal((await route(json('/api/x',{},cookies.tester))).status,503);assert.equal(providerCalls,before);});
