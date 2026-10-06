import { Button, Field, Notice } from "@repo/ui";
import { useMutation } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { useState, type SubmitEvent } from "react";
import { timed, unwrap } from "../api.ts";
import { api } from "../client/index.ts";
import { AuthFrame } from "../components/AuthFrame.tsx";
import { ProblemNotice } from "../components/ProblemNotice.tsx";

/** Sign-in, step 1 of 2 (docs/design/mockups/SignIn.dc.html). */
export function SignInScreen() {
  const navigate = useNavigate();
  const search = useSearch({ from: "/sign-in" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const signIn = useMutation({
    mutationFn: () =>
      unwrap(api.POST("/api/v1/session/sign-in", { body: { email, password }, signal: timed() })),
    onSuccess: async (result) => {
      await navigate({ to: result.next === "MFA_CHALLENGE" ? "/sign-in/verify" : "/enrol" });
    },
  });

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    signIn.mutate();
  };

  return (
    <AuthFrame
      title="Sign in"
      intro="Accounts are created by invitation. If you need access, ask an administrator in your organisation."
      footnote={
        <>
          <ShieldCheck className="size-4 shrink-0" strokeWidth={1.9} aria-hidden="true" />
          <p>
            Two-factor authentication is required on every account. You will be asked for a code
            after your password.
          </p>
        </>
      }
    >
      {search.reason === "enrol" ? (
        <Notice tone="info">Sign in to finish setting up two-factor authentication.</Notice>
      ) : null}
      {search.reason === "signed-out" ? <Notice tone="info">You are signed out.</Notice> : null}
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <Field
          label="Work email"
          type="email"
          name="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
        />
        <Field
          label="Password"
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
        />
        {signIn.isError ? <ProblemNotice error={signIn.error} /> : null}
        <Button type="submit" disabled={signIn.isPending || email === "" || password === ""}>
          {signIn.isPending ? "Checking…" : "Continue"}
        </Button>
      </form>
    </AuthFrame>
  );
}
