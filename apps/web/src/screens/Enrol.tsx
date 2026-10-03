import { Button, Field, Notice } from "@repo/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState, type SubmitEvent } from "react";
import { ApiProblem, timed, unwrap } from "../api.ts";
import { api } from "../client/index.ts";
import { AuthFrame } from "../components/AuthFrame.tsx";
import { ProblemNotice } from "../components/ProblemNotice.tsx";
import { QrCode } from "../components/QrCode.tsx";
import { enrolmentToken, homeOf, settleTenant } from "../session.ts";

/** A secret is easier to type in groups of four. */
const grouped = (secret: string): string => secret.match(/.{1,4}/g)?.join(" ") ?? secret;

/** MFA enrolment with the one-time token from the invitation or provisioning link. */
export function EnrolScreen() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [stored] = useState(() => enrolmentToken.read());
  const [token, setToken] = useState(stored ?? "");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");

  const start = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST("/api/v1/session/mfa/enrolment", {
          body: { password, enrolmentToken: token },
          signal: timed(),
        }),
      ),
  });

  const confirm = useMutation({
    mutationFn: async () => {
      const session = await unwrap(
        api.POST("/api/v1/session/mfa/enrolment/confirm", {
          body: { code, enrolmentToken: token },
          signal: timed(),
        }),
      );
      return settleTenant(queryClient, session);
    },
    onSuccess: async (session) => {
      enrolmentToken.clear();
      await navigate({ to: homeOf(session) });
    },
  });

  const tokenRefused =
    start.error instanceof ApiProblem && start.error.code.startsWith("MFA_ENROLMENT_TOKEN");
  // The token field shows when no link brought one, or the one it brought was refused.
  const showTokenField = stored === null || tokenRefused;

  if (start.data === undefined) {
    return (
      <AuthFrame
        title="Set up two-factor authentication"
        intro="Every account uses an authenticator app as a second step at sign-in. Confirm your password to begin."
      >
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event: SubmitEvent) => {
            event.preventDefault();
            start.mutate();
          }}
        >
          {showTokenField ? (
            <Field
              label="Enrolment token"
              hint="From the link you were given. It starts with mfa_."
              name="enrolment-token"
              autoComplete="off"
              className="font-mono"
              required
              value={token}
              onChange={(event) => {
                setToken(event.target.value.trim());
              }}
            />
          ) : (
            <Notice tone="info">Enrolment link received.</Notice>
          )}
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
          {start.isError ? <ProblemNotice error={start.error} /> : null}
          <Button type="submit" disabled={start.isPending || password === "" || token === ""}>
            {start.isPending ? "Preparing…" : "Continue"}
          </Button>
        </form>
      </AuthFrame>
    );
  }

  const enrolment = start.data;
  return (
    <AuthFrame
      title="Add this account to your authenticator app"
      intro="Scan the code with your authenticator app, or type the key into it by hand."
    >
      <div className="flex flex-col items-center gap-3">
        <QrCode value={enrolment.totpUri} label="QR code for your authenticator app" />
        <div className="flex w-full flex-col gap-1">
          <p className="text-eyebrow uppercase text-ink-muted">Key</p>
          <p className="font-mono text-mono-body text-ink-primary select-all">
            {grouped(enrolment.secret)}
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-eyebrow uppercase text-ink-muted">Backup codes</p>
        <p className="text-small text-ink-secondary">
          Save these now, somewhere other than this device. Each signs you in once if you lose your
          authenticator app. They are not shown again.
        </p>
        <ul className="grid grid-cols-2 gap-2 rounded-md bg-surface-sunken p-3 font-mono text-mono-body">
          {enrolment.backupCodes.map((backup) => (
            <li key={backup}>{backup}</li>
          ))}
        </ul>
      </div>
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event: SubmitEvent) => {
          event.preventDefault();
          confirm.mutate();
        }}
      >
        <Field
          label="Code from the app"
          hint="The six-digit code the app now shows for this account."
          name="code"
          autoComplete="one-time-code"
          inputMode="numeric"
          className="font-mono"
          required
          value={code}
          onChange={(event) => {
            setCode(event.target.value.trim());
          }}
        />
        {confirm.isError ? <ProblemNotice error={confirm.error} /> : null}
        <Button type="submit" disabled={confirm.isPending || code === ""}>
          {confirm.isPending ? "Checking…" : "Finish setup"}
        </Button>
      </form>
    </AuthFrame>
  );
}
