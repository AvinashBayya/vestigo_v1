// @ts-check
/**
 * Shared test-runner limits for every package's vitest config.
 *
 * Why a cap: turbo runs several packages' test tasks at once, and vitest's
 * default pool is one worker per logical CPU less one, PER PACKAGE. On the
 * development laptop (8 logical CPUs) that oversubscribed the machine, and
 * startup and spawn steps (a server spawn, a worker start, real-time
 * rate-limit intervals) missed their deadlines under contention. Turbo's own
 * concurrency is capped in turbo.json; this caps each package's pool, so the
 * two together stay near the machine's capacity. Measurements: docs/PLAN.md,
 * Phase 5 follow-up "test timeouts".
 *
 * TEST_MAX_WORKERS overrides it, for a larger CI runner.
 */
const configured = Number(process.env.TEST_MAX_WORKERS);

/** Workers one package's test run may use. */
export const TEST_MAX_WORKERS = Number.isInteger(configured) && configured > 0 ? configured : 2;
