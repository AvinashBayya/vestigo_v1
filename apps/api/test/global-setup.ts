import { recreateTestDatabase } from "@repo/db/testing";
import { TEST_API } from "./config.ts";

export default async function setup(): Promise<void> {
  await recreateTestDatabase({
    ownerUrl: TEST_API.ownerUrl,
    connectRoles: [new URL(TEST_API.runtimeUrl).username, new URL(TEST_API.authUrl).username],
  });
}
