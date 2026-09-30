/**
 * Operator tool: creates a tenant and its first owner.
 *
 *   PROVISION_OWNER_PASSWORD=... pnpm --filter @repo/api provision-tenant \
 *     --name "[Tenant name]" --slug tenant-slug \
 *     --owner-email owner@example.com --owner-name "[Owner]" --operator "[your name]"
 *
 * The password comes from the environment, never from the command line, where
 * it would be visible in process listings and shell history. The tenant
 * starts on the default plan with vetting not submitted; this tool cannot
 * change either. The owner signs in and must enrol in TOTP before anything else.
 */
import { parseArgs } from "node:util";
import { ConfigError, loadEnvSubset } from "@repo/config";
import { TENANT_REGIONS } from "@repo/core";
import { createAuthStore, createDatabase } from "@repo/db";
import { createAuth } from "../src/auth/better-auth.ts";
import { provisionTenant } from "../src/auth/provisioning.ts";

const { values } = parseArgs({
  options: {
    name: { type: "string" },
    slug: { type: "string" },
    "owner-email": { type: "string" },
    "owner-name": { type: "string" },
    operator: { type: "string" },
  },
  strict: true,
});

const missing = ["name", "slug", "owner-email", "owner-name", "operator"].filter(
  (flag) => values[flag as keyof typeof values] === undefined,
);
const password = process.env.PROVISION_OWNER_PASSWORD;
if (missing.length > 0 || password === undefined || password === "") {
  throw new ConfigError([
    ...missing.map((flag) => ({ variable: `--${flag}`, problem: "required but not given" })),
    ...(password === undefined || password === ""
      ? [{ variable: "PROVISION_OWNER_PASSWORD", problem: "required but not set" }]
      : []),
  ]);
}

const env = loadEnvSubset([
  "DATABASE_URL",
  "DATABASE_AUTH_URL",
  "AUTH_SECRET",
  "AUTH_BASE_URL",
  "WEB_ORIGIN",
  "LOG_LEVEL",
]);
const onIdleClientError = (error: Error) => {
  process.stderr.write(`idle database connection error: ${error.message}\n`);
};
const db = createDatabase({ connectionString: env.DATABASE_URL, onIdleClientError });
const authStore = createAuthStore({ connectionString: env.DATABASE_AUTH_URL, onIdleClientError });

try {
  await authStore.verifyRole();
  const auth = createAuth({
    authStore,
    db,
    secret: env.AUTH_SECRET,
    baseUrl: env.AUTH_BASE_URL,
    trustedOrigins: [env.WEB_ORIGIN],
    rateLimit: { enabled: false },
    logLevel: env.LOG_LEVEL,
  });
  const result = await provisionTenant(auth, authStore, {
    name: String(values.name),
    slug: String(values.slug),
    region: TENANT_REGIONS[0],
    owner: { email: String(values["owner-email"]), name: String(values["owner-name"]), password },
    operator: String(values.operator),
  });
  // The enrolment token is shown once, here: hand it to the owner with the
  // password, out of band. Without it the owner cannot enrol MFA.
  console.log(
    JSON.stringify({
      tenant_id: result.tenantId,
      owner_user_id: result.ownerUserId,
      owner_mfa_enrolment_token: result.enrolmentToken,
    }),
  );
} finally {
  await Promise.all([db.close(), authStore.close()]);
}
