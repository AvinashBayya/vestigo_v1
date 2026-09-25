/**
 * Writes the OpenAPI document to apps/api/openapi.json at build time. The web
 * app generates its client from this file. It is a build artifact: gitignored,
 * never hand-edited.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildApp } from "../src/app.ts";

const app = await buildApp({ logger: false });
await app.ready();
const target = new URL("../openapi.json", import.meta.url);
writeFileSync(target, `${JSON.stringify(app.swagger(), null, 2)}\n`);
await app.close();
console.log(`Wrote ${fileURLToPath(target)}`);
