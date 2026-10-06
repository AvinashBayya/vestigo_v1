import { PRODUCT_NAME } from "@repo/config/product";
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

/** The MFA challenge, step 2 of 2 (docs/design/mockups/SignIn.dc.html). */
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
      eyebrow="Step 2 of 2"
      title={method === "TOTP" ? "Enter your authentication code" : "Enter a backup code"}
      intro={
        method === "TOTP"
          ? `Open your authenticator app and enter the six-digit code for ${PRODUCT_NAME}.`
          : "Enter one of the backup codes you saved when you set up two-factor authentication. Each works once."
      }
      // No one can reset a second factor; the backup codes are the way back in.
      footnote={
        method === "TOTP" ? (
          <p>
            Lost your device? Sign in with one of the backup codes you saved when you set up
            two-factor authentication.
          </p>
        ) : undefined
      }
    >
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <Field
          key={method}
          label={method === "TOTP" ? "Six-digit code" : "Backup code"}
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
          {verify.isPending ? "Checking…" : "Verify and sign in"}
        </Button>
        <Button
          variant="secondary"
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
