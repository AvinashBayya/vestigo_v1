import { loadEnvSubset } from "@repo/config";
import { pino } from "pino";
import { startWorker, WORKER_ENV } from "./worker.ts";

// Fail fast on invalid configuration before anything else runs.
const env = loadEnvSubset(WORKER_ENV);
const logger = pino({ level: env.LOG_LEVEL, base: { service: "worker" } });

const worker = await startWorker(env, logger);

let stopping = false;
const stop = (signal: string) => {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, "worker stopping: finishing running jobs");
  worker.close().then(
    () => {
      logger.info("worker stopped");
      process.exit(0);
    },
    (error: unknown) => {
      logger.error({ err: error }, "worker did not stop cleanly");
      process.exit(1);
    },
  );
};
process.on("SIGTERM", () => {
  stop("SIGTERM");
});
process.on("SIGINT", () => {
  stop("SIGINT");
});
