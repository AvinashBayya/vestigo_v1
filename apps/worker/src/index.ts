import { loadEnvSubset } from "@repo/config";
import { NotImplementedError } from "@repo/core";

// Fail fast on invalid configuration before anything else runs. The worker
// validates only what it uses; it never holds the auth secret or vault key.
loadEnvSubset(["DATABASE_URL", "REDIS_URL"]);

// No queue consumer exists yet. Failing loudly is the honest behaviour: a
// worker that started and idled would look healthy while processing nothing.
throw new NotImplementedError(
  "worker.queue-consumption",
  "BullMQ queues and worker pools are built in Phase 4.",
);
