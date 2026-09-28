import { recreateTestDatabase } from "../src/testing.ts";
import { TEST_DATABASE } from "./config.ts";

/** Recreates the test database from nothing and applies every migration. */
export default async function setup(): Promise<void> {
  await recreateTestDatabase({
    ownerUrl: TEST_DATABASE.ownerUrl,
    connectRoles: [
      new URL(TEST_DATABASE.runtimeUrl).username,
      new URL(TEST_DATABASE.authUrl).username,
    ],
  });
}
