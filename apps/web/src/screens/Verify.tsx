import { Button, Field } from "@repo/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState, type SubmitEvent } from "react";
import { ApiProblem, timed, unwrap } from "../api.ts";
import { api } from "../client/index.ts";
import { AuthFrame } from "../components/AuthFrame.tsx";
import { ProblemNotice } from "../components/ProblemNotice.tsx";
import { homeOf, settleTenant } from "../session.ts";

type Method = "TOTP" | "BACKUP_CODE";

/** The MFA challenge, after a password was accepted. */
export function VerifyScreen() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [method, setMethod] = useState<Method>("TOTP");
  const [code, setCode] = useState("");

  const verify = useMutation({
    mutationFn: async () => {
      const session = await unwrap(
        api.POST("/api/v1/session/mfa/verify", { body: { method, code }, signal: timed() }),
      );
      return settleTenant(queryClient, session);
    },
    onSuccess: async (session) => {
      await navigate({ to: homeOf(session) });
    },
  });

  const expired =
    verify.error instanceof ApiProblem && verify.error.code === "INVALID_TWO_FACTOR_COOKIE";

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    verify.mutate();
  };

  return (
    <AuthFrame
      title="Two-factor authentication"
      intro={
        method === "TOTP"
          ? "Enter the six-digit code your authenticator app shows for this account."
          : "Enter one of the backup codes you saved when you set up two-factor authentication. Each works once."
      }
    >
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <Field
          key={method}
          label={method === "TOTP" ? "Authenticator code" : "Backup code"}
          name="code"
          autoComplete="one-time-code"
          inputMode={method === "TOTP" ? "numeric" : "text"}
          className="font-mono"
          required
          value={code}
          onChange={(event) => {
            setCode(event.target.value.trim());
          }}
        />
        {verify.isError ? (
          <ProblemNotice error={verify.error}>
            {expired ? (
              <Link to="/sign-in" className="text-accent underline">
                Sign in again
              </Link>
            ) : null}
          </ProblemNotice>
        ) : null}
        <Button type="submit" disabled={verify.isPending || code === ""}>
          {verify.isPending ? "Checking…" : "Continue"}
        </Button>
        <Button
          variant="quiet"
          onClick={() => {
            setMethod(method === "TOTP" ? "BACKUP_CODE" : "TOTP");
            setCode("");
            verify.reset();
          }}
        >
          {method === "TOTP" ? "Use a backup code instead" : "Use the authenticator app instead"}
        </Button>
      </form>
    </AuthFrame>
  );
}
