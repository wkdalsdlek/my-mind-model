import { betterAuth } from "better-auth";
import { securityPool } from "./database";
import { authConfig, SecurityError } from "./policy";
let auth: ReturnType<typeof buildAuth> | undefined;
function buildAuth() {
  const config = authConfig();
  return betterAuth({ database: securityPool(), secret: config.secret, baseURL: config.baseURL, trustedOrigins: config.origins,
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12, maxPasswordLength: 128 },
    session: { expiresIn: 7 * 86400, updateAge: 86400, cookieCache: { enabled: false } },
    user: { additionalFields: { role: { type: "string", defaultValue: "tester", input: false }, status: { type: "string", defaultValue: "active", input: false } } },
    advanced: { useSecureCookies: config.baseURL.startsWith("https:"), defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
      ipAddress: { disableIpTracking: true } },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 60, customRules: { "/sign-in/email": { window: 60, max: 5 } } },
    logger: { disabled: true },
    databaseHooks: { user: { create: { before: async () => false } }, session: { create: { before: async session => {
      const result = await securityPool().query('SELECT status FROM "user" WHERE id=$1', [session.userId]);
      return result.rows[0]?.status === "active" ? { data: { ...session, ipAddress: null, userAgent: null } } : false;
    } } } },
  });
}
export function getAuth() { return auth ??= buildAuth(); }
export interface Principal { id: string; role: "owner" | "tester"; closingDaily: number; interpretationDaily: number; analyzeDaily: number; monthlyBudget: string | null }
export async function principal(headers: Headers, ownerOnly = false): Promise<Principal> {
  authConfig();
  const session = await getAuth().api.getSession({ headers, query: { disableCookieCache: true, disableRefresh: true } });
  if (!session) throw new SecurityError("AUTH_REQUIRED", 401);
  const result = await securityPool().query('SELECT id, role, status, "closingDaily", "interpretationDaily", "analyzeDaily", "monthlyBudget" FROM "user" WHERE id=$1', [session.user.id]);
  const user = result.rows[0];
  if (!user || user.status !== "active") throw new SecurityError("ACCOUNT_DISABLED", 403);
  if (ownerOnly && user.role !== "owner") throw new SecurityError("OWNER_REQUIRED", 403);
  return user;
}
