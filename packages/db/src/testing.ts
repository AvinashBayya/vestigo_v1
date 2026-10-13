/**
 * Test support, exported as `@repo/db/testing`. Never imported by application
 * code: it drops and recreates databases.
 */
import { AppError } from "@repo/core";
import pg from "pg";
import { migrateDatabase } from "./migrate.ts";

export class UnsafeTestDatabaseError extends AppError {
  readonly code = "TEST_DATABASE_UNSAFE";

  constructor(message: string) {
    super(message);
    this.name = "UnsafeTestDatabaseError";
  }
}

/**
 * The test database server could not be reached. Says where it looked (host
 * and port, never the credentials) and how to start it, instead of an
 * unhandled connection error.
 */
export class TestDatabaseUnreachableError extends AppError {
  readonly code = "TEST_DATABASE_UNREACHABLE";

  constructor(where: string, cause: string) {
    super(
      `The test database server is not reachable at ${where} (${cause}). Start it from the repository root with "docker compose up -d --wait", then run the tests again.`,
    );
    this.name = "TestDatabaseUnreachableError";
  }
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/** How long a test setup waits for the database server before saying it is unreachable. */
const CONNECT_TIMEOUT_MS = 5_000;

/** Connection failures that mean no server answered, as the driver reports them. */
const UNREACHABLE = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
]);

/** Connects, or fails with TestDatabaseUnreachableError when no server answers. */
async function connectOrExplain(client: pg.Client, url: URL): Promise<void> {
  try {
    await client.connect();
  } catch (error) {
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : null;
    const timedOut = error instanceof Error && /timeout/i.test(error.message);
    if ((code !== null && UNREACHABLE.has(code)) || timedOut) {
      const where =
        url.port === "" ? `${url.hostname} (default port)` : `${url.hostname}:${url.port}`;
      throw new TestDatabaseUnreachableError(where, code === null ? "timed out" : code);
    }
    throw error;
  }
}

/**
 * Drops and recreates the database named in `ownerUrl`, grants CONNECT to the
 * given roles, and applies every migration, so a suite always runs against
 * exactly what the migrations produce. Refuses any database whose name does
 * not end in `_test`, so a misconfigured URL cannot drop a real database, and
 * fails with TestDatabaseUnreachableError, saying how to start the server,
 * when no server answers.
 */
export async function recreateTestDatabase(options: {
  readonly ownerUrl: string;
  readonly connectRoles: readonly string[];
}): Promise<void> {
  const owner = new URL(options.ownerUrl);
  const databaseName = owner.pathname.slice(1);
  if (!IDENTIFIER.test(databaseName) || !databaseName.endsWith("_test")) {
    throw new UnsafeTestDatabaseError(
      `refusing to recreate "${databaseName}": a test database name must end in _test`,
    );
  }
  for (const role of options.connectRoles) {
    if (!IDENTIFIER.test(role))
      throw new UnsafeTestDatabaseError(`"${role}" is not a plain role name`);
  }

  const maintenance = new URL(options.ownerUrl);
  maintenance.pathname = "/postgres";
  const client = new pg.Client({
    connectionString: maintenance.toString(),
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
  });
  await connectOrExplain(client, maintenance);
  try {
    await client.query(`drop database if exists ${databaseName} with (force)`);
    await client.query(`create database ${databaseName}`);
    await client.query(`revoke all on database ${databaseName} from public`);
    if (options.connectRoles.length > 0) {
      await client.query(
        `grant connect on database ${databaseName} to ${options.connectRoles.join(", ")}`,
      );
    }
  } finally {
    await client.end();
  }

  await migrateDatabase(options.ownerUrl);
}

/** buildProbeGraph was asked for a graph it cannot build, or could not count what it built. */
export class ProbeGraphError extends AppError {
  readonly code = "PROBE_GRAPH_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "ProbeGraphError";
  }
}

/** How many domains buildProbeGraph makes unless told otherwise. */
export const PROBE_GRAPH_DOMAINS = 6_000;

