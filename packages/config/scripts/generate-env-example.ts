import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { envSchema } from "../src/env.ts";
import { renderEnvExample } from "./env-example.ts";
import { findRepoRoot } from "./repo-root.ts";

const target = join(findRepoRoot(process.cwd()), ".env.example");
writeFileSync(target, renderEnvExample(envSchema));
console.log(`Wrote ${target}`);
