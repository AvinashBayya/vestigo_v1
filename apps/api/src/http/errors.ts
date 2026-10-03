import { STATUS_CODES } from "node:http";
import { AppError, NotImplementedError } from "@repo/core";
import { ReferenceNotFoundError, TenantContextError, UniqueConflictError } from "@repo/db";
import type { FastifyError, FastifyInstance } from "fastify";
import { hasZodFastifySchemaValidationErrors } from "fastify-type-provider-zod";
import { z } from "zod";

/** An error that carries its HTTP status. Codes are machine-readable. */
export class HttpError extends AppError {
  readonly code: string;
  readonly status: number;
  readonly retryAfterSeconds: number | null;

  constructor(
    status: number,
    code: string,
    message: string,
    retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export const unauthenticated = (message = "Authentication is required.") =>
  new HttpError(401, "UNAUTHENTICATED", message);

export const forbidden = (code: string, message: string) => new HttpError(403, code, message);

export const notFound = (what: string) => new HttpError(404, "NOT_FOUND", `${what} was not found.`);

/** RFC 9457 problem details. */
export const ProblemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: z.string().describe("Machine-readable error code."),
  detail: z.string(),
  issues: z
    .array(z.object({ path: z.string(), message: z.string() }))
    .optional()
    .describe("Validation problems, by field. Never includes the submitted value."),
});

type Problem = z.infer<typeof ProblemSchema>;

/** Code for a framework client error that arrives without one: a label, not a guess. */
const UNCODED_CLIENT_ERROR = "HTTP_CLIENT_ERROR";

function problem(status: number, code: string, detail: string): Problem {
  return {
    type: "about:blank",
    title: STATUS_CODES[status] ?? "unknown status",
    status,
    code,
    detail,
  };
}

/** Maps an error to problem details. Unknown errors never leak their message. */
export function toProblem(error: unknown): { problem: Problem; retryAfterSeconds: number | null } {
  if (error instanceof HttpError) {
    return {
      problem: problem(error.status, error.code, error.message),
      retryAfterSeconds: error.retryAfterSeconds,
    };
  }
  if (hasZodFastifySchemaValidationErrors(error)) {
    return {
      problem: {
        ...problem(400, "VALIDATION_FAILED", "The request did not match the schema."),
        issues: error.validation.map((issue) => ({
          path: issue.instancePath === "" ? "/" : issue.instancePath,
          message: issue.message ?? "validation message not reported",
        })),
      },
      retryAfterSeconds: null,
    };
  }
  if (error instanceof NotImplementedError) {
    return { problem: problem(501, error.code, error.message), retryAfterSeconds: null };
  }
  if (error instanceof ReferenceNotFoundError) {
    return {
      problem: problem(404, error.code, "A referenced record does not exist."),
      retryAfterSeconds: null,
    };
  }
  if (error instanceof UniqueConflictError) {
    return {
      problem: problem(409, error.code, "A record with the same key already exists."),
      retryAfterSeconds: null,
    };
  }
  if (error instanceof TenantContextError) {
    return { problem: problem(500, error.code, "Internal error."), retryAfterSeconds: null };
  }
  if (error instanceof AppError) {
    // Known, typed errors from the service layer that carry an HTTP meaning.
    const status = STATUS_BY_CODE[error.code];
    if (status !== undefined) {
      return { problem: problem(status, error.code, error.message), retryAfterSeconds: null };
    }
  }
  const fastifyError = error as Partial<FastifyError>;
  if (typeof fastifyError.statusCode === "number" && fastifyError.statusCode < 500) {
    return {
      problem: problem(
        fastifyError.statusCode,
        fastifyError.code ?? UNCODED_CLIENT_ERROR,
        fastifyError.message ?? "bad request",
      ),
      retryAfterSeconds: null,
    };
  }
  return { problem: problem(500, "INTERNAL_ERROR", "Internal error."), retryAfterSeconds: null };
}

/** Typed service-layer errors and their HTTP status. */
const STATUS_BY_CODE: Readonly<Record<string, number>> = {
  API_KEY_SCOPE_INVALID: 403,
  API_KEY_NOT_FOUND: 404,
  API_KEY_INVALID: 401,
  RATE_LIMITER_UNAVAILABLE: 503,
  // The request's database connection was lost mid-request; only it failed. Retryable.
  DB_CONNECTION_LOST: 503,
  CREDENTIAL_NOT_FOUND: 404,
  CREDENTIAL_REVOKED: 409,
  INVALID_IDENTIFIER: 404,
  // Phase 4: runs and replays.
  JOB_NOT_FOUND: 404,
  JOB_NOT_REPLAYABLE: 409,
  // Phase 5: reports.
  REPORT_NOT_FOUND: 404,
  RUN_NOT_SETTLED: 409,
};

export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    const { problem: body, retryAfterSeconds } = toProblem(error);
    if (body.status >= 500) request.log.error({ err: error }, "request failed");
    if (retryAfterSeconds !== null) void reply.header("retry-after", String(retryAfterSeconds));
    return reply.code(body.status).type("application/problem+json").send(body);
  });
  app.setNotFoundHandler((_request, reply) =>
    reply
      .code(404)
      .type("application/problem+json")
      .send(problem(404, "ROUTE_NOT_FOUND", "No such route.")),
  );
}
