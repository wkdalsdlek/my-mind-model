import { consumeWindow } from "./rate-limit";
import { principal } from "./auth";
import { authConfig, checkOrigin, SecurityError, securityFailure, type Feature } from "./policy";
import { reserveUsage, requestDigest, type ModelPermit } from "./usage";
export async function boundedJSON(req:Request, limit:number) {
  if(req.signal.aborted)throw new SecurityError('REQUEST_TIMEOUT',408);
  const reader=req.body?.getReader();if(!reader)throw new SecurityError('INVALID_INPUT',400);
  const buffers:Uint8Array[]=[];let size=0;
  const signal=AbortSignal.any([req.signal,AbortSignal.timeout(10000)]);
  const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
  try { while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new SecurityError('REQUEST_TOO_LARGE',413);}buffers.push(value);} }
  finally{signal.removeEventListener('abort',abort);reader.releaseLock();}
  if(signal.aborted)throw new SecurityError('REQUEST_TIMEOUT',408);
  const bytes=Buffer.concat(buffers);try{return { bytes, body:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown };}catch{throw new SecurityError('INVALID_INPUT',400);}
}
export function protectAI(feature:Feature,handler:(req:Request,permit:ModelPermit)=>Promise<Response>) {
  return async(req:Request):Promise<Response>=>{
    let permit:ModelPermit|undefined;
    try {
      const user=await principal(req.headers,feature==='analyze');
      checkOrigin(req,authConfig().origins);
      await consumeWindow([[`ai-user:${user.id}`,20],['ai-global',100]],'REQUEST_RATE_LIMIT');
      const {bytes,body}=await boundedJSON(req,feature==='interpretation'?524288:131072);
      permit=await reserveUsage(user,feature,requestDigest(feature,body));
      permit.revalidate=async()=>{await principal(req.headers,feature==='analyze');};
      const response=await handler(new Request(req.url,{method:'POST',headers:req.headers,body:new Uint8Array(bytes),signal:req.signal}),permit);
      if(permit.fault)throw permit.fault;
      await permit.finish(response.ok);
      await principal(req.headers,feature==='analyze');
      return response;
    }catch(e){
      if(permit)await permit.finish(false).catch(()=>{});
      return securityFailure(e);
    }
  };
}
