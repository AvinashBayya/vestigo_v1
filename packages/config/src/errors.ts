export interface ConfigIssue {
  /** The environment variable at fault. */
  readonly variable: string;
  /** What is wrong with it. Never includes the value, which may be a secret. */
  readonly problem: string;
}

/**
 * Thrown when the environment does not satisfy the schema. The message names
 * every offending variable so a failed start is diagnosable from one line of
 * output.
 */
export class ConfigError extends Error {
  readonly code = "CONFIG_INVALID";
  readonly issues: readonly ConfigIssue[];

  constructor(issues: readonly ConfigIssue[]) {
    const lines = issues.map((issue) => `  ${issue.variable}: ${issue.problem}`);
    const noun = issues.length === 1 ? "problem" : "problems";
    super(
      `Invalid environment configuration (${String(issues.length)} ${noun}):\n${lines.join("\n")}`,
    );
    this.name = "ConfigError";
    this.issues = issues;
  }
}
