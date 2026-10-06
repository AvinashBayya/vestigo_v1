import { queryOptions } from "@tanstack/react-query";
import { timed, unwrap } from "./api.ts";
import { api, type paths } from "./client/index.ts";

export type Me = paths["/api/v1/me"]["get"]["responses"][200]["content"]["application/json"];
export type VettingStatus = Me["tenant"]["vettingStatus"];

/** Who is signed in, for which tenant: its plan, vetting status and the caller's permissions. */
export const meQuery = (tenantId: string) =>
  queryOptions({
    queryKey: ["me", tenantId],
    queryFn: ({ signal }): Promise<Me> => unwrap(api.GET("/api/v1/me", { signal: timed(signal) })),
  });

/** The tenant's vetting status in words, as the API states it. */
export const VETTING_TEXT: Readonly<Record<VettingStatus, string>> = {
  APPROVED: "Verified tenant",
  PENDING: "Vetting pending",
  NOT_SUBMITTED: "Vetting not submitted",
  REJECTED: "Vetting rejected",
  SUSPENDED: "Vetting suspended",
};
