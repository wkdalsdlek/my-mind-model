import { createHmac, randomUUID } from "node:crypto";
import { locked } from "./database";
import { authConfig, budgetConfig, featureBudgetConfig, cost, featureModel, SecurityError, seoulPeriods, periodRetrySeconds, type Feature } from "./policy";
import type { Principal } from "./auth";
import { logModelBudgetMismatch, type ModelBudgetMismatch } from "./model-budget-diagnostics";
import { awaitSignal } from "../interpretation-deadline";
import { logUsageDenial, logUsageAccounting, type LimitReason, type UsageLimitNumbers } from "./usage-diagnostics";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([k]) => !["requestId","approvedAt","inputFingerprint","selectionId"].includes(k)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k,v]) => [k,canonical(v)]));
  return value;
}
export function requestDigest(feature: Feature, body: unknown) { return createHmac("sha256", authConfig().secret).update(feature+":"+JSON.stringify(canonical(body))).digest("hex"); }
export async function reserveUsage(user: Principal, feature: Feature, digest: string) {
  const config = featureBudgetConfig(feature), model = featureModel(feature), price = config.prices[model.model];
  const reserved = Math.ceil(cost(price,price.maxInputTokens,model.output)*model.attempts*1e8)/1e8;
  return locked(async db => {
    const clock = (await db.query('SELECT now() AS time')).rows[0].time as Date;
    const { day, month } = seoulPeriods(clock);
    // Expired leases remain conservatively charged if a provider call started.
    await db.query(`UPDATE ai_request SET state='expired', finished_at=now(), charged_usd=CASE WHEN attempts=0 THEN 0 ELSE reserved_usd END WHERE state='pending' AND expires_at<=now()`);
    const fresh = (await db.query('SELECT status, role, "closingDaily", "interpretationDaily", "analyzeDaily", "monthlyBudget" FROM "user" WHERE id=$1', [user.id])).rows[0];
    if (!fresh || fresh.status !== 'active') throw new SecurityError('ACCOUNT_DISABLED',403);
    if (feature==='analyze' && fresh.role!=='owner') throw new SecurityError('OWNER_REQUIRED',403);
    const rows = (await db.query(`SELECT user_id,feature,day,month,state,digest,created_at,attempts,charged_usd FROM ai_request WHERE month=$1 OR state='pending' OR created_at>now()-interval '2 minutes'`,[month])).rows;
    const counted = rows.filter(r=>r.state==='pending'||r.attempts>0);
    const limit = feature==='closing'?fresh.closingDaily:feature==='interpretation'?fresh.interpretationDaily:fresh.analyzeDaily;
    const userBudget = fresh.monthlyBudget ? Number(fresh.monthlyBudget) : config.userMonth;
    const numbers: UsageLimitNumbers = { reservedUsd: reserved, userDayRequests: counted.filter(r=>r.user_id===user.id&&r.feature===feature&&r.day===day).length,
      userDayLimit: limit, globalDayRequests: counted.filter(r=>r.day===day).length, globalDayLimit: config.globalDayRequests,
      globalMonthRequests: counted.filter(r=>r.month===month).length, globalMonthLimit: config.globalMonthRequests,
      pendingRequests: counted.filter(r=>r.state==='pending').length, concurrencyLimit: config.concurrency,
      maxInputTokens: price.maxInputTokens, maxOutputTokens: model.output, maxAttempts: model.attempts };
    const deny = (code: 'AI_BUDGET_LIMIT'|'USER_DAILY_LIMIT'|'GLOBAL_REQUEST_LIMIT'|'AI_BUSY'|'DUPLICATE_REQUEST', reasons: LimitReason[], retry?:number): never => {
      logUsageDenial(feature,code,reasons,numbers,fresh.monthlyBudget?'account':'environment');
      throw new SecurityError(code,429,retry);
    };
    const busy: LimitReason[]=[];
    if(numbers.pendingRequests! >= config.concurrency)busy.push('GLOBAL_CONCURRENCY');
    if(counted.some(r=>r.user_id===user.id&&r.state==='pending'))busy.push('USER_CONCURRENCY');
    if(busy.length)deny('AI_BUSY',busy);
    const duplicate=rows.find(r=>r.user_id===user.id&&r.digest===digest&&new Date(r.created_at).getTime()>clock.getTime()-60000&&r.attempts>0);
    if(duplicate)deny('DUPLICATE_REQUEST',['DUPLICATE_WINDOW'],Math.max(1,Math.ceil((new Date(duplicate.created_at).getTime()+60000-clock.getTime())/1000)));
    if(numbers.userDayRequests! >= limit)deny('USER_DAILY_LIMIT',['USER_DAY_REQUESTS'],periodRetrySeconds(clock));
    const requests: LimitReason[]=[];
    if(numbers.globalDayRequests! >= config.globalDayRequests)requests.push('GLOBAL_DAY_REQUESTS');
    if(numbers.globalMonthRequests! >= config.globalMonthRequests)requests.push('GLOBAL_MONTH_REQUESTS');
    if(requests.length)deny('GLOBAL_REQUEST_LIMIT',requests,periodRetrySeconds(clock,requests.includes('GLOBAL_MONTH_REQUESTS')));
    const sum=(filter:(r:typeof rows[number])=>boolean)=>rows.filter(filter).reduce((s,r)=>s+Number(r.charged_usd),0);
    const userSpent=sum(r=>r.user_id===user.id&&r.month===month), daySpent=sum(r=>r.day===day), monthSpent=sum(r=>r.month===month);
    Object.assign(numbers,{userMonthChargedUsd:userSpent,userMonthLimitUsd:userBudget,globalDayChargedUsd:daySpent,globalDayLimitUsd:config.globalDay,
      globalMonthChargedUsd:monthSpent,globalMonthLimitUsd:config.globalMonth});
    const money: LimitReason[]=[];
    if(userSpent+reserved>userBudget)money.push('USER_MONTH_USD');
    if(daySpent+reserved>config.globalDay)money.push('GLOBAL_DAY_USD');
    if(monthSpent+reserved>config.globalMonth)money.push('GLOBAL_MONTH_USD');
    if(money.length)deny('AI_BUDGET_LIMIT',money);
    const id=randomUUID();
    await db.query(`INSERT INTO ai_request(id,user_id,feature,digest,day,month,reserved_usd,charged_usd,expires_at,price_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$7,now()+interval '5 minutes',$8)`,[id,user.id,feature,digest,day,month,reserved,JSON.stringify({model: model.model,...price,maxOutputTokens:model.output,maxAttempts:model.attempts})]);
    return new ModelPermit(id,user.id,feature,config);
  });
}
interface Completion { usage?: { prompt_tokens: number; completion_tokens: number; prompt_tokens_details?: { cached_tokens?: number }; completion_tokens_details?: { reasoning_tokens?: number } } | null }
export class ModelPermit {
  fault: SecurityError | undefined;
  revalidate: (()=>Promise<void>) | undefined;
  beforeModelCall: (()=>void) | undefined;
  private async infrastructure<T>(fn:()=>Promise<T>):Promise<T> {
    try{return await fn();}catch(e){this.fault=e instanceof SecurityError?e:new SecurityError("SECURITY_UNAVAILABLE");throw this.fault;}
  }
  constructor(readonly id:string,readonly userId:string,readonly feature:Feature,readonly config:ReturnType<typeof budgetConfig>) {}
  async run<T extends Completion>(params: { model:string; max_completion_tokens?:number|null }, call:()=>Promise<T>, signal?:AbortSignal):Promise<T> {
    const check=()=>{if(signal?.aborted)throw new SecurityError('REQUEST_TIMEOUT',408);this.beforeModelCall?.();};
    check();
    if(this.revalidate)await this.infrastructure(()=>awaitSignal(this.revalidate!(),signal));
    check();
    const model=featureModel(this.feature), p=this.config.prices[model.model];
    // UTF-8 byte length is a deliberately conservative token upper estimate;
    // include schema/messages and an overhead allowance, reject over configured cap.
    const inputBytesWithOverhead=Buffer.byteLength(JSON.stringify(params),'utf8')+4096;
    const mismatches: ModelBudgetMismatch[]=[];
    if(params.model!==model.model)mismatches.push('MODEL_NAME_MISMATCH');
    if(params.max_completion_tokens!==model.output)mismatches.push('MAX_OUTPUT_TOKENS_MISMATCH');
    if(inputBytesWithOverhead>p.maxInputTokens)mismatches.push('INPUT_BYTES_EXCEEDED');
    if(mismatches.length) {
      this.fault=new SecurityError('MODEL_BUDGET_MISMATCH');
      logModelBudgetMismatch(this.feature,mismatches,inputBytesWithOverhead,p.maxInputTokens,params.max_completion_tokens);
      throw this.fault;
    }
    const number = await this.infrastructure(()=>locked(async db=>{
      check();
      const request=(await db.query(`SELECT * FROM ai_request WHERE id=$1 AND state='pending' AND expires_at>now()`,[this.id])).rows[0];
      const user=(await db.query('SELECT status FROM "user" WHERE id=$1',[this.userId])).rows[0];
      const running=(await db.query("SELECT 1 FROM ai_attempt WHERE request_id=$1 AND state='started'",[this.id])).rowCount;
      if(!request||user?.status!=='active'||request.attempts>=model.attempts||running) throw new SecurityError('MODEL_NOT_AUTHORIZED',403);
      check();
      const n=request.attempts+1;
      await db.query('UPDATE ai_request SET attempts=$2 WHERE id=$1',[this.id,n]);
      await db.query('INSERT INTO ai_attempt(request_id,number,model) VALUES($1,$2,$3)',[this.id,n,model.model]);check();return n;
    }));
    let response:T;
    try { check();response=await awaitSignal(call(),signal); }
    catch (error) {
      await this.infrastructure(()=>locked(db=>db.query("UPDATE ai_attempt SET state='uncertain', finished_at=now() WHERE request_id=$1 AND number=$2",[this.id,number])));
      throw error;
    }
    const u=response.usage, input=u?.prompt_tokens, output=u?.completion_tokens, cached=u?.prompt_tokens_details?.cached_tokens??0, reasoning=u?.completion_tokens_details?.reasoning_tokens??0;
    const known=typeof input==='number'&&typeof output==='number'&&[input,output,cached,reasoning].every(n=>Number.isSafeInteger(n)&&n>=0)&&cached<=input&&reasoning<=output&&input<=p.maxInputTokens&&output<=model.output;
    const estimate=known?Math.ceil(cost(p,input!,output!,cached)*1e8)/1e8:null;
    await this.infrastructure(()=>locked(db=>db.query(`UPDATE ai_attempt SET state=$3,finished_at=now(),prompt_tokens=$4,completion_tokens=$5,cached_tokens=$6,reasoning_tokens=$7,estimated_usd=$8 WHERE request_id=$1 AND number=$2`,
      [this.id,number,known?'reported':'uncertain',known?input:null,known?output:null,known?cached:null,known?reasoning:null,estimate])));
    logUsageAccounting(this.feature,'model.usage',known?'reported':'uncertain',{
      promptTokens:known?input:null,completionTokens:known?output:null,cachedTokens:known?cached:null,reasoningTokens:known?reasoning:null,estimatedUsd:estimate });
    return response;
  }
  async finish(success:boolean) {
    const settled=await locked(async db=>{
      const row=(await db.query('SELECT * FROM ai_request WHERE id=$1',[this.id])).rows[0];
      if(!row||row.state!=='pending') return;
      const attempts=(await db.query('SELECT state,estimated_usd FROM ai_attempt WHERE request_id=$1',[this.id])).rows;
      const known=attempts.length===row.attempts&&attempts.every(a=>a.state==='reported');
      const actual=attempts.reduce((s,a)=>s+Number(a.estimated_usd||0),0);
      await db.query(`UPDATE ai_request SET state=$2,finished_at=now(),estimated_usd=$3,charged_usd=$4 WHERE id=$1`,
        [this.id,success?'success':row.attempts?'failed':'no-model',actual,row.attempts===0?0:known?actual:row.reserved_usd]);
      return { attempts:Number(row.attempts),reservedUsd:Number(row.reserved_usd),estimatedUsd:known?actual:null,
        chargedUsd:row.attempts===0?0:known?actual:Number(row.reserved_usd) };
    });
    if(settled)logUsageAccounting(this.feature,'usage.finish',success?'success':settled.attempts?'failed':'no-model',settled);
  }
}
