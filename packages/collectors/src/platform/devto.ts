/**
 * DEV Community profile: the public DEV (dev.to) profile for one exact
 * username, as DEV reports it.
 *
 * KEEP of the previous codebase's DEV lookup (legacy
 * utils/collectors/person/presence-username.ts, the Dev.to check). Not
 * carried over:
 *   - Swallowed failures: every legacy check's failure was caught and ignored,
 *     so a timeout or an outage read as "no account". Here only DEV's 404 is
 *     NOT_FOUND; every other failure is typed.
 *   - Status as presence: legacy counted any 200 as a hit and kept nothing of
 *     the answer. Here the profile DEV returns is the result, cited.
 *   - Handle rewriting: legacy stripped whitespace from the handle before the
 *     lookup. Here the target is looked up exactly as given, and an answer for
 *     any other username is refused.
 *
 * Uses DEV's V1 API (the Accept header selects it); the unversioned V0 answer
 * is marked beta by DEV itself.
 */
import { z } from "zod";
import { defineCollector, type Collector } from "../contract.ts";
import {
  UpstreamRejectedError,
  UpstreamResponseError,
  UpstreamUnavailableError,
} from "../errors.ts";
import type { CapturedResponse } from "../fetcher/capture.ts";

const ENDPOINT = "https://dev.to/api/users/by_username";
const ACCEPT_V1 = "application/vnd.forem.api-v1+json";

const FETCH_TIMEOUT_MS = 20_000;

// ── What DEV sends ───────────────────────────────────────────────────────

const TEXT = z.string().nullable();

const USER = z.object({
  type_of: z.literal("user"),
  id: z.number().int(),
  username: z.string().min(1),
  name: TEXT.optional(),
  twitter_username: TEXT.optional(),
  github_username: TEXT.optional(),
  email: TEXT.optional(),
  summary: TEXT.optional(),
  location: TEXT.optional(),
  website_url: TEXT.optional(),
  joined_at: TEXT.optional(),
  profile_image: TEXT.optional(),
});

// ── What the collector reports ────────────────────────────────────────────

export const DEVTO_RESULT = z
  .object({
    account: z
      .object({
        /** The username as DEV returned it. */
        username: z.string().min(1),
        /** DEV's numeric user id. */
        devId: z.number().int(),
        /** Profile fields as DEV states them; null when DEV gives none or an empty string. */
        name: TEXT,
        summary: TEXT,
        location: TEXT,
        websiteUrl: TEXT,
        /** The public email, only if the user publishes one. */
        email: TEXT,
        /** Handles the user entered on their DEV profile. DEV does not verify them, and neither does this collector. */
        twitterUsernameAsEntered: TEXT,
        githubUsernameAsEntered: TEXT,
        /** DEV's display text for the join date (e.g. "Feb  9, 2016"), not a timestamp; null when absent. */
        joinedAsStated: TEXT,
        profileImageUrl: TEXT,
      })
      .strict(),
    /** Nothing here is computed: every value above is DEV's (src/provenance.ts). */
    derived: z.object({}).strict(),
  })
  .strict();

export type DevtoResult = z.infer<typeof DEVTO_RESULT>;

/** Retry-After in milliseconds, in seconds or as an HTTP date; null when absent or unreadable. */
function retryAfterMs(response: CapturedResponse): number | null {
  const value = response.headers["retry-after"]?.trim();
  if (value === undefined || value.length === 0) return null;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const at = Date.parse(value);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - response.receivedAt.getTime());
}

/** Throws for every status but 200, typed by whether a retry can help. */
function refuseUnlessOk(response: CapturedResponse): void {
  const { status } = response;
  if (status === 200) return;
  if (status === 429 || status >= 500) {
    throw new UpstreamUnavailableError(`DEV answered ${String(status)}`, retryAfterMs(response));
  }
  if (status === 401 || status === 403) {
    throw new UpstreamRejectedError(`DEV refused the request with ${String(status)}`);
  }
  throw new UpstreamResponseError(`DEV answered an unexpected status ${String(status)}`);
}

export const devtoCollector: Collector = defineCollector(
  {
    id: "devto",
    version: "1.0.0",
    displayName: "DEV Community profile",
    discipline: "SOCMINT",
    targetTypes: ["USERNAME"],
    collectionMode: "PASSIVE_API",
    source: "devto",
    credentials: { vaultIds: [], runsWithout: true },
    claimStrength: "REPORTED",
    timeoutMs: 30_000,
    resultSchema: DEVTO_RESULT,
  },
  async (ctx) => {
    const username = ctx.target.value;
    const params = new URLSearchParams({ url: username });
    const response = await ctx.fetch(`${ENDPOINT}?${params.toString()}`, {
      method: "GET",
      timeoutMs: FETCH_TIMEOUT_MS,
      headers: { accept: ACCEPT_V1 },
    });
    if (response.status === 404) {
      return ctx.notFound(response, "DEV has no user with this username.");
    }
    refuseUnlessOk(response);
    const user = USER.safeParse(response.json());
    if (!user.success) throw new UpstreamResponseError("DEV's answer is not the documented shape");
    // DEV usernames are case-insensitive; an answer for any other username is
    // never presented as this one's profile.
    if (user.data.username.toLowerCase() !== username.toLowerCase()) {
      throw new UpstreamResponseError("DEV answered with a different username than was asked for");
    }

    const optional = (value: string | null | undefined): string | null =>
      value === undefined || value === null || value.length === 0 ? null : value;

    return ctx.found(
      {
        account: {
          username: user.data.username,
          devId: user.data.id,
          name: optional(user.data.name),
          summary: optional(user.data.summary),
          location: optional(user.data.location),
          websiteUrl: optional(user.data.website_url),
          email: optional(user.data.email),
          twitterUsernameAsEntered: optional(user.data.twitter_username),
          githubUsernameAsEntered: optional(user.data.github_username),
          joinedAsStated: optional(user.data.joined_at),
          profileImageUrl: optional(user.data.profile_image),
        },
        derived: {},
      },
      // DEV's join date is display text in the result; the profile as a whole has no date.
      [{ response, observedAt: null }],
    );
  },
);
