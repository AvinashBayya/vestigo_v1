import { loadEnv } from "@repo/config";
import { NotImplementedError } from "@repo/core";

// Fail fast on invalid configuration before anything else runs.
loadEnv();

// No queue consumer exists yet. Failing loudly is the honest behaviour: a
// worker that started and idled would look healthy while processing nothing.
throw new NotImplementedError(
  "worker.queue-consumption",
  "BullMQ queues and worker pools are built in Phase 4.",
);
