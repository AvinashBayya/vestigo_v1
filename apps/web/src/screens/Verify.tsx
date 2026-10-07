import { PRODUCT_NAME } from "@repo/config/product";
import { Button, Field, TextLink } from "@repo/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState, type SubmitEvent } from "react";
import { ApiProblem, timed, unwrap } from "../api.ts";
import { api } from "../client/index.ts";
import { AuthFrame } from "../components/AuthFrame.tsx";
import { ProblemNotice } from "../components/ProblemNotice.tsx";
import { homeOf, settleTenant } from "../session.ts";

type Method = "TOTP" | "BACKUP_CODE";

/** Refusals after which this challenge is over: each message says to sign in again. */
const SIGN_IN_AGAIN: ReadonlySet<string> = new Set([
  "INVALID_TWO_FACTOR_COOKIE",
  "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE",
  "ACCOUNT_TEMPORARILY_LOCKED",
]);

/** The MFA challenge, step 2 of 2 (docs/design/mockups/SignIn.dc.html, right half). */
export function VerifyScreen() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [method, setMethod] = useState<Method>("TOTP");
  const [code, setCode] = useState("");
  // Set by a submit with no code; the error clears once one is typed.
  const [attempted, setAttempted] = useState(false);

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

  const signInAgain = verify.error instanceof ApiProblem && SIGN_IN_AGAIN.has(verify.error.code);
  const totp = method === "TOTP";

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    // Nothing is sent without a code: the field says why instead.
    if (code === "") {
      setAttempted(true);
      return;
    }
    if (!verify.isPending) verify.mutate();
  };

  return (
    <AuthFrame
      ground="raised"
      eyebrow="Step 2 of 2"
      titleStyle="step"
      title={totp ? "Enter your authentication code" : "Enter a backup code"}
      intro={
        totp
          ? `Open your authenticator app and enter the six-digit code for ${PRODUCT_NAME}.`
          : "Enter one of the backup codes you saved when you set up two-factor authentication. Each works once."
      }
      // No one can reset a second factor; the backup codes are the way back in.
      footnote={
        totp ? (
          <p className="text-meta">Lost your device? Use one of your backup codes.</p>
        ) : undefined
      }
    >
      <form className="flex flex-col gap-6.5" onSubmit={submit} noValidate>
        {totp ? (
          <Field
            key="TOTP"
            variant="otp"
            label="Six-digit code"
            name="code"
            autoComplete="one-time-code"
            inputMode="numeric"
            placeholder="000000"
            required
            error={attempted && code === "" ? "Enter the six-digit code from your app." : undefined}
            value={code}
            onChange={(event) => {
              setCode(event.target.value.trim());
            }}
          />
        ) : (
          // A backup code's format is not stated by the API, so no placeholder.
          <Field
            key="BACKUP_CODE"
            variant="otp"
            label="Backup code"
            name="code"
            autoComplete="off"
            inputMode="text"
            required
            error={attempted && code === "" ? "Enter one of your backup codes." : undefined}
            value={code}
            onChange={(event) => {
              setCode(event.target.value.trim());
            }}
          />
        )}
        <div className="flex flex-col gap-2.75">
          <Button
            type="submit"
            size="lg"
            className="w-full"
            aria-busy={verify.isPending}
            disabled={verify.isPending}
          >
            {verify.isPending ? "Checking…" : "Verify and sign in"}
          </Button>
          <Button
            variant="secondary"
            size="md"
            className="w-full"
            onClick={() => {
              setMethod(totp ? "BACKUP_CODE" : "TOTP");
              setCode("");
              setAttempted(false);
              verify.reset();
            }}
          >
            {totp ? "Use a backup code instead" : "Use the authenticator app instead"}
          </Button>
        </div>
        {verify.isError ? (
          <ProblemNotice error={verify.error} title="Not signed in">
            {signInAgain ? (
              <TextLink asChild>
                <Link to="/sign-in">Sign in again</Link>
              </TextLink>
            ) : null}
          </ProblemNotice>
        ) : null}
      </form>
    </AuthFrame>
  );
}
