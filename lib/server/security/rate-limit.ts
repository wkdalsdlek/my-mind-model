import { locked } from "./database";
import { SecurityError } from "./policy";
/** Fixed one-minute windows persisted atomically; never trust caller IP headers. */
export async function consumeWindow(buckets:readonly (readonly [string,number])[],code:string) {
  await locked(async db=>{
    for(const [key,max]of buckets){
      const row=(await db.query(`INSERT INTO beta_login_limit(key,started,count) VALUES($1,now(),1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN beta_login_limit.started<now()-interval '1 minute' THEN 1 ELSE beta_login_limit.count+1 END,started=CASE WHEN beta_login_limit.started<now()-interval '1 minute' THEN now() ELSE beta_login_limit.started END RETURNING count`,[key])).rows[0];
      if(row.count>max)throw new SecurityError(code,429);
    }
  });
}
