import { queryOptions } from "@tanstack/react-query";
import { timed, unwrap } from "./api.ts";
import { api, type paths } from "./client/index.ts";
import { LIST_LIMIT } from "./workspace/queries.ts";

export type MonitorList =
  paths["/api/v1/monitors"]["get"]["responses"][200]["content"]["application/json"];
export type Monitor = MonitorList["items"][number];
export type AlertList =
  paths["/api/v1/alerts"]["get"]["responses"][200]["content"]["application/json"];
export type Alert = AlertList["items"][number];

/** How many unacknowledged alerts one read asks for; the panels say when there are more. */
export const UNACKNOWLEDGED_ALERTS_LIMIT = 50;

/** Every scheduled monitor for this tenant, as the API lists it. */
export const monitorsQuery = queryOptions({
  queryKey: ["monitors"],
  queryFn: ({ signal }): Promise<MonitorList> =>
    unwrap(
      api.GET("/api/v1/monitors", {
        params: { query: { limit: LIST_LIMIT } },
        signal: timed(signal),
      }),
    ),
});

/** Alerts no analyst has acknowledged yet, as the API lists them. */
export const unacknowledgedAlertsQuery = queryOptions({
  queryKey: ["alerts", "unacknowledged"],
  queryFn: ({ signal }): Promise<AlertList> =>
    unwrap(
      api.GET("/api/v1/alerts", {
        params: { query: { limit: UNACKNOWLEDGED_ALERTS_LIMIT, acknowledged: false } },
        signal: timed(signal),
      }),
    ),
});
