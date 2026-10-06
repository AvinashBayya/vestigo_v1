import { ApiProblem, ApiUnreachable } from "./api.ts";

export interface Message {
  readonly text: string;
  /** The machine-readable code, shown small for support; null for an unexpected failure. */
  readonly code: string | null;
}

/** What to tell the person, by the code the API (or the identity provider) gave. */
const BY_CODE: Readonly<Record<string, string>> = {
  INVALID_EMAIL_OR_PASSWORD: "That email address and password do not match an account.",
  INVALID_PASSWORD: "That password is not right.",
  INVALID_CODE:
    "That code was not accepted. Codes change every 30 seconds; check your device's clock if this keeps happening.",
  INVALID_BACKUP_CODE: "That backup code is not right, or it has already been used.",
  INVALID_TWO_FACTOR_COOKIE: "This sign-in has expired. Sign in again.",
  TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: "Too many wrong codes. Sign in again.",
  ACCOUNT_TEMPORARILY_LOCKED:
    "Too many wrong codes, so this account is locked for now. Wait, then sign in again.",
  MFA_ENROLMENT_TOKEN_REQUIRED:
    "Setting up two-factor authentication needs the token from the link you were given.",
  MFA_ENROLMENT_TOKEN_INVALID:
    "That enrolment token is not valid for this account, or it has expired. Ask whoever gave you the link for a new one.",
  TOTP_ALREADY_ENABLED: "Two-factor authentication is already set up for this account.",
  ORIGIN_NOT_ALLOWED:
    "Sign-in is only allowed from the app's own address. Open the app from its usual address.",
  VALIDATION_FAILED: "Some of what was entered is not in the expected form.",
  TARGET_EMPTY: "Enter something to search for.",
  PERMISSION_DENIED: "Your role in this organisation does not allow this.",
  QUOTA_EXCEEDED: "This organisation's usage quota is spent, so no run can start until it resets.",
  INVESTIGATION_ARCHIVED: "That investigation is archived, so no run can start in it.",
  QUEUE_UNAVAILABLE: "The run could not be queued just now. Nothing was started. Try again.",
};

export function messageFor(error: unknown): Message {
  if (error instanceof ApiUnreachable) {
    return {
      text:
        error.code === "API_TIMEOUT"
          ? `${error.message} Try again.`
          : `${error.message} Check your connection, then try again.`,
      code: error.code,
    };
  }
  if (error instanceof ApiProblem) {
    if (error.code === "RATE_LIMITED") {
      return {
        text:
          error.retryAfterSeconds === null
            ? "Too many attempts. Wait a minute, then try again."
            : `Too many attempts. Try again in ${String(error.retryAfterSeconds)} seconds.`,
        code: error.code,
      };
    }
    // Unknown codes show the API's own reason: specific, never a generic apology.
    return { text: BY_CODE[error.code] ?? error.detail, code: error.code };
  }
  return { text: "The app hit an unexpected error. Reload the page, then try again.", code: null };
}
