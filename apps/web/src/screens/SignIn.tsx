import { Button, Field, Notice } from "@repo/ui";
import { useMutation } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useState, type SubmitEvent } from "react";
import { timed, unwrap } from "../api.ts";
import { api } from "../client/index.ts";
import { AuthFrame } from "../components/AuthFrame.tsx";
import { ProblemNotice } from "../components/ProblemNotice.tsx";

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
    <AuthFrame title="Sign in">
      {search.reason === "enrol" ? (
        <Notice tone="info">Sign in to finish setting up two-factor authentication.</Notice>
      ) : null}
      {search.reason === "signed-out" ? <Notice tone="info">You are signed out.</Notice> : null}
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <Field
          label="Email address"
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
          {signIn.isPending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      <p className="text-caption text-ink-muted">
        Accounts are created by invitation. If you were invited, use the link you were given.
      </p>
    </AuthFrame>
  );
}
