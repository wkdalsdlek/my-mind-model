import { Pool, type PoolClient } from "pg";
import { attachDatabasePool } from "@vercel/functions";
import { authConfig, SecurityError } from "./policy";
let pool: Pool | undefined;
export function securityPool() {
  if (!pool) {
    const { database } = authConfig();
    pool = new Pool({ connectionString: database, max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000,
      // PgBouncer rejects statement_timeout in the startup packet. Bound reads
      // client-side; set the server timeout locally inside each transaction.
      query_timeout: 15000, application_name: "my-mind-model-security" });
    if (process.env.VERCEL === "1") attachDatabasePool(pool);
    pool.on("error", () => {}); // Never log connection strings or provider errors.
  }
  return pool;
}
export async function locked<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await securityPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '10s'");
    if ((await client.query("SELECT id FROM beta_guard WHERE id=1 FOR UPDATE")).rowCount !== 1) throw new SecurityError("SECURITY_SCHEMA_UNAVAILABLE");
    const result = await fn(client);
    await client.query("COMMIT");return result;
  } catch (e) { await client.query("ROLLBACK").catch(() => {});throw e; }
  finally { client.release(); }
}