/** What buildProbeGraph wrote, counted afterwards from the tables. */
export interface ProbeGraphCounts {
  readonly entities: number;
  readonly relationships: number;
  readonly claims: number;
}

/** The person entity of the relationship chain (see buildProbeGraph). */
const PROBE_PERSON = "[Person, three relationships out]";

/**
 * A tenant graph large enough that the person probe before D-35 ran out of
 * time on it (docs/PLAN.md, D-35 and D-36). Written as the application role in
 * the tenant's context, with plain SQL, then analysed as the schema owner, as
 * autovacuum leaves a production table: the old probe was slow only once the
 * planner had statistics.
 *
 * `domains` domains, each resolving to its own address and to the next
 * domain's, and each using one of eight shared nameservers, so a walk from any
 * domain spreads across the graph within three relationships. Every entity and
 * relationship carries a claim citing the technical evidence. Then two chains,
 * their relationships pointing both ways:
 *   - the entity case pins d0; d0 -> e1 <- e2 -> e3, and e3 carries a claim
 *     citing the person evidence: person data three relationships out;
 *   - the relationship case pins r0, which the middle domain links to;
 *     r1 -> r0, r1 -> r2, r3 -> r2, and a person -> r3, the claim citing the
 *     person evidence being on that last relationship: person data on a
 *     relationship at an entity three relationships out.
 * Each chain's person data is more than three relationships from the other
 * case's pin. Names are reserved example.com names or bracketed placeholders.
 */
