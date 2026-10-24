/**
 * Shared vitest setup for every web test (vite.config.ts `setupFiles`).
 *
 * Why raise the async-util timeout. Since the router downloads each screen when
 * its route is first matched (router.tsx, lazyRouteComponent), a test that
 * renders through the router waits for that on-demand chunk to resolve and the
 * screen to mount. `test-screens.ts` pays the first-compile cost at import time,
 * so a warmed chunk resolves quickly — but the full suite runs several packages'
 * vitest pools at once (turbo concurrency × maxWorkers, tuned to the machine's
 * capacity in packages/config/vitest), and under that CPU contention a warmed
 * resolve plus a React mount can still exceed Testing Library's 1000 ms default.
 * The waits here are for behaviour, not for compilation, so the budget is raised
 * to tolerate a contended scheduler. It changes no assertion: findBy/waitFor
 * still resolve the instant the asserted element appears, and a genuine hang
 * still fails well within the test timeout.
 */
import { configure } from "@testing-library/dom";

configure({ asyncUtilTimeout: 10_000 });
