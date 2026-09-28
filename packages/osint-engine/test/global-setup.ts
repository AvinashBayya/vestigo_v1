import { recreateTestDatabase } from "@repo/db/testing";
import { TEST_ENGINE } from "./config.ts";

/** Recreates the test database from nothing and applies every migration. */
export default async function setup(): Promise<void> {
  await recreateTestDatabase({
    ownerUrl: TEST_ENGINE.databaseOwnerUrl,
    connectRoles: [new URL(TEST_ENGINE.databaseUrl).username, "app_auth"],
  });
}