export async function buildProbeGraph(options: {
  readonly runtimeUrl: string;
  readonly ownerUrl: string;
  readonly tenantId: string;
  /** Evidence of the tenant's from a technical collector. */
  readonly technicalEvidenceId: string;
  /** Evidence of the tenant's from a person-discipline collector. */
  readonly personEvidenceId: string;
  /** Two empty cases of the tenant's. */
  readonly entityCaseId: string;
  readonly relationshipCaseId: string;
  readonly domains?: number;
}): Promise<ProbeGraphCounts> {
  const domains = options.domains ?? PROBE_GRAPH_DOMAINS;
  if (!Number.isInteger(domains) || domains < 16) {
    throw new ProbeGraphError("domains must be a whole number of at least 16");
  }
  const last = String(domains - 1);
  const client = new pg.Client({ connectionString: options.runtimeUrl });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.tenant_id', $1, true)", [options.tenantId]);
    const run = <R extends pg.QueryResultRow = pg.QueryResultRow>(
      text: string,
      values: readonly unknown[] = [],
    ) => client.query<R>(text, [options.tenantId, ...values]);

    await run(
      `insert into entities (tenant_id, kind, display_name)
       select $1::uuid, 'DOMAIN'::entity_kind, 'd' || g || '.probe.example.com' from generate_series(0, ${last}) g
       union all
       select $1::uuid, 'IP_ADDRESS'::entity_kind, '[address ' || g || ']' from generate_series(0, ${last}) g
       union all
       select $1::uuid, 'DOMAIN'::entity_kind, 'ns' || g || '.probe.example.com' from generate_series(0, 7) g
       union all
       select $1::uuid, 'DOMAIN'::entity_kind, n || '.probe.example.com'
         from unnest(array['e1', 'e2', 'e3', 'r0', 'r1', 'r2', 'r3']) n
       union all
       select $1::uuid, 'PERSON'::entity_kind, $2::text`,
      [PROBE_PERSON],
    );
    // Every domain: its own address, the next domain's, and one of eight nameservers.
    const everyDomain = (target: string, kind: string) =>
      run(
        `insert into entity_relationships (tenant_id, source_entity_id, target_entity_id, kind)
         select $1, s.id, t.id, $2 from generate_series(0, ${last}) g
         join entities s on s.tenant_id = $1 and s.display_name = 'd' || g || '.probe.example.com'
         join entities t on t.tenant_id = $1 and t.display_name = ${target}`,
        [kind],
      );
    await everyDomain(`'[address ' || g || ']'`, "resolves_to");
    await everyDomain(`'[address ' || ((g + 1) % ${String(domains)}) || ']'`, "resolves_to");
    await everyDomain(`'ns' || (g % 8) || '.probe.example.com'`, "uses_nameserver");
    const chain: readonly (readonly [source: string, target: string])[] = [
      ["d0.probe.example.com", "e1.probe.example.com"],
      ["e2.probe.example.com", "e1.probe.example.com"],
      ["e2.probe.example.com", "e3.probe.example.com"],
      [`d${String(Math.floor(domains / 2))}.probe.example.com`, "r0.probe.example.com"],
      ["r1.probe.example.com", "r0.probe.example.com"],
      ["r1.probe.example.com", "r2.probe.example.com"],
      ["r3.probe.example.com", "r2.probe.example.com"],
      [PROBE_PERSON, "r3.probe.example.com"],
    ];
    for (const [source, target] of chain) {
      await run(
        `insert into entity_relationships (tenant_id, source_entity_id, target_entity_id, kind)
         select $1, s.id, t.id, 'linked_to' from entities s, entities t
         where s.tenant_id = $1 and t.tenant_id = $1 and s.display_name = $2 and t.display_name = $3`,
        [source, target],
      );
    }
    // A technical claim on everything, then the two person claims.
    await run(
      `insert into claims (tenant_id, evidence_id, entity_id, attribute, value, strength)
       select $1, $2, e.id, 'note', '"[claim]"'::jsonb, 'REPORTED' from entities e
       where e.tenant_id = $1`,
      [options.technicalEvidenceId],
    );
    await run(
      `insert into claims (tenant_id, evidence_id, relationship_id, attribute, value, strength)
       select $1, $2, r.id, 'note', '"[claim]"'::jsonb, 'REPORTED' from entity_relationships r
       where r.tenant_id = $1`,
      [options.technicalEvidenceId],
    );
    await run(
      `insert into claims (tenant_id, evidence_id, entity_id, attribute, value, strength)
       select $1, $2, e.id, 'note', '"[person claim]"'::jsonb, 'REPORTED' from entities e
       where e.tenant_id = $1 and e.display_name = 'e3.probe.example.com'`,
      [options.personEvidenceId],
    );
    await run(
      `insert into claims (tenant_id, evidence_id, relationship_id, attribute, value, strength)
       select $1, $2, r.id, 'note', '"[person claim]"'::jsonb, 'REPORTED'
       from entity_relationships r
       join entities s on s.tenant_id = r.tenant_id and s.id = r.source_entity_id
       where r.tenant_id = $1 and s.display_name = $3`,
      [options.personEvidenceId, PROBE_PERSON],
    );
    for (const [caseId, pinned] of [
      [options.entityCaseId, "d0.probe.example.com"],
      [options.relationshipCaseId, "r0.probe.example.com"],
    ] as const) {
      await run(
        `insert into case_pins (tenant_id, case_id, entity_id)
         select $1, $2, e.id from entities e where e.tenant_id = $1 and e.display_name = $3`,
        [caseId, pinned],
      );
    }
    const counted = await run<{ entities: number; relationships: number; claims: number }>(
      `select (select count(*) from entities where tenant_id = $1)::int as entities,
              (select count(*) from entity_relationships where tenant_id = $1)::int as relationships,
              (select count(*) from claims where tenant_id = $1)::int as claims`,
    );
    await client.query("commit");
    const counts = counted.rows[0];
    if (counts === undefined) throw new ProbeGraphError("the probe graph could not be counted");

    const owner = new pg.Client({ connectionString: options.ownerUrl });
    await owner.connect();
    try {
      await owner.query(
        "analyze entities, entity_relationships, claims, evidence, collectors_registry, case_pins, entity_merges",
      );
    } finally {
      await owner.end();
    }
    return counts;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}
