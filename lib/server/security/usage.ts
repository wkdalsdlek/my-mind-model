import { createHmac, randomUUID } from "node:crypto";
import { locked } from "./database";
import { authConfig, budgetConfig, cost, featureModel, SecurityError, seoulPeriods, type Feature } from "./policy";
import type { Principal } from "./auth";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([k]) => !["requestId","approvedAt","inputFingerprint","selectionId"].includes(k)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k,v]) => [k,canonical(v)]));
  return value;
}
export function requestDigest(feature: Feature, body: unknown) { return createHmac("sha256", authConfig().secret).update(feature+":"+JSON.stringify(canonical(body))).digest("hex"); }
export async function reserveUsage(user: Principal, feature: Feature, digest: string) {
  const config = budgetConfig(), model = featureModel(feature), price = config.prices[model.model];
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
    if (counted.filter(r=>r.state==='pending').length>=config.concurrency || counted.some(r=>r.user_id===user.id&&r.state==='pending')) throw new SecurityError('AI_BUSY',429);
    if (rows.some(r=>r.user_id===user.id&&r.digest===digest&&new Date(r.created_at).getTime()>clock.getTime()-60000&&r.attempts>0)) throw new SecurityError('DUPLICATE_REQUEST',429);
    const limit = feature==='closing'?fresh.closingDaily:feature==='interpretation'?fresh.interpretationDaily:fresh.analyzeDaily;
    if(counted.filter(r=>r.user_id===user.id&&r.feature===feature&&r.day===day).length>=limit) throw new SecurityError('USER_DAILY_LIMIT',429);
    if(counted.filter(r=>r.day===day).length>=config.globalDayRequests||counted.filter(r=>r.month===month).length>=config.globalMonthRequests) throw new SecurityError('GLOBAL_REQUEST_LIMIT',429);
    const sum=(filter:(r:typeof rows[number])=>boolean)=>rows.filter(filter).reduce((s,r)=>s+Number(r.charged_usd),0);
    const userBudget = fresh.monthlyBudget ? Number(fresh.monthlyBudget) : config.userMonth;
    if(sum(r=>r.user_id===user.id&&r.month===month)+reserved>userBudget || sum(r=>r.day===day)+reserved>config.globalDay || sum(r=>r.month===month)+reserved>config.globalMonth) throw new SecurityError('AI_BUDGET_LIMIT',429);
    const id=randomUUID();
    await db.query(`INSERT INTO ai_request(id,user_id,feature,digest,day,month,reserved_usd,charged_usd,expires_at,price_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$7,now()+interval '5 minutes',$8)`,[id,user.id,feature,digest,day,month,reserved,JSON.stringify({model: model.model,...price,maxOutputTokens:model.output,maxAttempts:model.attempts})]);
    return new ModelPermit(id,user.id,feature,config);
  });
}
interface Completion { usage?: { prompt_tokens: number; completion_tokens: number; prompt_tokens_details?: { cached_tokens?: number }; completion_tokens_details?: { reasoning_tokens?: number } } | null }
export class ModelPermit {
  fault: SecurityError | undefined;
  revalidate: (()=>Promise<void>) | undefined;
  private async infrastructure<T>(fn:()=>Promise<T>):Promise<T> {
    try{return await fn();}catch(e){this.fault=e instanceof SecurityError?e:new SecurityError("SECURITY_UNAVAILABLE");throw this.fault;}
  }
  constructor(readonly id:string,readonly userId:string,readonly feature:Feature,readonly config:ReturnType<typeof budgetConfig>) {}
  async run<T extends Completion>(params: { model:string; max_completion_tokens?:number|null }, call:()=>Promise<T>):Promise<T> {
    if(this.revalidate)await this.infrastructure(this.revalidate);
    const model=featureModel(this.feature), p=this.config.prices[model.model];
    // UTF-8 byte length is a deliberately conservative token upper estimate;
    // include schema/messages and an overhead allowance, reject over configured cap.
    if(params.model!==model.model||params.max_completion_tokens!==model.output||Buffer.byteLength(JSON.stringify(params),'utf8')+4096>p.maxInputTokens) { this.fault=new SecurityError('MODEL_BUDGET_MISMATCH'); throw this.fault; }
    const number = await this.infrastructure(()=>locked(async db=>{
      const request=(await db.query(`SELECT * FROM ai_request WHERE id=$1 AND state='pending' AND expires_at>now()`,[this.id])).rows[0];
      const user=(await db.query('SELECT status FROM "user" WHERE id=$1',[this.userId])).rows[0];
      const running=(await db.query("SELECT 1 FROM ai_attempt WHERE request_id=$1 AND state='started'",[this.id])).rowCount;
      if(!request||user?.status!=='active'||request.attempts>=model.attempts||running) throw new SecurityError('MODEL_NOT_AUTHORIZED',403);
      const n=request.attempts+1;
      await db.query('UPDATE ai_request SET attempts=$2 WHERE id=$1',[this.id,n]);
      await db.query('INSERT INTO ai_attempt(request_id,number,model) VALUES($1,$2,$3)',[this.id,n,model.model]);return n;
    }));
    let response:T;
    try { response=await call(); }
    catch (error) {
      await this.infrastructure(()=>locked(db=>db.query("UPDATE ai_attempt SET state='uncertain', finished_at=now() WHERE request_id=$1 AND number=$2",[this.id,number])));
      throw error;
    }
    const u=response.usage, input=u?.prompt_tokens, output=u?.completion_tokens, cached=u?.prompt_tokens_details?.cached_tokens??0, reasoning=u?.completion_tokens_details?.reasoning_tokens??0;
    const known=typeof input==='number'&&typeof output==='number'&&[input,output,cached,reasoning].every(n=>Number.isSafeInteger(n)&&n>=0)&&cached<=input&&reasoning<=output&&input<=p.maxInputTokens&&output<=model.output;
    const estimate=known?Math.ceil(cost(p,input!,output!,cached)*1e8)/1e8:null;
    await this.infrastructure(()=>locked(db=>db.query(`UPDATE ai_attempt SET state=$3,finished_at=now(),prompt_tokens=$4,completion_tokens=$5,cached_tokens=$6,reasoning_tokens=$7,estimated_usd=$8 WHERE request_id=$1 AND number=$2`,
      [this.id,number,known?'reported':'uncertain',known?input:null,known?output:null,known?cached:null,known?reasoning:null,estimate])));
    return response;
  }
  async finish(success:boolean) {
    await locked(async db=>{
      const row=(await db.query('SELECT * FROM ai_request WHERE id=$1',[this.id])).rows[0];
      if(!row||row.state!=='pending') return;
      const attempts=(await db.query('SELECT state,estimated_usd FROM ai_attempt WHERE request_id=$1',[this.id])).rows;
      const known=attempts.length===row.attempts&&attempts.every(a=>a.state==='reported');
      const actual=attempts.reduce((s,a)=>s+Number(a.estimated_usd||0),0);
      await db.query(`UPDATE ai_request SET state=$2,finished_at=now(),estimated_usd=$3,charged_usd=$4 WHERE id=$1`,
        [this.id,success?'success':row.attempts?'failed':'no-model',actual,row.attempts===0?0:known?actual:row.reserved_usd]);
    });
  }
}
