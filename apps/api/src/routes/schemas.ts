import { PERMISSIONS } from "@repo/access";
import { z } from "zod";
import { ProblemSchema } from "../http/errors.ts";

/** A point in time as ISO 8601, or null when it is not known. Never a default. */
export const optionalInstant = z.iso.datetime().nullable();

export const iso = (value: Date): string => value.toISOString();
export const isoOrNull = (value: Date | null): string | null =>
  value === null ? null : value.toISOString();

export const PermissionSchema = z.enum(PERMISSIONS);

export const IdParams = z.object({ id: z.uuid() });

/** The most rows any page holds. */
export const LIMIT_MAX = 500;

/** Every list is bounded; `hasMore` says whether more rows exist beyond the limit. */
export const LimitQuery = z.object({
  limit: z.coerce.number().int().min(1).max(LIMIT_MAX).default(50),
});

/** Error responses every protected route can return. */
export const PROTECTED_ERRORS = {
  400: ProblemSchema,
  401: ProblemSchema,
  403: ProblemSchema,
  404: ProblemSchema,
  429: ProblemSchema,
  500: ProblemSchema,
  503: ProblemSchema,
} as const;

/** OpenAPI security requirement for protected routes: a session cookie or an API key. */
export const SECURITY = [{ session: [] }, { apiKey: [] }];

/** Fetches `limit + 1` rows to learn whether the list was truncated. */
export function page<T>(rows: readonly T[], limit: number): { items: T[]; hasMore: boolean } {
  return { items: rows.slice(0, limit), hasMore: rows.length > limit };
}

/**
 * Any JSON value, as a claim's value is stored. Described as unknown rather
 * than z.json(): that schema is recursive, and its $ref does not resolve in
 * the generated spec. A stated null is a value, not a missing one.
 */
export const JsonValue = z.unknown();
