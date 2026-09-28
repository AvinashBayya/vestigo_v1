import { recreateTestDatabase } from "@repo/db/testing";
import { TEST_CONFIG } from "./config.ts";

/** Recreates the test database from nothing and applies every migration. */
export default async function setup(): Promise<void> {
  await recreateTestDatabase({
    ownerUrl: TEST_CONFIG.databaseOwnerUrl,
    connectRoles: [new URL(TEST_CONFIG.databaseUrl).username, "app_auth"],
  });
}
