import { Button, Field, Notice } from "@repo/ui";
import { useMutation } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { useState, type SubmitEvent } from "react";
import { timed, unwrap } from "../api.ts";
import { api } from "../client/index.ts";
import { AuthFrame } from "../components/AuthFrame.tsx";
import { ProblemNotice } from "../components/ProblemNotice.tsx";

/**
 * Sign-in, step 1 of 2 (docs/design/mockups/SignIn.dc.html, left half).
 * There is no sign-up, register or password-reset affordance: accounts come
 * by invitation (CLAUDE.md §1), and no reset exists.
 */
export function SignInScreen() {
  const navigate = useNavigate();
  const search = useSearch({ from: "/sign-in" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Set by a submit with a field empty; each field's error clears as it is filled.
  const [attempted, setAttempted] = useState(false);

  const signIn = useMutation({
    mutationFn: () =>
      unwrap(api.POST("/api/v1/session/sign-in", { body: { email, password }, signal: timed() })),
    onSuccess: async (result) => {
      await navigate({ to: result.next === "MFA_CHALLENGE" ? "/sign-in/verify" : "/enrol" });
    },
  });

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    // Nothing is sent with a field empty: the empty field says why instead.
    if (email === "" || password === "") {
      setAttempted(true);
      return;
    }
    if (!signIn.isPending) signIn.mutate();
  };

  return (
    <AuthFrame
      title="Sign in"
      intro="Accounts are created by invitation. If you need access, ask an administrator in your organisation."
      footnoteIcon={<ShieldCheck className="size-icon" strokeWidth={1.9} />}
      footnote={
        <p>
          Two-factor authentication is required on every account. You will be asked for a code after
          your password.
        </p>
      }
    >
      {search.reason === "enrol" ? (
        <Notice tone="info">Sign in to finish setting up two-factor authentication.</Notice>
      ) : null}
      {search.reason === "signed-out" ? <Notice tone="info">You are signed out.</Notice> : null}
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <Field
          variant="auth"
          label="Work email"
          type="email"
          name="email"
          autoComplete="username"
          required
          error={attempted && email === "" ? "Enter your work email." : undefined}
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
        />
        <Field
          variant="auth"
          label="Password"
          type="password"
          name="password"
          autoComplete="current-password"
          required
          error={attempted && password === "" ? "Enter your password." : undefined}
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
        />
        <Button
          type="submit"
          size="lg"
          className="w-full"
          aria-busy={signIn.isPending}
          disabled={signIn.isPending}
        >
          {signIn.isPending ? "Checking…" : "Continue"}
        </Button>
        {signIn.isError ? <ProblemNotice error={signIn.error} title="Not signed in" /> : null}
      </form>
    </AuthFrame>
  );
}
