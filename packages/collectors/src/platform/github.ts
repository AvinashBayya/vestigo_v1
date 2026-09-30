/**
 * GitHub public profile: a GitHub account's public profile, its public
 * repositories and a search of its public commits, as GitHub reports them.
 *
 * KEEP of the previous codebase's public REST usage (legacy
 * src/routes/news.tsx, the GitHub search; collectors/person/presence-username
 * and contact-email for the user and commit endpoints). Not carried over:
 *   - Name variations: legacy searched users by the name with spaces removed
 *     and word order reversed, and took the first hits' repositories as the
 *     subject's. Here the target is one exact login; nothing is guessed.
 *   - Swallowed failures: every legacy request's failure was logged and
 *     skipped, so a failed search read as "no repositories". Here any failed
 *     request fails the collection with a typed error.
 *
 * Three requests per run: GitHub allows 60 unauthenticated requests an hour,
 * shared across the platform (the github-api source's limit). With a tenant's
 * key from the vault (vault id "github"), requests are authenticated.
 */
import { z } from "zod";
import { defineCollector, type Collector } from "../contract.ts";
import {
  UpstreamRejectedError,
  UpstreamResponseError,
  UpstreamUnavailableError,
} from "../errors.ts";
import type { CapturedResponse } from "../fetcher/capture.ts";

const API = "https://api.github.com";

/** Repositories asked for, newest update first. */
export const GITHUB_REPOSITORIES_PER_PAGE = 30;
/** Commits asked for, newest authored first. */
export const GITHUB_COMMITS_PER_PAGE = 10;

const FETCH_TIMEOUT_MS = 20_000;

// ── What GitHub sends ────────────────────────────────────────────────────

const TEXT = z.string().nullable();
const COUNT = z.number().int().min(0);

const USER = z.object({
  login: z.string(),
  id: z.number().int(),
  type: z.string(),
  html_url: z.string(),
  name: TEXT.optional(),
  company: TEXT.optional(),
  blog: TEXT.optional(),
  location: TEXT.optional(),
  email: TEXT.optional(),
  bio: TEXT.optional(),
  twitter_username: TEXT.optional(),
  public_repos: COUNT,
  public_gists: COUNT,
  followers: COUNT,
  following: COUNT,
  created_at: z.string(),
  updated_at: z.string(),
});

const REPOSITORY = z.object({
  full_name: z.string(),
  html_url: z.string(),
  description: TEXT,
  fork: z.boolean(),
  language: TEXT,
  stargazers_count: COUNT,
  forks_count: COUNT,
  archived: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  pushed_at: TEXT,
});

const COMMIT_SEARCH = z.object({
  total_count: COUNT,
  incomplete_results: z.boolean(),
  items: z.array(
    z.object({
      sha: z.string(),
      html_url: z.string(),
      repository: z.object({ full_name: z.string() }),
      commit: z.object({
        message: z.string(),
        author: z.object({ date: z.string() }).nullable(),
        committer: z.object({ date: z.string() }).nullable(),
      }),
    }),
  ),
});

// ── What the collector reports ────────────────────────────────────────────

