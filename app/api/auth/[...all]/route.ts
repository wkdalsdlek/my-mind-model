import { createHmac } from "node:crypto";
import { getAuth, principal } from "../../../../lib/server/security/auth";
import { consumeWindow } from "../../../../lib/server/security/rate-limit";
import { boundedJSON } from "../../../../lib/server/security/api";
import { authConfig, checkOrigin, SecurityError, securityFailure } from "../../../../lib/server/security/policy";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(req:Request){
  try{
    if(new URL(req.url).pathname!=='/api/auth/get-session')throw new SecurityError('AUTH_ENDPOINT_DISABLED',404);
    const user=await principal(req.headers);
    return Response.json({user:{id:user.id,role:user.role}},{headers:{'Cache-Control':'no-store'}});
  }catch(e){return securityFailure(e);}
}
export async function POST(req:Request){
  try{
    const path=new URL(req.url).pathname;
    if(!['/api/auth/sign-in/email','/api/auth/sign-out'].includes(path))throw new SecurityError('AUTH_ENDPOINT_DISABLED',404);
    const config=authConfig();checkOrigin(req,config.origins);
    const {body}=await boundedJSON(req,4096);
    if(path.endsWith('/sign-in/email')){
      if(!body||typeof body!=='object'||!('email' in body)||typeof body.email!=='string'||!('password' in body)||typeof body.password!=='string'
        || Object.keys(body).some(k=>!['email','password'].includes(k))||body.email.length>254||body.password.length>128)throw new SecurityError('LOGIN_FAILED',401);
      const key=createHmac('sha256',config.secret).update(body.email.toLowerCase().trim()).digest('hex');
      await consumeWindow([[key,5],['login-global',100]],'LOGIN_RATE_LIMIT');
    }
    const forwarded=new Request(req.url,{method:'POST',headers:req.headers,body:JSON.stringify(body)});
    const response=await getAuth().handler(forwarded);
    // Never return session token, user record or provider diagnostics in JSON.
    const headers=new Headers(response.headers);headers.delete('Content-Length');headers.set('Cache-Control','no-store');headers.set('Content-Type','application/json');
    return new Response(JSON.stringify(response.ok?{ok:true}:{code:'LOGIN_FAILED',error:'로그인 정보 또는 계정 상태를 확인해 주세요.'}),{status:response.status,headers});
  }catch(e){return securityFailure(e);}
}
