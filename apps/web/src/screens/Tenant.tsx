import { Button, Notice } from "@repo/ui";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { timed, unwrap } from "../api.ts";
import { api } from "../client/index.ts";
import { AuthFrame } from "../components/AuthFrame.tsx";
import { ProblemNotice } from "../components/ProblemNotice.tsx";
import { homeOf, sessionQuery } from "../session.ts";

/** Choosing the organisation (tenant) this session works in. */
export function TenantScreen() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: session } = useSuspenseQuery(sessionQuery);

  const choose = useMutation({
    mutationFn: (tenantId: string) =>
      unwrap(api.POST("/api/v1/session/tenant", { body: { tenantId }, signal: timed() })),
    onSuccess: async (next) => {
      queryClient.setQueryData(sessionQuery.queryKey, next);
      await navigate({ to: homeOf(next) });
    },
  });

  const tenants = session.state === "SIGNED_IN" ? session.tenants : [];
  return (
    <AuthFrame title="Choose an organisation" intro="Your work is kept separately in each one.">
      {tenants.length === 0 ? (
        <Notice tone="info">
          This account is not a member of any organisation. Ask an administrator to invite you.
        </Notice>
      ) : (
        <ul className="flex flex-col gap-2">
          {tenants.map((tenant) => (
            <li key={tenant.id}>
              <Button
                variant="secondary"
                className="w-full justify-start"
                disabled={choose.isPending}
                onClick={() => {
                  choose.mutate(tenant.id);
                }}
              >
                {tenant.name}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {choose.isError ? <ProblemNotice error={choose.error} /> : null}
    </AuthFrame>
  );
}