export const GITHUB_RESULT = z
  .object({
    /** The account, as GitHub reports it. Absent optional fields are null, never a placeholder. */
    account: z
      .object({
        login: z.string(),
        /** GitHub's numeric account id. */
        githubId: z.number().int(),
        /** GitHub's account type, e.g. User or Organization. */
        type: z.string(),
        profileUrl: z.string(),
        name: TEXT,
        company: TEXT,
        blog: TEXT,
        location: TEXT,
        /** The public email, only if the account publishes one. */
        email: TEXT,
        bio: TEXT,
        twitterUsername: TEXT,
        publicRepositories: COUNT,
        publicGists: COUNT,
        followers: COUNT,
        following: COUNT,
        createdAt: z.string(),
        updatedAt: z.string(),
      })
      .strict(),
    repositories: z
      .object({
        /** Most recently updated first, as GitHub ordered them. */
        items: z.array(
          z
            .object({
              fullName: z.string(),
              url: z.string(),
              description: TEXT,
              fork: z.boolean(),
              language: TEXT,
              stars: COUNT,
              forks: COUNT,
              archived: z.boolean(),
              createdAt: z.string(),
              updatedAt: z.string(),
              pushedAt: TEXT,
            })
            .strict(),
        ),
      })
      .strict(),
    commits: z
      .object({
        /** GitHub's own count of matching public commits. */
        totalCount: COUNT,
        /** GitHub's flag that its search timed out and the count may be low. */
        incompleteResults: z.boolean(),
        items: z.array(
          z
            .object({
              sha: z.string(),
              url: z.string(),
              repository: z.string(),
              /** The commit message, as written. */
              message: z.string(),
              authoredAt: TEXT,
              committedAt: TEXT,
            })
            .strict(),
        ),
      })
      .strict(),
    /** What this collector asked for, measured or computed; nothing here is GitHub's (src/provenance.ts). */
    derived: z
      .object({
        repositories: z
          .object({
            requested: z.literal(GITHUB_REPOSITORIES_PER_PAGE),
            /**
             * GitHub's Link header had rel="next": more pages exist, so the list
             * is partial. Read from a header, which the evidence does not store.
             */
            partial: z.boolean(),
          })
          .strict(),
        commits: z.object({ requested: z.literal(GITHUB_COMMITS_PER_PAGE) }).strict(),
        /** Whether the requests used the tenant's GitHub key; it changes what GitHub shows and its limits. */
        requestedWithTenantKey: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type GithubResult = z.infer<typeof GITHUB_RESULT>;

/** Retry-After, or GitHub's x-ratelimit-reset (epoch seconds), in milliseconds; null when neither is readable. */
function retryAfterMs(response: CapturedResponse): number | null {
  const retryAfter = response.headers["retry-after"]?.trim();
  if (retryAfter !== undefined && /^\d+$/.test(retryAfter)) return Number(retryAfter) * 1000;
  const reset = response.headers["x-ratelimit-reset"]?.trim();
  if (reset !== undefined && /^\d+$/.test(reset)) {
    return Math.max(0, Number(reset) * 1000 - response.receivedAt.getTime());
  }
  return null;
}

/** Throws for every status but 200, typed by whether a retry can help. */
function refuseUnlessOk(response: CapturedResponse, what: string): void {
  const { status } = response;
  if (status === 200) return;
  // A 403 is a rate limit when the primary limit is spent, or when it is a
  // secondary limit: GitHub then sends Retry-After and says so in the body,
  // with the primary limit not spent (Phase 3B review: this was FAILED as a
  // rejected request, which is never retried).
  const exhausted = response.headers["x-ratelimit-remaining"]?.trim() === "0";
  const secondary =
    response.headers["retry-after"] !== undefined || /secondary rate limit/i.test(response.text());
  if (status === 429 || (status === 403 && (exhausted || secondary))) {
    throw new UpstreamUnavailableError(
      `GitHub's rate limit is exhausted (${what})`,
      retryAfterMs(response),
    );
  }
  if (status >= 500) {
    throw new UpstreamUnavailableError(
      `GitHub answered ${String(status)} (${what})`,
      retryAfterMs(response),
    );
  }
  if (status === 401 || status === 403) {
    throw new UpstreamRejectedError(`GitHub refused the request with ${String(status)} (${what})`);
  }
  throw new UpstreamResponseError(
    `GitHub answered an unexpected status ${String(status)} (${what})`,
  );
}

function parsed<T>(schema: z.ZodType<T>, response: CapturedResponse, what: string): T {
  const result = schema.safeParse(response.json());
  if (!result.success)
    throw new UpstreamResponseError(`GitHub's ${what} is not the documented shape`);
  return result.data;
}

export const githubCollector: Collector = defineCollector(
  {
    id: "github",
    version: "1.0.0",
    displayName: "GitHub public profile",
    discipline: "SOCMINT",
    targetTypes: ["USERNAME"],
    collectionMode: "PASSIVE_API",
    source: "github-api",
    credentials: { vaultIds: ["github"], runsWithout: true },
    claimStrength: "REPORTED",
    timeoutMs: 90_000,
    resultSchema: GITHUB_RESULT,
  },
  async (ctx) => {
    const key = ctx.credentials.get("github");
    const headers: Record<string, string> = {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      ...(key === null ? {} : { authorization: `Bearer ${key.expose()}` }),
    };
    const get = (path: string) =>
      ctx.fetch(`${API}${path}`, { method: "GET", timeoutMs: FETCH_TIMEOUT_MS, headers });
    const login = encodeURIComponent(ctx.target.value);

    const userResponse = await get(`/users/${login}`);
    if (userResponse.status === 404) {
      return ctx.notFound(userResponse, "GitHub has no account with this login.");
    }
    refuseUnlessOk(userResponse, "account");
    const user = parsed(USER, userResponse, "account");

    const repositoryParams = new URLSearchParams({
      sort: "updated",
      per_page: String(GITHUB_REPOSITORIES_PER_PAGE),
    });
    const reposResponse = await get(`/users/${login}/repos?${repositoryParams.toString()}`);
    refuseUnlessOk(reposResponse, "repositories");
    const repositories = parsed(z.array(REPOSITORY), reposResponse, "repository list");

    const commitParams = new URLSearchParams({
      q: `author:${user.login}`,
      sort: "author-date",
      order: "desc",
      per_page: String(GITHUB_COMMITS_PER_PAGE),
    });
    const commitsResponse = await get(`/search/commits?${commitParams.toString()}`);
    refuseUnlessOk(commitsResponse, "commit search");
    const commits = parsed(COMMIT_SEARCH, commitsResponse, "commit search");

    const optional = (value: string | null | undefined): string | null =>
      value === undefined || value === null || value.length === 0 ? null : value;

    return ctx.found(
      {
        account: {
          login: user.login,
          githubId: user.id,
          type: user.type,
          profileUrl: user.html_url,
          name: optional(user.name),
          company: optional(user.company),
          blog: optional(user.blog),
          location: optional(user.location),
          email: optional(user.email),
          bio: optional(user.bio),
          twitterUsername: optional(user.twitter_username),
          publicRepositories: user.public_repos,
          publicGists: user.public_gists,
          followers: user.followers,
          following: user.following,
          createdAt: user.created_at,
          updatedAt: user.updated_at,
        },
        repositories: {
          items: repositories.map((repository) => ({
            fullName: repository.full_name,
            url: repository.html_url,
            description: optional(repository.description),
            fork: repository.fork,
            language: optional(repository.language),
            stars: repository.stargazers_count,
            forks: repository.forks_count,
            archived: repository.archived,
            createdAt: repository.created_at,
            updatedAt: repository.updated_at,
            pushedAt: optional(repository.pushed_at),
          })),
        },
        commits: {
          totalCount: commits.total_count,
          incompleteResults: commits.incomplete_results,
          items: commits.items.map((item) => ({
            sha: item.sha,
            url: item.html_url,
            repository: item.repository.full_name,
            message: item.commit.message,
            authoredAt: item.commit.author?.date ?? null,
            committedAt: item.commit.committer?.date ?? null,
          })),
        },
        derived: {
          repositories: {
            requested: GITHUB_REPOSITORIES_PER_PAGE,
            partial: /rel="next"/.test(reposResponse.headers.link ?? ""),
          },
          commits: { requested: GITHUB_COMMITS_PER_PAGE },
          requestedWithTenantKey: key !== null,
        },
      },
      // The profile's dates are in the result; the evidence as a whole has none.
      [
        { response: userResponse, observedAt: null },
        { response: reposResponse, observedAt: null },
        { response: commitsResponse, observedAt: null },
      ],
    );
  },
);
