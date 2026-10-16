import { getAuth } from '../../lib/server/security/auth';
import { securityPool } from '../../lib/server/security/database';
let raw='';for await(const chunk of process.stdin)raw+=chunk;
try{
 const {email,password}=JSON.parse(raw);raw='';
 const response=await getAuth().handler(new Request('https://beta.example.invalid/api/auth/sign-in/email',{method:'POST',headers:{origin:'https://beta.example.invalid','content-type':'application/json'},body:JSON.stringify({email,password})}));
 const cookies=response.headers.getSetCookie();const session=cookies.find(v=>v.includes('session_token'))||'';
 console.info(JSON.stringify({status:response.status,secure:session.includes('Secure'),httpOnly:session.includes('HttpOnly'),sameSite:session.includes('SameSite=Lax'),maxAge:Number(session.match(/Max-Age=(\d+)/)?.[1])}));
}catch{console.info(JSON.stringify({failed:true}));process.exitCode=1;}finally{await securityPool().end();}
