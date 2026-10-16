/** Trusted-server CLI. No password arguments, no web admin endpoint. */
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { hashPassword } from "better-auth/crypto";
import { securityPool, locked } from "../lib/server/security/database";
import { SecurityError } from "../lib/server/security/policy";

async function hiddenPassword(label="초기 비밀번호 (표시되지 않음): "):Promise<string>{
  if(!stdin.isTTY)throw new SecurityError('PASSWORD_REQUIRES_INTERACTIVE_TTY');
  stdout.write(label);stdin.setRawMode(true);stdin.setEncoding('utf8');stdin.resume();
  return new Promise((resolve,reject)=>{
    let value='';const done=()=>{stdin.setRawMode(false);stdin.pause();stdin.off('data',read);stdout.write('\n');};
    const read=(buffer:string)=>{for(const char of buffer){
      if(char==='\u0003'){done();reject(new SecurityError('CANCELLED'));return;}
      if(char==='\r'||char==='\n'){done();resolve(value);return;}
      if(char==='\u007f')value=value.slice(0,-1);else if(char>=' ')value+=char;
    }};stdin.on('data',read);
  });
}
async function main(){
  const [command,...args]=process.argv.slice(2);
  if(args.length)throw new SecurityError('NO_ACCOUNT_OR_PASSWORD_COMMAND_ARGUMENTS');
  if(command==='migrate'){await securityPool().query(await readFile(new URL('../db/migrations/001_private_beta.sql',import.meta.url),'utf8'));console.info('Migration complete.');return;}
  const supported=['bootstrap-owner','create-tester','disable','enable','revoke','usage','limits','prune'];
  if(!supported.includes(command))throw new SecurityError('UNKNOWN_ADMIN_COMMAND');
  if(command==='prune'){
    await locked(async db=>{
      await db.query("UPDATE ai_request SET state='expired',finished_at=now(),charged_usd=CASE WHEN attempts=0 THEN 0 ELSE reserved_usd END WHERE state='pending' AND expires_at<=now()");
      await db.query(`DELETE FROM ai_request WHERE state<>'pending' AND created_at<now()-interval '90 days'`);
      await db.query(`DELETE FROM beta_login_limit WHERE started<now()-interval '1 day'`);
      await db.query(`DELETE FROM "rateLimit" WHERE "lastRequest"<EXTRACT(EPOCH FROM now()-interval '1 day')*1000`);
      await db.query('DELETE FROM session WHERE "expiresAt"<now()');
    });console.info('Expired operational records pruned.');return;
  }
  const prompt=createInterface({input:stdin,output:stdout});
  const email=(await prompt.question('계정 이메일: ')).trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254){prompt.close();throw new SecurityError('INVALID_ACCOUNT');}
  let name='',password='',limits:number[]=[];
  if(command==='bootstrap-owner'||command==='create-tester')name=await prompt.question('표시 이름: ');
  if(command==='limits'){
    const values=await prompt.question('Q10/해석/레거시 일일 한도, 월 예산 USD (공백 구분): ');limits=values.trim().split(/\s+/).map(Number);
    if(limits.length!==4||limits.some((n,i)=>!Number.isFinite(n)||n<0||(i<3&&!Number.isInteger(n)))||limits[3]<=0){prompt.close();throw new SecurityError('INVALID_LIMITS');}
  }
  prompt.close();
  if(command==='bootstrap-owner'||command==='create-tester'){
    password=await hiddenPassword();if(password.length<12||password.length>128)throw new SecurityError('PASSWORD_LENGTH');
    const confirm=await hiddenPassword("비밀번호 확인 (표시되지 않음): ");if(password!==confirm)throw new SecurityError('PASSWORD_CONFIRMATION');
    const hash=await hashPassword(password);password='';
    await locked(async db=>{
      const exists=(await db.query(`SELECT id FROM "user" WHERE role='owner'`)).rowCount;
      if(command==='bootstrap-owner'&&exists)throw new SecurityError('OWNER_ALREADY_EXISTS');
      if(command==='create-tester'&&!exists)throw new SecurityError('BOOTSTRAP_OWNER_FIRST');
      const id=randomUUID(),role=command==='bootstrap-owner'?'owner':'tester';
      await db.query(`INSERT INTO "user"(id,name,email,"emailVerified",role,"closingDaily","interpretationDaily","analyzeDaily") VALUES($1,$2,$3,true,$4,$5,$6,$7)`,[id,name||'Tester',email,role,role==='owner'?20:5,role==='owner'?10:3,role==='owner'?10:3]);
      await db.query(`INSERT INTO account(id,"accountId","providerId","userId",password) VALUES($1,$2,'credential',$2,$3)`,[randomUUID(),id,hash]);
    });console.info('Account created.');return;
  }
  await locked(async db=>{
    const user=(await db.query('SELECT id FROM "user" WHERE email=$1',[email])).rows[0];if(!user)throw new SecurityError('ACCOUNT_NOT_FOUND');
    if(command==='disable'||command==='enable')await db.query('UPDATE "user" SET status=$2,"updatedAt"=now() WHERE id=$1',[user.id,command==='disable'?'disabled':'active']);
    if(command==='disable'||command==='revoke')await db.query('DELETE FROM session WHERE "userId"=$1',[user.id]);
    if(command==='limits')await db.query('UPDATE "user" SET "closingDaily"=$2,"interpretationDaily"=$3,"analyzeDaily"=$4,"monthlyBudget"=$5,"updatedAt"=now() WHERE id=$1',[user.id,...limits]);
    if(command==='usage'){
      const rows=(await db.query(`SELECT day,feature,state,count(*)::int AS requests,sum(attempts)::int AS model_attempts,sum(estimated_usd) AS estimated_usd,sum(charged_usd) AS budget_charge_usd FROM ai_request WHERE user_id=$1 GROUP BY day,feature,state ORDER BY day DESC`,[user.id])).rows;
      console.info(JSON.stringify(rows));
    }
  });console.info('Admin operation complete.');
}
main().catch(()=>{console.error('관리 작업 실패: 설정·계정 상태·명령을 확인하세요. 민감한 상세 오류는 출력하지 않습니다.');process.exitCode=1;}).finally(async()=>{try{await securityPool().end();}catch{}});
