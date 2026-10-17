import { consumeWindow } from "./rate-limit";
import { principal } from "./auth";
import { authConfig, checkOrigin, SecurityError, securityFailure, type Feature } from "./policy";
import { reserveUsage, requestDigest, type ModelPermit } from "./usage";
import { InterpretationDeadline, awaitSignal } from "../interpretation-deadline";
export async function boundedJSON(req:Request, limit:number, workSignal?:AbortSignal) {
  if(req.signal.aborted||workSignal?.aborted)throw new SecurityError('REQUEST_TIMEOUT',408);
  const reader=req.body?.getReader();if(!reader)throw new SecurityError('INVALID_INPUT',400);
  const buffers:Uint8Array[]=[];let size=0;
  const signal=AbortSignal.any([req.signal,...(workSignal?[workSignal]:[]),AbortSignal.timeout(10000)]);
  const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
  try { while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new SecurityError('REQUEST_TOO_LARGE',413);}buffers.push(value);} }
  finally{signal.removeEventListener('abort',abort);reader.releaseLock();}
  if(signal.aborted)throw new SecurityError('REQUEST_TIMEOUT',408);
  const bytes=Buffer.concat(buffers);try{return { bytes, body:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown };}catch{throw new SecurityError('INVALID_INPUT',400);}
}
export function protectAI(feature:Feature,handler:(req:Request,permit:ModelPermit,deadline?:InterpretationDeadline)=>Promise<Response>) {
  return async(req:Request):Promise<Response>=>{
    const deadline=feature==='interpretation'?new InterpretationDeadline(req.signal):undefined;
    const processRequest=async():Promise<Response>=>{
      let permit:ModelPermit|undefined;
      try {
        deadline?.checkWork();deadline?.stage('authentication');
        const user=await awaitSignal(principal(req.headers,feature==='analyze'),deadline?.signal);
        deadline?.checkWork();deadline?.stage('origin');
        checkOrigin(req,authConfig().origins);
        deadline?.stage('rate-limit');
        await consumeWindow([[`ai-user:${user.id}`,20],['ai-global',100]],'REQUEST_RATE_LIMIT');
        deadline?.checkWork();deadline?.stage('body');
        const {bytes,body}=await boundedJSON(req,feature==='interpretation'?524288:131072,deadline?.signal);
        deadline?.checkWork();deadline?.stage('reservation');
        permit=await reserveUsage(user,feature,requestDigest(feature,body));
        if(deadline)permit.beforeModelCall=()=>deadline.checkWork();
        permit.revalidate=async()=>{await principal(req.headers,feature==='analyze');};
        deadline?.checkWork();
        const response=await handler(new Request(req.url,{method:'POST',headers:req.headers,body:new Uint8Array(bytes),signal:req.signal}),permit,deadline);
        if(permit.fault)throw permit.fault;
        deadline?.stage('settlement');
        await permit.finish(response.ok);
        deadline?.checkResponse();deadline?.stage('session-check');
        await principal(req.headers,feature==='analyze');
        deadline?.checkResponse();deadline?.stage('response');
        return response;
      }catch(e){
        deadline?.log();
        if(permit){deadline?.stage('settlement');await permit.finish(false).catch(()=>{});}
        return securityFailure(e);
      }
    };
    try{return deadline?await deadline.respond(processRequest()):await processRequest();}
    catch(e){return securityFailure(e);}
    finally{deadline?.dispose();}
  };
}
