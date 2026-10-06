import { PRODUCT_NAME } from "@repo/config/product";
import { Button, Field, Panel } from "@repo/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Download } from "lucide-react";
import { useState, type ReactNode, type SubmitEvent } from "react";
import { ApiProblem, timed, unwrap } from "../api.ts";
import { api } from "../client/index.ts";
import { AuthFrame } from "../components/AuthFrame.tsx";
import { ProblemNotice } from "../components/ProblemNotice.tsx";
import { QrCode } from "../components/QrCode.tsx";
import { enrolmentToken, homeOf, settleTenant } from "../session.ts";

/** A secret is easier to type in groups of four. */
const grouped = (secret: string): string => secret.match(/.{1,4}/g)?.join(" ") ?? secret;

/** Saves the backup codes as a text file on this device; nothing is sent anywhere. */
function downloadCodes(codes: readonly string[]): void {
  const text = [
    `${PRODUCT_NAME} backup codes`,
    "",
    ...codes,
    "",
    "Each code signs you in once if you lose your authenticator app.",
    "",
  ].join("\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "backup-codes.txt";
  link.click();
  URL.revokeObjectURL(url);
}

const INTRO = `${PRODUCT_NAME} requires a second factor on every account before it will let you in, because an account here can reach other people's data.`;

function Step({
  number,
  title,
  children,
}: {
  readonly number: number;
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <Panel className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="text-eyebrow uppercase text-ink-muted">Step {number}</p>
        <h2 className="text-body-strong text-ink-primary">{title}</h2>
      </div>
      {children}
    </Panel>
  );
}

/**
 * MFA enrolment with the one-time token from the invitation or provisioning
 * link (docs/design/mockups/MfaEnrol.dc.html). The backup codes come before
 * the final confirmation, because confirming leaves this page.
 */
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

  const linkStatus =
    stored === null ? null : (
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center rounded-pill bg-accent-soft px-3 py-1 text-caption text-accent-ink">
          Enrolment link received
        </span>
        <span className="text-small text-ink-secondary">
          It stops working once enrolment is finished.
        </span>
      </div>
    );

  if (start.data === undefined) {
    return (
      <AuthFrame eyebrow="Account setup" title="Set up two-factor authentication" intro={INTRO}>
        {linkStatus}
        <Panel className="flex flex-col gap-4">
          <p className="text-body text-ink-secondary">Confirm your password to begin.</p>
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
            ) : null}
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
        </Panel>
      </AuthFrame>
    );
  }

  const enrolment = start.data;
  return (
    <AuthFrame
      eyebrow="Account setup"
      title="Set up two-factor authentication"
      intro={INTRO}
      width="page"
    >
      {linkStatus}
      <div className="grid gap-6 md:grid-cols-2">
        <Step number={1} title="Scan with your authenticator app">
          <div className="flex justify-center rounded-lg border border-border-default bg-surface-sunken p-5">
            <QrCode value={enrolment.totpUri} label="QR code for your authenticator app" />
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-small text-ink-secondary">Or enter this key by hand:</p>
            <p className="rounded-md border border-border-default bg-surface-sunken p-3 font-mono text-mono-body text-ink-primary select-all">
              {grouped(enrolment.secret)}
            </p>
          </div>
        </Step>
        <div className="flex flex-col gap-6">
          <Step number={2} title="Save your backup codes">
            <p className="text-small text-ink-secondary">
              Each code works once, if you lose your device. They are shown now and never again.
            </p>
            <ul className="grid grid-cols-2 gap-2 font-mono text-mono-body text-ink-primary">
              {enrolment.backupCodes.map((backup) => (
                <li
                  key={backup}
                  className="rounded-md border border-border-default bg-surface-sunken px-3 py-2"
                >
                  {backup}
                </li>
              ))}
            </ul>
            <Button
              variant="secondary"
              onClick={() => {
                downloadCodes(enrolment.backupCodes);
              }}
            >
              <Download className="size-4" strokeWidth={1.9} aria-hidden="true" />
              Download codes
            </Button>
          </Step>
          <Step number={3} title="Confirm the code">
            <form
              className="flex flex-col gap-4"
              noValidate
              onSubmit={(event: SubmitEvent) => {
                event.preventDefault();
                confirm.mutate();
              }}
            >
              <Field
                label="Six-digit code from your app"
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
                {confirm.isPending ? "Checking…" : "Confirm and finish"}
              </Button>
            </form>
          </Step>
        </div>
      </div>
    </AuthFrame>
  );
}
