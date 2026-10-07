import { PRODUCT_NAME } from "@repo/config/product";
import { Button, Card, cn, Field, Notice, Tag } from "@repo/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Download } from "lucide-react";
import { useState, type ReactNode, type SubmitEvent } from "react";
import { ApiProblem, timed, unwrap } from "../api.ts";
import { api } from "../client/index.ts";
import { AuthFrame, AuthHeading } from "../components/AuthFrame.tsx";
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

/** A numbered step card (MfaEnrol): `space-6` padding, the eyebrow and an h2 in `subtitle`. */
function Step({
  number,
  title,
  className,
  children,
}: {
  readonly number: number;
  readonly title: string;
  /** The body's gap, as each card draws it. */
  readonly className: string;
  readonly children: ReactNode;
}) {
  return (
    <Card padding="none" className={cn("p-6", className)}>
      <div className="flex flex-col gap-1.25">
        <p className="text-eyebrow text-ink-muted uppercase">Step {number}</p>
        <h2 className="text-subtitle text-ink-primary">{title}</h2>
      </div>
      {children}
    </Card>
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
  // Set by a submit with a field empty; each field's error clears as it is filled.
  const [startAttempted, setStartAttempted] = useState(false);
  const [confirmAttempted, setConfirmAttempted] = useState(false);
  // Once the server refuses a token, the link's token is no longer trusted here.
  const [tokenRefused, setTokenRefused] = useState(false);

  const start = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST("/api/v1/session/mfa/enrolment", {
          body: { password, enrolmentToken: token },
          signal: timed(),
        }),
      ),
    onError: (error) => {
      if (error instanceof ApiProblem && error.code.startsWith("MFA_ENROLMENT_TOKEN")) {
        setTokenRefused(true);
      }
    },
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

  // The token field shows when no link brought one, or the one it brought was refused.
  const showTokenField = stored === null || tokenRefused;
  // No endpoint checks a token on its own: "verified" only once the server accepted it.
  const linkTag =
    stored === null || tokenRefused
      ? null
      : start.data === undefined
        ? "Enrolment link received"
        : "Enrolment link verified";

  const header = (
    <Card as="div" padding="none" className="px-7 py-6.5">
      <AuthHeading
        eyebrow="Account setup"
        title="Set up two-factor authentication"
        titleStyle="page"
        intro={INTRO}
        introTone="secondary"
        className="gap-2.25"
      >
        {linkTag === null ? null : (
          <div className="mt-1 flex flex-wrap items-center gap-2.25">
            <Tag mono={false}>{linkTag}</Tag>
            <span className="text-meta text-ink-muted">
              It stops working once enrolment is finished.
            </span>
          </div>
        )}
      </AuthHeading>
    </Card>
  );

  if (start.data === undefined) {
    return (
      <AuthFrame header={header} width="page">
        <Card padding="none" className="w-full max-w-form gap-4 p-6">
          <p className="text-prose-small text-ink-secondary">Confirm your password to begin.</p>
          <form
            className="flex flex-col gap-4"
            noValidate
            onSubmit={(event: SubmitEvent) => {
              event.preventDefault();
              // Nothing is sent with a field empty: the empty field says why instead.
              if (password === "" || token === "") {
                setStartAttempted(true);
                return;
              }
              if (!start.isPending) start.mutate();
            }}
          >
            {showTokenField ? (
              <Field
                variant="auth"
                label="Enrolment token"
                hint="From the link you were given. It starts with mfa_."
                name="enrolment-token"
                autoComplete="off"
                className="font-mono"
                required
                error={startAttempted && token === "" ? "Enter the enrolment token." : undefined}
                value={token}
                onChange={(event) => {
                  setToken(event.target.value.trim());
                }}
              />
            ) : null}
            <Field
              variant="auth"
              label="Password"
              type="password"
              name="password"
              autoComplete="current-password"
              required
              error={startAttempted && password === "" ? "Enter your password." : undefined}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
              }}
            />
            <Button
              type="submit"
              size="lg"
              className="w-full"
              aria-busy={start.isPending}
              disabled={start.isPending}
            >
              {start.isPending ? "Preparing…" : "Continue"}
            </Button>
            {start.isError ? (
              <ProblemNotice error={start.error} title="Could not start setup" />
            ) : null}
          </form>
        </Card>
      </AuthFrame>
    );
  }

  const enrolment = start.data;
  const noCodes = enrolment.backupCodes.length === 0;
  return (
    <AuthFrame header={header} width="page">
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Step number={1} title="Scan with your authenticator app" className="gap-4">
          <QrCode framed value={enrolment.totpUri} label="QR code for your authenticator app" />
          <div className="flex flex-col gap-1.5">
            <p className="text-meta text-ink-muted">Or enter this key by hand:</p>
            <code className="rounded-sm border border-border-default bg-surface-sunken px-2.75 py-2.25 font-mono text-mono-body break-all text-ink-primary select-all">
              {grouped(enrolment.secret)}
            </code>
          </div>
        </Step>
        <div className="flex flex-col gap-5">
          <Step number={2} title="Save your backup codes" className="gap-3.25">
            <p className="text-prose-small text-ink-secondary">
              Each code works once, if you lose your device. They are shown now and never again.
            </p>
            {noCodes ? (
              <Notice tone="info">
                No backup codes were issued. Without them, a lost device cannot be recovered.
              </Notice>
            ) : (
              <ul className="grid grid-cols-2 gap-1.75">
                {enrolment.backupCodes.map((backup) => (
                  <li
                    key={backup}
                    className="rounded-sm border border-border-subtle bg-surface-sunken px-2.25 py-1.5 font-mono text-mono-small break-all text-ink-body"
                  >
                    {backup}
                  </li>
                ))}
              </ul>
            )}
            <Button
              variant="secondary"
              size="md"
              className="w-full"
              disabled={noCodes}
              onClick={() => {
                downloadCodes(enrolment.backupCodes);
              }}
            >
              <Download className="size-icon-sm" strokeWidth={1.9} aria-hidden="true" />
              Download codes
            </Button>
          </Step>
          <Step number={3} title="Confirm the code" className="gap-3.5">
            <form
              className="flex flex-col gap-3.5"
              noValidate
              onSubmit={(event: SubmitEvent) => {
                event.preventDefault();
                // Nothing is sent without a code: the field says why instead.
                if (code === "") {
                  setConfirmAttempted(true);
                  return;
                }
                if (!confirm.isPending) confirm.mutate();
              }}
            >
              <Field
                variant="otp"
                label="Six-digit code from your app"
                name="code"
                autoComplete="one-time-code"
                inputMode="numeric"
                placeholder="000000"
                required
                error={
                  confirmAttempted && code === ""
                    ? "Enter the six-digit code from your app."
                    : undefined
                }
                value={code}
                onChange={(event) => {
                  setCode(event.target.value.trim());
                }}
              />
              <Button
                type="submit"
                size="lg"
                className="w-full"
                aria-busy={confirm.isPending}
                disabled={confirm.isPending}
              >
                {confirm.isPending ? "Checking…" : "Confirm and finish"}
              </Button>
              {confirm.isError ? (
                <ProblemNotice error={confirm.error} title="Could not finish setup" />
              ) : null}
            </form>
          </Step>
        </div>
      </div>
    </AuthFrame>
  );
}
