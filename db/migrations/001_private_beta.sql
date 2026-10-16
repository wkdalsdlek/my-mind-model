BEGIN;
CREATE TABLE IF NOT EXISTS "user" (
 id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE, "emailVerified" boolean NOT NULL DEFAULT false,
 image text, "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(),
 role text NOT NULL DEFAULT 'tester' CHECK(role IN ('owner','tester')), status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
 "closingDaily" integer NOT NULL DEFAULT 5 CHECK("closingDaily">=0), "interpretationDaily" integer NOT NULL DEFAULT 3 CHECK("interpretationDaily">=0),
 "analyzeDaily" integer NOT NULL DEFAULT 3 CHECK("analyzeDaily">=0), "monthlyBudget" numeric(18,8) CHECK("monthlyBudget">0)
);
CREATE TABLE IF NOT EXISTS session (
 id text PRIMARY KEY, "expiresAt" timestamptz NOT NULL, token text NOT NULL UNIQUE, "createdAt" timestamptz NOT NULL DEFAULT now(),
 "updatedAt" timestamptz NOT NULL DEFAULT now(), "ipAddress" text, "userAgent" text, "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS session_user_idx ON session("userId");
CREATE TABLE IF NOT EXISTS account (
 id text PRIMARY KEY, "accountId" text NOT NULL, "providerId" text NOT NULL, "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz,
 scope text, password text, "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(), UNIQUE("providerId","accountId")
);
CREATE TABLE IF NOT EXISTS verification (id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL, "expiresAt" timestamptz NOT NULL,
 "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS "rateLimit" (id text PRIMARY KEY, key text NOT NULL UNIQUE, count integer NOT NULL, "lastRequest" bigint NOT NULL);
CREATE TABLE IF NOT EXISTS beta_guard (id integer PRIMARY KEY CHECK(id=1));
INSERT INTO beta_guard VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS beta_login_limit (key text PRIMARY KEY, started timestamptz NOT NULL, count integer NOT NULL);
CREATE TABLE IF NOT EXISTS ai_request (
 id uuid PRIMARY KEY, user_id text REFERENCES "user"(id) ON DELETE SET NULL, feature text NOT NULL CHECK(feature IN ('closing','interpretation','analyze')),
 digest text NOT NULL, day text NOT NULL, month text NOT NULL, state text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0,
 reserved_usd numeric(18,8) NOT NULL, charged_usd numeric(18,8) NOT NULL, estimated_usd numeric(18,8) NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, finished_at timestamptz
);
ALTER TABLE ai_request ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE ai_request DROP CONSTRAINT IF EXISTS ai_request_user_id_fkey;
ALTER TABLE ai_request ADD CONSTRAINT ai_request_user_id_fkey FOREIGN KEY(user_id) REFERENCES "user"(id) ON DELETE SET NULL;
ALTER TABLE ai_request ADD COLUMN IF NOT EXISTS price_snapshot jsonb NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS ai_user_period_idx ON ai_request(user_id,month,day);
CREATE INDEX IF NOT EXISTS ai_digest_idx ON ai_request(user_id,digest,created_at);
CREATE TABLE IF NOT EXISTS ai_attempt (
 request_id uuid NOT NULL REFERENCES ai_request(id) ON DELETE CASCADE, number integer NOT NULL, model text NOT NULL,
 state text NOT NULL DEFAULT 'started', started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 prompt_tokens integer, completion_tokens integer, cached_tokens integer, reasoning_tokens integer, estimated_usd numeric(18,8),
 PRIMARY KEY(request_id,number)
);
COMMIT;
