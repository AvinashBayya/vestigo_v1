import { recreateTestDatabase } from "@repo/db/testing";
import { TEST_WORKER } from "./config.ts";

/** Recreates the test database from nothing and applies every migration. */
export default async function setup(): Promise<void> {
  await recreateTestDatabase({
    ownerUrl: TEST_WORKER.databaseOwnerUrl,
    connectRoles: [new URL(TEST_WORKER.databaseUrl).username, "app_auth"],
  });
}
