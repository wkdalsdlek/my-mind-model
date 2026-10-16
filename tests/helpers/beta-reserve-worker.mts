import { reserveUsage } from '../../lib/server/security/usage';
import { securityPool } from '../../lib/server/security/database';
import { randomUUID } from 'node:crypto';
if(!process.env.PRIVATE_BETA_TEST_DATABASE_URL||new URL(process.env.PRIVATE_BETA_TEST_DATABASE_URL).pathname!=='/mmm_security_test')throw new Error('TEST_DATABASE_REQUIRED');
process.env.DATABASE_URL=process.env.PRIVATE_BETA_TEST_DATABASE_URL;
try{
 const id=process.env.BETA_TEST_USER_ID!;
 const permit=await reserveUsage({id,role:'tester',closingDaily:1,interpretationDaily:3,analyzeDaily:3,monthlyBudget:null},'closing',randomUUID());
 await new Promise(r=>setTimeout(r,700));
 await permit.run({model:'gpt-4o-mini',max_completion_tokens:180},async()=>({usage:{prompt_tokens:1,completion_tokens:1}}));await permit.finish(true);
 console.info(JSON.stringify({reserved:true}));
}catch{console.info(JSON.stringify({reserved:false}));}finally{await securityPool().end();}
