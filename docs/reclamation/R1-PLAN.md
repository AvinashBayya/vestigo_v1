# R1 plan: the case analysis engine

R1-0, 2026-10-08. A plan only: nothing is ported, no package is created and no code is written by
this stage. It rests on `R1-INVENTORY.md` (every export of `legacy/src/utils/cases/`, with its
verdict) and `R1-HONESTY.md` (what each capability claims and can honestly claim). Every
recommendation below that changes a rule, a package list, a definition or a schema waits for the
owner (Decisions for the owner, at the end).

## Owner's rulings (2026-10-08)

R1-0 was approved. The rulings below bind the sub-stages; where they differ from the text
further down, they win.

- **Accepted as recommended:** D-1, D-2, D-3, D-5, D-14, D-19, D-20, D-28; credibility moves
  to R2 (D-6's recommendation on that point); the model summary is its own stage, R1-f.
- **D-1, condition:** moving the run report's coverage helpers into `case-engine` is a pure
  move, with a test proving identical output before and after.
- **D-14, condition:** adding `?? ""` to the fabrication gate is a separate commit. Every file
  it flags is fixed by rewriting; no allowlist.
- **D-10:** fixed now, before R1-a (its own prompt).
- **The rest, ruled on 2026-10-08** after D-10c, each marked RULED beside its heading below:
  D-4, D-6 (credibility to R2), D-7 (drop the bands), D-8 (deferred with retention), D-9
  (summary only), D-11 (approved for R1-e: specified in DESIGN-SYSTEM §9 first, in the
  gallery in every state), D-12 (in R1-e: SESSION_REQUIRED, the shared person gate, a visible
  undo), D-13, D-15 (after R1), D-16, D-17 (with conditions, met in the inventory and in
  `docs/audit/INVENTORY.md`), D-18, D-21, D-22 (its final wording goes to the owner before it
  is committed), D-23 (recorded in ARCHITECTURE-DECISIONS.md now, enforced when R3 lands),
  D-24, D-25, D-26, D-27 (as defined); and D-2's related option, merge candidates relabelled
  HYPOTHESIS in R1-e. No decision is held.

On the items D-10 raised (2026-10-08, after D-10 was approved):

- **D-29 accepted:** the probe follows merge partners, for the entity list's merge count and
  the merge route's 409. Done in D-10b.
- **D-30 accepted:** job replay is gated, reversing the Phase 6a ruling, because a replay
  re-queues person collection. Done in D-10b; the reversal is recorded in
  `docs/ARCHITECTURE-DECISIONS.md` §6.
- **D-31 accepted with changes, then the cheaper option chosen:** the entity list and merge
  candidates probe the whole scope in one SQL query, the merge list keeps a fixed window (its
  residual accepted), and the graph probes its whole hops-bounded neighbourhood in SQL whatever
  `maxNodes` asks. Done in D-10c, which raised D-33 (the cost at three hops).
- **D-32 accepted, folded into R1-b as its prerequisite:** not built now.

On the items R1-a raised (2026-10-09, after R1-a was approved):

- **Wording.** The drafts for `NO_NEW_COLLECTION`, `COUNTS_ARE_NOT_COVERAGE` and
  `DISCIPLINE_FROM_REGISTRY` are approved as written. `ENTITY_AND_RELATIONSHIP_COUNTS_OVERLAP` is
  split into shorter sentences, and `UNMEASURED_IS_NOT_ZERO` names "locked" as a cause. The
  breakdown headline is the previous codebase's, except that when all of a case's records come
  from collectors no longer registered it says "{n} evidence records are held, all from
  collectors no longer registered." A case-level headline stays deferred.
- **D-3's input hash** is computed in R1-b's job, not in `case-engine`.
- **The job processor is not in `case-engine`** (supersedes D-1's processor clause).
  `case-engine` stays pure, on `core` only. The processor goes in `apps/worker`, or in a thin
  package depending on `case-engine`, `db`, `llm` and `access`.
- **HELD stays.** A discipline whose collectors were all locked shows null with the reason
  `LOCKED`, not a measured zero.
- **The lock reasons move to `core`**, in a commit of their own.
- **Merges** (D-21) go into R1-c's input.
- **R1-b's input contract is accepted**: the seven refusals R1-a added stand.
  `CollectionExecutor.collect` is fixed so it cannot break them.
- **Accepted as built:** a case with records but no evidence is partial; a recomputed run's
  coverage may differ from a stored report; the renames made in the move; a missing field inside
  a record fails with an uncoded error, as the types forbid it.
- **Fixed as a behaviour change**, in a separate commit with updated golden files:
  `displayValue(undefined)`, truncation that splits an emoji, and the "all 0 planned collectors"
  headline.

## What R1 is, after reading the code

`docs/MASTER-BUILD-SEQUENCE.md` (lines 77-83) scopes R1 as cross-intelligence correlation,
contradiction detection, case scope, intelligence breakdown and gaps, with a UI that fills the
case workspace's empty analysis cards. Reading the legacy code against what is built here
narrows that:

- **Much of `cases/` is already built here, better.** Attaching results to a case is `case_pins`
  and the pins API. Entity resolution happens once, at write time, by exact identifier; name
  matches are only offered as merge candidates and every merge is a reversible record. The run
  status rollup, truncation disclosure and scope checks exist. Run-level completeness was ported
  in Phase 5 (`packages/osint-engine/src/reports/assemble.ts`), and so was the grounded-answer
  validator (`packages/llm/src/citations.ts`). 109 of 224 exports are DROP, most of them
  browser-storage code made obsolete by server-side storage, and 10 more are not ported whatever
  their verdict (9 already built here, 1 with no consumer in R1).
- **What is genuinely new** is analysis over a case: a case's coverage across the runs its pins
  came from; a breakdown of what the case holds; links between records from different collectors
  (cross-intelligence); places where collectors disagree (contradictions); and a written case
  summary, every sentence cited.
- **The data constrains it.** A claim cites exactly one evidence row, so a finding that rests on
  several needs its own record. Cases are not linked to runs (a case is its pins). Every
  comparable infrastructure relationship kind has one producer today (`resolves_to` dns,
  `subdomain_of` crtsh, `uses_nameserver` rdap), and no attribute name is shared by two
  collectors, so contradictions have nothing to compare until a second source states the same
  thing about the same entity. By default production runs only `wikidata` and
  `contact.phone` (eight of ten collectors are licence-UNVERIFIED). R1 must be honest about all of
  this: an analysis with no comparable input says so; it never shows an empty list as "none
  found".
- **Credibility is not R1.** The brief's suggested seam "R1-d contradictions and credibility"
  conflicts with the build sequence (`MASTER-BUILD-SEQUENCE.md:32`, `:85-87`) and the reclamation
  audit (`LEGACY-RECLAMATION-AUDIT.md:134-137`, `:238`), which put credibility, CIB and social in
  R2. There is no credibility module in `cases/`; the nearest thing, per-evidence confidence
  bands, rests on a field we do not collect (D-7). R1-d below is contradictions only (D-6).
- **`osint/verification.ts` and `osint/gaps.ts` hold no analysis.** The build sequence lists them
  for R1. The first is an end-to-end self-test harness, the second a static PS-18-worded
  constant (`docs/audit/INVENTORY.md:127`, `:139`). R1 takes nothing from them; "gaps" is built
  from recorded coverage instead.

## Where the engine lives

**Recommended: a new package, `packages/case-engine`** (D-1), as the build sequence and the
reclamation audit name it, shaped like `packages/osint-engine`:

- `src/analysis/` pure functions and types: no I/O, no clock, no randomness, no network. Inputs
  are plain data mapped from our rows; the time an analysis is stamped with is passed in.
- `src/jobs/` the analysis job processor, following `ReportGenerator`: claim with a lock, work
  outside the transaction, record; deterministic job ids; dead-letter on final failure.
  **[Superseded 2026-10-09: the processor lives outside `case-engine`, in `apps/worker` or a thin
  package depending on `case-engine`, `db`, `llm` and `access`.]**
- Depends on `core`, `db`, `llm` and `zod`, and on `access` only if D-28 lets the job re-check
  plan and vetting. Never on `collectors` or `osint-engine`: the registry's labels and the held
  collectors reach it as data. **[Superseded 2026-10-09: `case-engine` depends on `core` only;
  the other dependencies belong to the processor's package.]**
- **What has to move for that boundary to hold** (part of D-1's cost):
  - the coverage functions `coverageFromJob`, `coverageOf` and `headline`, `COVERAGE_CAVEATS` and
    `displayValue` are private to `packages/osint-engine/src/reports/assemble.ts` (lines 141, 172,
    213, 240). `coverageOf` already takes the held collectors as a parameter (lines 240-245); the
    coupling is its parameter types, `CollectorRegistry` and `HeldCollector` from
    `@repo/collectors` (lines 19-23). Recommended: move them to `case-engine` as pure functions
    over plain data types; `assemble.ts` then imports them (osint-engine may depend on
    case-engine; never the reverse);
  - the queue plumbing (queue names, `DEAD_LETTER_MESSAGE` and its fixed list of kinds,
    `JobRetryError`, the worker's per-kind dead-letter branches) lives in
    `packages/osint-engine/src/jobs/queues.ts` (lines 43-70, 85, 383, 440-455). Recommended: add
    the `case-analyses` queue and a `CASE_ANALYSIS` dead-letter kind there, beside every other
    queue, with the processor injected from `case-engine` by `apps/worker`. The processor
    returns a disposition (retry, completed, dead-lettered), as `CollectorJobProcessor` does, so
    it never needs `JobRetryError` itself.

Why not `packages/osint-engine`: that package collects and fuses (planner, executor, collector
jobs, fusion, run reports). The case engine reads stored evidence only and must never be able to
cause collection (standing rule 9); a package that cannot import the collector runtime makes that
structural rather than a convention. The cost: CLAUDE.md §6's package list does not include it,
so the owner must approve the addition and the list is updated in the same change;
`check-exports.ts` gains an entry and `boundaries.test.ts` a rule forbidding `case-engine` to
depend on `collectors` or `osint-engine`; and the two moves above.

## The order, and why

R1-a, R1-b, R1-c, R1-d, R1-e, R1-f. The pure engine first, so every analysis is testable without
a database. Persistence and the job second, so each analysis after it lands in a stored,
citable, person-gated document. Correlation before contradictions, because both read the same
per-collector view of a case and correlation is the simpler use of it. The UI only once there is
something real to show. The model last: it is the only part that needs `packages/llm`, metering
for something that is not a report, and its own review, and the written summary is better when it
can cite the deterministic findings.

## Sub-stages

Sizes are lines of source plus lines of tests, estimated from the legacy code each stage
replaces and from the closest existing module here; confidence in each estimate is stated.

### R1-a: the engine package, pure

- **Scope.** Create `packages/case-engine` (on D-1). Types for a case's analysis input (the case
  scope: pinned evidence, claims, entities and relationships with their collector, discipline and
  strength, and the jobs and runs the evidence came from) and for its outputs. Pure functions:
  - **case coverage**: the runs that contributed pinned records, each with its recorded coverage
    (the run report's states: collected, nothing found, failed, needs credentials, refused, not
    finished, excluded, held), plus a "collected but not pinned" state, collection dates across
    runs, and the caveat that no new collection was done;
  - **discipline breakdown**: counts of evidence, claims and entities per discipline and per
    collector, from the registry's single discipline per collector; a discipline with no
    registered collector is "Not built" with its reason, never 0;
  - the shared per-collector view that R1-c and R1-d read;
  - the coverage functions moved from `assemble.ts` (D-1).
- **Modules** (from the inventory; the appendix lists all 27): `case-report.ts`
  `CollectionStatus`, `CompletenessReason`, `COMPLETENESS_CAVEATS` (PORT-ADAPTED),
  `CollectionCompleteness`, `CompletenessInput`, `assessCompleteness`, `completenessHeadline`
  (REWRITE: rewritten at run level in Phase 5, extended here to a case);
  `case-intelligence-breakdown.ts` (18 PORT-ADAPTED, 2 REWRITE: `buildCaseIntelligenceBreakdown`
  without `?? 0`, and `BreakdownInput`). `CaseReportProvenance` waits for a case report (D-15);
  `NO_EXHAUSTIVE_CLAIM` is already `COVERAGE_CAVEATS[0]`.
- **Database / API.** None.
- **Release-blocking tests.** Every function has a test for its honest empty and unavailable case
  (no pins; pinned evidence with no recorded job, D-4; a discipline with no collector shows Not
  built, not 0). The run report's coverage is unchanged after the move (its existing tests). A
  test that fails on the legacy behaviour for each REWRITE row (for example a missing GEOINT
  count rendered as 0). No comparison of a discipline with `PERSON` (the person-gate guard).
  Fabrication check clean. A determinism test: same input, same output, no clock read.
- **Turns on.** Nothing in the UI yet.
- **Depends on.** D-1, D-4, D-17.
- **Size.** About 800 + 1,100 lines. Confidence: medium.
- **Stops at.** The package builds, its tests pass, the full pipeline is green. **Checkpoint:**
  functions and types added, each mapped to its inventory rows; tests per function including the
  empty cases; the legacy-behaviour tests and what each one would have caught; pipeline counts.

### R1-b: persistence, job and API

- **Prerequisite (D-32, ruled).** Before anything else in R1-b: each gated read and its probe
  run on one snapshot (a repeatable-read transaction for gated reads), so a case scope that
  shrinks (an unpin) or grows (a fusion) between the read and the probe cannot leak.
- **Scope.** A write-once case analysis record and the job that produces it, following the
  `reports` pattern (D-3):
  - migration: `case_analyses` (tenant_id, id, case_id, status, the **input hash**, engine
    version, idempotency key unique, `document` jsonb written once on success, error code and
    message, requested by, created, started and finished times), with its `_security.sql`
    partner (forced RLS, the tenant policy, column grants, the write-once trigger). The input
    hash covers what the analysis actually read, not the pins: a case's scope includes every
    claim on a pinned entity or relationship (`exploration.ts:44-50`), which later runs extend
    (`fuse.ts:131-141`), and merges and undos change what is folded. So it hashes the evidence
    ids, claim ids, active merge ids, the contributing jobs with their status and outcome, the
    held collector list, the registry disciplines and labels used, and the engine version;
  - deletion and retention: the document holds entity values, so it must go wherever the
    evidence it rests on goes (CLAUDE.md §9). No tenant deletion path exists yet and retention is
    not enforced (`enforced: false`), so R1-b makes sure the write-once trigger never blocks a
    delete and lists `case_analyses` wherever that future deletion enumerates tenant tables;
  - repository in `packages/db` under tenant context, listed in `REPOSITORY_TABLES` so the
    isolation tests cover it;
  - queue `case-analyses` with a zod message, a dead-letter kind, a deterministic job id, its own
    concurrency setting and a job timeout; the processor in `apps/worker` or a thin package
    depending on `case-engine`, `db`, `llm` and `access` (not in `case-engine`, ruled
    2026-10-09), which also computes the input hash (D-3);
  - API: `POST /api/v1/cases/:id/analyses` (request; the same input hash returns the existing
    analysis unless it failed, or its summary failed, in which case a new attempt is made, keyed
    by input hash and attempt), `GET /api/v1/cases/:id/analyses` and `GET /api/v1/case-analyses/:id`, with zod
    schemas so the OpenAPI entries and the web client are generated.
- **Modules.** None ported; it runs R1-a's functions.
- **Person data.** Requesting and reading an analysis are reads resting on the case scope **and on
  every run that contributed to it**: case coverage lists each run's jobs, including a person
  collector's NOTHING_FOUND, and CLAUDE.md §9 says a run that used a person collector is person
  data whatever its jobs found. Today `touchesPersonData` checks a case scope's evidence only, and
  `PersonProbe.runJobs` takes one run (`exploration.ts:110`, `:267`, `:300-311`), so the shared
  probe gains a list of runs (D-19). A stored analysis holds what it read when it ran, and the
  gate applies however old the data is, so reading one (`GET /api/v1/case-analyses/:id`, and
  each item of `GET /api/v1/cases/:id/analyses`) probes the evidence ids and run ids recorded in
  that document as well as the case as it is now (`PersonProbe.evidenceIds`, in chunks under
  its 1,000-id limit at `exploration.ts:114`, plus D-19's run list). All three endpoints use
  `requirePersonAccess` and are refused whole. A read recomputes the input hash and says "the
  evidence behind this case has changed since" when it differs.
- **Release-blocking tests.** Cross-tenant isolation for the new table (RLS and repository);
  schema test (tenant_id, forced RLS, tenant-first indexes); the person gate refuses the whole
  read and the request when any pinned record is person data, **and when a contributing run had a
  PERSON job that found nothing** (both POST and GET); an analysis made while a person record was
  pinned is refused after that pin is removed; idempotency (same input, one analysis, one job);
  a failed analysis can be requested again; a new run adding a claim to a pinned entity makes the next request a new analysis; a
  failing analysis lands in the dead-letter queue and never blocks collection or reports; the
  document cannot be rewritten, yet a delete under tenant context succeeds; the OpenAPI contract
  test and the generated client.
- **Turns on.** Nothing visible yet (R1-e shows it).
- **Depends on.** R1-a; D-3, D-19, D-28, D-32 (its prerequisite, built first); D-10 fixed
  first (a person-gate defect in the merge routes, so the stage does not build on it).
- **Size.** About 1,300 + 1,300 lines (migration, repository, queue, processor, routes).
  Confidence: medium-low; the queue wiring touches eight places (see the worker's pattern for
  reports).
- **Stops at.** An analysis can be requested and read through the API in a live run, both themes
  irrelevant (no UI). **Checkpoint:** migration and security file, endpoints with their
  operation ids, the isolation and person-gate test results, a live request against a provisioned
  tenant, pipeline counts.

### R1-c: cross-intelligence

- **Scope.** Links between records from different sources, never from comparing values: an
  entity (already resolved by identifier at write time) asserted by claims from two or more
  collectors, and a relationship asserted by two or more. Whether "different sources" means
  different collectors or different disciplines is D-20; either way, links every collector makes
  by construction (the run's own target entity, `account_with_handle` from each platform) are not
  correlations. Each correlation lists the evidence of every collector behind it. Strength
  DERIVED (D-2), or HYPOTHESIS when any part rests on a hypothesis. Merged entities are folded
  before comparing only if D-21 says so. Distinct-source counts per entity in the case, which
  the Entities tab cannot show today (counted over the case's scope only, in the analysis
  document; a run's Entities tab keeps its "Sources are not counted" footer).
- **Modules** (17, listed in the appendix). `cross-intelligence.ts`: 13 PORT-ADAPTED (the types,
  `CORRELATION_TYPES` reduced to what our relationship kinds support, and
  `CORRELATION_NOT_A_FINDING` and `NO_CORRELATIONS_MESSAGE`, whose wording follows D-20), 1
  PORT-AS-IS (`NOT_IMPLEMENTED`), 2 REWRITE (`buildCrossIntelligence`, which dropped the merge
  score and counts sources by D-20's rule; `summariseCrossIntelligence` without `?? 0`);
  `case-entities.ts` `contributingSourcesOf` (PORT-ADAPTED, from `collector_id`). Of the other
  eight `case-entities.ts` rows, five are DROP and three are already built here (write-time
  resolution and merge candidates).
- **Database / API.** None new: it writes into the R1-b document.
- **Release-blocking tests.** A single collector's records are never a correlation, whatever it
  declares (the legacy defect counted disciplines); two entities with the same display name and
  no shared identifier are never linked; the run's own target and `account_with_handle` links are
  not reported as correlations; every correlation cites evidence from at least two collectors; no
  number without its evidence; a case with one collector says "no correlation is possible from
  one source", not "none found"; source labels come from the registry.
- **Turns on.** Correlations in the case analysis document; shown in R1-e.
- **Depends on.** R1-a, R1-b, D-2, D-20, D-21, D-22.
- **Size.** About 400 + 650 lines. Confidence: medium.
- **Stops at.** Correlations computed on fixtures and in a live analysis. **Checkpoint:** each
  correlation type kept or dropped and why, the legacy-defect tests, pipeline counts.

### R1-d: contradictions

- **Scope.** Where collectors disagree about the same thing: for **the same entity id** (or
  entities joined by an active analyst merge, D-21), a relationship kind or an attribute that two
  collectors both state, with value sets that share nothing. Legacy compared relationship
  targets only (`osint/contradictions.ts:122`); comparing attributes is new design, not a port,
  and needs value normalisation (D-5). Comparability is a reviewed map, never inferred from
  names. The flag is DERIVED; the explanation is
  HYPOTHESIS; each side keeps its stored strength; the engine adjudicates nothing
  (`NO_ADJUDICATION_CAVEAT`). Grouping by `evidence.collector_id`, never a collector-supplied
  string. Credibility is not here (D-6).
- **Modules** (16, listed in the appendix). `case-contradictions.ts`: PORT-ADAPTED types,
  `toContradictionInputs`, `summariseCaseContradictions`, the limitation list and
  `NO_ADJUDICATION_CAVEAT` (reworded: a contradiction is not a finding); REWRITE
  `observedAtByCollector` (legacy stored a collection time as the observation time; each side
  carries its own `observed_at` and `collected_at`) and `buildCaseContradictions` (no minted
  references; media claims out). From the delegated
  `osint/contradictions.ts`: `detectContradictions` (PURE) adapted, `summariseContradictions`
  rewritten without `?? 0`. `case-report.ts`: `ReportContradiction`, `NO_CONTRADICTIONS_MESSAGE`
  and `CONTRADICTION_CAVEAT` (PORT-ADAPTED), and `toReportContradictions` rewritten (legacy
  hard-codes `claimClassA: "OBSERVED"`).
- **Database / API.** None new.
- **Release-blocking tests.** Kinds not in the comparability map are never compared (otherwise one
  username on two platforms reads as a contradiction); statements about two different entities
  are never compared unless an active analyst merge joins them; a contradiction needs two
  collectors; `observed_at` and `collected_at` are never substituted for each other; no
  "different collection times" sentence unless the times were compared; an entity id with a space
  is not truncated (a legacy defect); when nothing is comparable the result says which second
  source is missing, never "no contradictions".
- **Turns on.** Contradictions in the analysis document; shown in R1-e.
- **Depends on.** R1-a, R1-b, D-5, D-6, D-21, D-22.
- **Size.** About 500 + 750 lines. Confidence: medium.
- **Stops at.** Contradictions computed on fixtures (with two comparable collectors) and a live
  analysis that honestly reports nothing comparable. **Checkpoint:** the comparability map as
  reviewed, the tests, pipeline counts.

### R1-e: the workspace UI

- **Scope.** Built from `packages/ui` only. On a case's Overview: request and read the case
  analysis, with its time and a notice when the evidence behind the case has changed since; case
  coverage and gaps (the
  run-only "Gaps to close" card, for a case); the discipline breakdown; correlations;
  contradictions (a neutral callout titled "Contradiction", amber only on an INFERRED item, per
  DESIGN-SYSTEM §12). On a run's Overview, the same analysis for that run's records is a decision
  inside D-3. On a case's Entities tab, distinct-source counts from the analysis document, and
  the merge review (D-12, ruled: SESSION_REQUIRED, the shared person gate, a visible undo),
  with merge candidates relabelled from INFERRED to HYPOTHESIS (D-2, ruled).
- **Components.** Uses existing components. Needs three that U1-c raised and did not build (a
  count chip, a strength badge with a count, a gaps list): D-11.
- **Release-blocking tests.** The contradictions card never shows a number or an empty list when
  the analysis has nothing comparable (it shows the reason); a lock withholds the whole analysis;
  44px targets, contrast and tokens (the existing audits), both themes; the headless audit of
  every changed screen; the person gate on the client is never a decision (the API decides).
- **Turns on.** OverviewTab "Where one source denies what another states" (contradictions, for a
  case), "Gaps to close" for a case, the uncounted totals where the breakdown counts them, the
  Entities footer "Sources are not counted" for a case (a run keeps it), and the
  merge-candidates card if D-12 says so.
- **Depends on.** R1-b, R1-c, R1-d; D-11, D-12.
- **Size.** About 1,200 + 900 lines, plus about 300 + 300 for the merge review screen if D-12
  says yes, and more if D-11 adds components. Confidence: low-medium.
- **Stops at.** Every changed screen audited live in both themes. **Checkpoint:** screen-by-screen
  list, the Not built cards turned on and the ones that stay, raised items, pipeline counts.

### R1-f: the written case summary (model)

- **Scope.** A summary of a case written by the model from the case's records and R1-c/R1-d's
  findings, every sentence cited. Through `packages/llm` only: `generateValidated` with the
  `synthesis` task (LARGE), records framed as untrusted, the open-weight allowlist, schema
  validation, `validateCitations` (CORRELATED needs two independent sources), `checkOutput`, the
  per-tenant cache, tokens metered per tenant and checked against quota before the call. Strengths
  CORRELATED, INFERRED or HYPOTHESIS only. Runs inside the R1-b job, so it has a timeout,
  idempotency key and dead-letter path, and a model failure leaves the deterministic analysis
  intact.
- **Modules** (26, listed in the appendix). `case-analysis.ts`: PORT-ADAPTED `GroundedFinding`,
  `GroundedFindingSchema` (with our strengths), `GroundedResult`, `GROUNDED_SYSTEM` (rewritten as
  trusted text without the defence framing), `analyseCaseGrounded` (as a task, not a server
  function); REWRITE `GroundedAnswerSchema`, `GroundedAnswer`, `serializeCaseContext` (no
  invented confidence, records framed), `buildGroundedPrompt` (its summary half; the question
  half waits on D-9). `GroundedInput`, which carries the analyst's question, waits on D-9.
  `case-context.ts`: the model's view of a case, `buildCaseContext` (REWRITE: built on the
  server from the case scope and R1-c/R1-d's findings, without read-time entity resolution) and
  its types, the `MAX_CONTEXT_*` caps (PORT-AS-IS), `isSecretKey` (with the key names legacy
  missed), `summariseValue`, `citableEvidenceIds`, `resolveCitation`. Already built here, so not
  ported: `GroundedProblem`, `assertsCertainty`, `validateGroundedAnswer`. DROP
  `llmAnalyseCaseGrounded` (a browser-trusting server function).
- **Database / API.** Migration: `usage_events` gains a nullable `case_analysis_id` (today LLM
  tokens can only be tied to a report), D-16. The summary is part of the analysis document.
- **Release-blocking tests.** An uncited sentence is retried once, then the summary fails and the
  rest of the analysis stands; a citation outside the case scope is rejected; a citation must be
  an evidence id, never an R1-c or R1-d finding id (CLAUDE.md §4: every claim maps to evidence);
  a sentence labelled OBSERVED, REPORTED or DERIVED is rejected; on a fixture, a sentence
  labelled CORRELATED or INFERRED whose citations rest only on HYPOTHESIS claims is rejected
  (D-27; latent until R3); instructions inside
  collected content are not
  followed (the injection fixtures); tokens metered once per call, never on a cache hit; a quota
  refusal before any call; no direct provider call (the package boundary).
- **Turns on.** OverviewTab "Written summary" for a case. The run's Overview keeps pointing to
  its report.
- **Depends on.** R1-b, R1-c, R1-d; D-9, D-16, D-27, D-28.
- **Size.** About 600 + 800 lines. Confidence: medium.
- **Stops at.** A live summary against the configured model, or, where no model is configured,
  the honest "not configured" state. **Checkpoint:** prompt version, the validation results on the
  eval fixtures, metering rows, pipeline counts.

### The stages in one table

| Stage | Scope | Size (source + tests) | Confidence | Depends on |
|---|---|---|---|---|
| R1-a | `packages/case-engine`: pure types, case coverage, discipline breakdown | 800 + 1,100 | medium | D-1, D-4, D-17 |
| R1-b | `case_analyses` table, analysis job, three endpoints, person gate over the case and its runs | 1,300 + 1,300 | medium-low | R1-a, D-3, D-10, D-19, D-28, D-32 |
| R1-c | Cross-intelligence across sources, never by value | 400 + 650 | medium | R1-a, R1-b, D-2, D-20, D-21, D-22 |
| R1-d | Contradictions about the same entity, from a reviewed comparability map | 500 + 750 | medium | R1-a, R1-b, D-5, D-6, D-21, D-22 |
| R1-e | Workspace UI: analysis, coverage, breakdown, correlations, contradictions | 1,200 + 900 | low-medium | R1-b, R1-c, R1-d, D-11, D-12 |
| R1-f | Written case summary through `packages/llm` | 600 + 800 | medium | R1-b to R1-d, D-9, D-16, D-27, D-28 |

About 4,800 lines of source and 5,500 of tests in all, before D-12 and D-11. The legacy
declarations whose ideas R1 keeps span about 1,500 lines (the rest is dropped, already built,
or waits for a later stage).

## What R1 deliberately does not do

- No collection of any kind, and nothing that can cause an outbound request to a target.
- No credibility, CIB or social analysis (R2). No GEOINT, MEDIAINT claims or person
  investigation (R3). No media forensics (R4).
- No automatic merge or link of any entity by name or by value similarity; no change to how fusion
  resolves entities. Name matches stay merge candidates for an analyst.
- No new score, confidence, percentage or band that is not computed from cited evidence; no
  per-evidence confidence (D-7).
- No strength raised by the engine. No edit or deletion of evidence, claims or entities.
- No case report (D-15), no case-to-run table (D-4), no retention tombstones (D-8), no question
  answering over a case unless D-9 says so.
- No mobile navigation sheet, no map renderer, no media screens.
- Nothing from `osint/verification.ts` or `osint/gaps.ts`.
- No change to the fabrication gate except to strengthen it, and only on D-14.

## Standing rules for every R1 sub-stage

Copied verbatim from the R1-0 brief. They bind every later prompt.

1. Never fabricate. Unmeasured is null, or an em dash plus reason. Never 0,
   never "N/A", never a default score, never a placeholder bar.
2. Tenant isolation is absolute: RLS, db.withTenant() always, no repository
   call without tenant context.
3. Every claim cites evidence IDs. A claim without a citation is rejected, not
   shown. Claim strength is one of the six enum values and is never upgraded
   by the engine without new evidence.
4. observed_at and collected_at stay separate. Null stays null.
5. People and organisations are never auto-merged by name. Merges are
   reversible records.
6. Person data goes through the shared gate: personGate in packages/access.
   The API reaches it through requirePersonAccess and personLockFor; the case
   analysis job calls it directly before it reads the case's records, and
   fails with the gate's code if refused. The gate refuses the whole read,
   never thins it. person-gate-guard must stay green. (Amended in R1-b under
   D-28.)
7. Any LLM call goes through packages/llm: open-weight allowlist, delimited
   collected content, schema-validated output, citation validation, per-tenant
   cache, token metering. No direct provider calls.
8. Source labels come from the registry, never from a string in the engine.
9. Passive only. Nothing here may cause outbound requests to a target. Analysis
   reads stored evidence only.
10. Fault isolation: analysis runs as a job with a timeout, idempotency key and
    DLQ. A failing analysis never blocks collection or reports.
11. Fabrication gate is never weakened. If a ported file trips it, rewrite the
    file; do not edit the gate and do not add an allowlist.
12. Legacy is read-only reference. Never edit legacy/, never import from it, and
    never copy a file wholesale: port function by function, with a test that
    fails on the legacy fabricating behaviour.
13. Every ported or rewritten function ships with tests, including a test for
    its honest empty or unavailable case.
14. Defence scope is frozen. Anything specific to FUTURE-SCOPE-defence.md is
    DROP.
15. UI uses packages/ui only: colour means strength, status or entity type,
    44px targets, 4.5:1 text and 3:1 dots and borders in both themes, tokens
    only, serif only in the report surface.
16. New runtime dependencies need a raised item, not a quiet install.
17. Each sub-stage ends with an independent critic pass (code against the
    legacy intent and these rules), fixes, and a re-check, as in U1-a to U1-c.

## Decisions for the owner

Each has a recommendation and the cost of each option. Every decision is now ruled (2026-10-08):
the ruling is marked RULED beside its heading, and where a ruling differs from the text beneath
it, the ruling wins.

**D-1. Where the engine lives.** **[RULED 2026-10-08: accepted as recommended, on condition that the run report's coverage helpers move as a pure move, with a test proving identical output before and after.]** **[SUPERSEDED IN PART 2026-10-09: the job processor is not in `case-engine`, which stays pure, on `core` only; the processor goes in `apps/worker` or a thin package depending on `case-engine`, `db`, `llm` and `access`.]**
- *Recommended:* a new `packages/case-engine` (pure analysis plus its job processor). Cost:
  CLAUDE.md §6's package list, `check-exports` and `boundaries.test.ts` are updated in R1-a; the
  coverage functions, `headline`, `COVERAGE_CAVEATS` and `displayValue` move out of
  `osint-engine/src/reports/assemble.ts` into `case-engine` (pure, over plain data types) and
  `assemble.ts` imports them; the `case-analyses` queue
  and a `CASE_ANALYSIS` dead-letter kind are added in `osint-engine/src/jobs/queues.ts`, where
  every queue lives, with the processor injected by `apps/worker` ("Where the engine lives").
- *Alternative:* `packages/osint-engine/src/analysis/`. Cost: no list change, but the analysis
  can import the collector runtime, so "reads stored evidence only" becomes a convention.

**D-2. The strength of a correlation computed by the platform.** **[RULED 2026-10-08: accepted as recommended. The related option is ruled too: merge candidates are relabelled from INFERRED to HYPOTHESIS, in R1-e.]**
- *Recommended:* keep the reviewed definitions. A correlation the engine computes is DERIVED
  (HYPOTHESIS when it rests on a hypothesis); CORRELATED stays for the model. Cost: the word
  "correlation" appears in the UI next to a DERIVED badge, which the copy must explain.
- *Alternative:* widen CORRELATED to "a link drawn by the platform or the analysis model between
  two or more independent cited sources". Cost: changing owner-reviewed wording in
  `report-wording.ts` and its tests, and the report glossary changes for every report.
- *A related option, not settled:* merge candidates are computed by a rule (same kind, same name)
  and labelled INFERRED today. Under the recommended reading they would be HYPOTHESIS (a
  possibility the name match permits); the alternative is to leave them as they are. Cost of
  relabelling: the candidates' API, its tests and the merge copy change.

**D-3. How analysis results are produced and stored.** **[RULED 2026-10-08: accepted as recommended. 2026-10-09: the input hash is computed in R1-b's job, not in `case-engine`.]**
- *Recommended:* a job writing a write-once `case_analyses` document keyed by the case and a
  hash of everything the analysis read (evidence ids, claim ids, active merges, the contributing
  jobs with their status and outcome, the held collectors, the registry disciplines and labels,
  the engine version), like reports. It satisfies standing rule 10, is
  citable and reproducible, and a read can say when the evidence behind the case has changed
  since. Not the pin set: the same pins sit over more evidence as new runs add claims to pinned
  entities. Cost: a migration, a queue and a processor (R1-b), and computing the input hash on
  every read.
- *Alternative:* compute on read in the read model, like merge candidates. Cost: no migration and
  always current, but it contradicts standing rule 10 as written, a slow analysis blocks a read,
  and a report cannot cite a stable result.
- *Sub-question:* analysis for a run as well as a case? Recommended: case only in R1 (a run's
  report already covers its records).

**D-4. Which runs a case covers.** **[RULED 2026-10-08: accepted as recommended: derived from pins.]**
- *Recommended:* derive them from pins (pinned record, its evidence, the evidence's job, the
  job's run). No schema change; matches "a case is its pins". Costs to state in the UI:
  `evidence.job_id` is nullable (`packages/db/src/schema/evidence.ts:43`), so some pinned
  evidence maps to no run and coverage shows it as "evidence with no recorded collection job";
  and a pinned entity brings in every claim on it, so runs from other investigations contribute
  too, and coverage names their investigation.
- *Alternative:* the `case_runs` table named in PLAN.md as the follow-up. Cost: a migration, an
  API to attach runs, and a second meaning of case scope (pinned versus attached) that every read
  must state.

**D-5. Which attributes and relationship kinds count as the same statement.** **[RULED 2026-10-08: accepted as recommended.]**
- *Recommended:* a reviewed, versioned map in `case-engine` of attributes and relationship kinds
  that state the same thing, compared only **about the same entity id** (or entities joined by
  an active analyst merge, D-21), with a stated normalisation per attribute; signed off by the
  owner; nothing outside it is compared. Pairs such as `github_location` with `devto_location`
  sit on two different social-account entities (`extractors.ts:342-353`, `:386-397`), so they
  are not candidates unless an analyst merge joins the two accounts: comparing them otherwise
  would assume the two accounts are one person. Whether the map excludes cross-platform account
  attributes even after a merge is the owner's call. Cost: the map is maintained as collectors are added; free-text values need
  normalisation, and an unnormalised difference ("Berlin" against "Berlin, Germany") must not be
  reported; and today it yields almost nothing, because each comparable kind has one producer
  and production runs two collectors by default.
- *Alternative:* compare same-named attributes only. Cost: finds nothing, because no attribute
  name is shared by two collectors.

**D-6. Credibility in R1.** **[RULED 2026-10-08: accepted: credibility moves to R2; R1-d is contradictions only.]** *Recommended:* confirm it moves to R2, as the build sequence and the
audit say; R1-d is contradictions only. *Alternative:* keep it in R1-d. Cost: R1 grows by the
982-line `credibility.ts` rewrite, and its inputs (per-source reliability, per-record
confidence) are not collected.

**D-7. Per-evidence confidence** **[RULED 2026-10-08: accepted: the HIGH / MEDIUM / LOW bands are dropped.]** (three NEEDS-DECISION rows: `EvidenceConfidenceSummary`,
`GroundedFindingWithEvidence`, `evidenceConfidenceFor`). *Recommended:* no; drop the HIGH /
MEDIUM / LOW bands. No collector measures a per-record confidence, the bands are a policy mapping
(0.8 / 0.5), and their HYPOTHESIS band collides with our strength. *Alternative:* add a nullable
confidence to evidence and adopt the bands. Cost: a migration, every collector declaring how it
measures confidence, and a band that is null everywhere today.

**D-8. Tombstones for purged records** **[RULED 2026-10-08: deferred, to be decided with retention enforcement.]** (two NEEDS-DECISION rows: `caseSnapshotState`,
`CaseSnapshotState`). *Recommended:* decide with retention enforcement, not in R1; nothing is
purged yet (`enforced: false`). *Alternative:* a tombstone (record id, purge time, reason) so a
read can say why a pinned record is gone. Cost: CLAUDE.md §9 requires deletion to genuinely
remove data, so a tombstone must hold no content; that rule's reading is the owner's.

**D-9. Question answering over a case.** **[RULED 2026-10-08: accepted: R1-f builds the written summary only.]** *Recommended:* R1-f builds the written summary only (no
question). Asking a question needs a policy for where the analyst's question travels (the
`trusted` template refuses interpolation; it would go in as a framed record) and whether a "not
supported by the evidence" sentence may be uncited. *Alternative:* build both in R1-f. Cost: a
second prompt, its eval set and those two policy decisions.

**D-10. A person-gate gap found by this audit.** **[RULED 2026-10-08: fixed before R1-a, as its own change (commit 284f4b7).]** `GET /api/v1/entity-merges`,
`POST /api/v1/entity-merges` and `POST /api/v1/entity-merges/:id/undo`
(`apps/api/src/routes/entities.ts:377-475`) call no person gate; a merge of PERSON entities
returns their ids, kind and the analyst's reason. *Recommended:* fix it before R1-a, as its own
change with a regression test (probe the merge's entities; refuse whole). *Alternative:* fix it
inside R1-b. Cost of waiting: the gap stays open meanwhile. Not fixed in R1-0, which allows no
code change beyond the pre-flight. **Fixed 2026-10-08** (its own commit; docs/PLAN.md, D-10 record),
with four further gaps the route audit found. It raised D-29 to D-32.

**D-11. Components the R1 UI needs that U1-c raised and did not build:** **[RULED 2026-10-08: approved for R1-e, each specified in DESIGN-SYSTEM §9 first and shown in the gallery in every state.]** a count chip, a strength
badge with a count, a gaps list. *Recommended:* approve them for R1-e, specified in §9 first and
added to the gallery with all states. *Alternative:* the nearest existing components (StatusChip
with words, plain lists). Cost: less legible counts and gaps.

**D-12. The merge review screen in R1-e.** **[RULED 2026-10-08: accepted, in R1-e: SESSION_REQUIRED for every merge and undo, the shared person gate on every read, and the undo always visible.]** The API lists merge candidates and records merges
with undo; the web shows a Not built card. *Recommended:* yes: it is the only place name matches
are allowed (by an analyst, reversibly), and it completes the entity-resolution capability.
*Alternative:* later. Cost: candidates stay invisible.

**D-13. Usernames across platforms.** **[RULED 2026-10-08: accepted: never merged automatically.]** Legacy merged one handle on two platforms into one entity
automatically. *Recommended:* never; ours keys social accounts as `platform:handle` and the
username entity links them by relationship. *Alternative:* auto-merge. Cost: two different
people with the same handle become one.

**D-14. A gap in the fabrication gate.** **[RULED 2026-10-08: accepted as recommended, as a separate commit; every file it flags is fixed by rewriting, with no allowlist. Not done yet.]** Neither rule flags `?? ""` used for an unknown value
(`case-attach.ts:216`, `case-geoint.ts:267`), which CLAUDE.md §1 forbids. *Recommended:* add the
pattern as a separate, strengthening change, with the false-positive review the gate's other
patterns had. *Alternative:* rely on review. Cost: the gap stays.

**D-15. A case report.** **[RULED 2026-10-08: accepted: after R1.]** *Recommended:* after R1, by extending `assembleReport` from one run to a
case's pins (`buildCaseReport` is not ported). *Alternative:* as an R1-g. Cost: about 1,500 more
lines and the report's own review.

**D-16. Metering model calls that are not reports.** **[RULED 2026-10-08: accepted as recommended.]** `usage_events` can tie LLM tokens only to a
report. *Recommended:* a nullable `case_analysis_id` in R1-f's migration. Cost: the checks
`usage_events_attempt_with_work`, `usage_events_one_work_item` and
`usage_events_model_calls_with_report`, the unique index `usage_events_one_per_report_attempt`
(`packages/db/src/schema/operations.ts:202-216`) and `recordReportAttempt` all change, with
their tests. *Alternative:* a generic work reference (kind plus id). Cost: a wider change to the
same table, and the foreign keys become checks.

**D-17. Which verdicts govern.** **[RULED 2026-10-08: accepted, on two conditions, both met: each DROP that server-side storage or code already here replaced names the file that replaced it, and docs/audit/INVENTORY.md points to R1-INVENTORY.md.]** `docs/audit/INVENTORY.md` rates most of `cases/` KEEP or ADAPT
and CLAUDE.md says to follow it; the reclamation audit says REWRITE; this inventory is finer and
finds most of it DROP or already built. It also widens the brief's DROP (UI-only, dead,
defence or PS-18) to code that only manages browser storage or that server-side storage
replaced, and marks 10 non-DROP rows as not ported (9 "already built here", 1 with no
consumer in R1). *Recommended:* `R1-INVENTORY.md`
governs for `legacy/src/utils/cases/`, with that wider DROP, and INVENTORY.md gets a pointer to
it. *Alternative:* follow INVENTORY.md, or keep DROP to the brief's four reasons and add a
SUPERSEDED verdict. Cost: porting browser-storage code that server-side storage replaced, or a
re-sort of about 70 rows.

**D-18. Media claims and GEOINT.** **[RULED 2026-10-08: accepted: they wait for R3.]** *Recommended:* confirm they wait for R3 (the news collector is
held, no GEOINT collector exists), with their sections shown as Not built naming the missing
collector. *Alternative:* port the media claim extractor in R1 against archived captures. Cost:
it would run on wayback captures it was not designed for, and its corroboration score must be
removed first (`mediaint/claims.ts:552`).

**D-19. The person probe for a case's runs.** **[RULED 2026-10-08: accepted as recommended.]** Case coverage shows each contributing run's jobs,
so a case read rests on those runs too (CLAUDE.md §9: a run that used a person collector is
person data whatever its jobs found). `PersonProbe.runJobs` takes one run
(`packages/db/src/repositories/exploration.ts:110`). *Recommended:* the shared probe takes a
list of runs, in the gate's home file, and R1-b passes every contributing run. *Alternative:*
leave job outcomes out of case coverage. Cost of the alternative: coverage could not say which
collectors found nothing, which is half of what "gaps" means.

**D-20. What a correlation is.** **[RULED 2026-10-08: accepted as recommended.]** Legacy: two or more disciplines (which one multi-discipline
collector satisfied alone). *Recommended:* two or more distinct collectors, whatever their
disciplines, excluding links every collector makes by construction (the run's target entity,
`account_with_handle` from each platform). Cost: same-discipline pairs (dns with crtsh) count,
so the PORT-ADAPTED texts drop "across disciplines". *Alternative:* two or more distinct
collectors in two or more disciplines. Cost: almost nothing correlates today (TECHINT and
SOCMINT rarely share an entity), and the UI says so.

**D-21. Merged entities in analysis.** **[RULED 2026-10-08: accepted as recommended. 2026-10-09: the active merges go into R1-c's input.]** *Recommended:* fold active analyst merges before
correlating and comparing (an undo unfolds them on the next analysis, through the input hash),
never name matches or candidates. *Alternative:* analyse entities unmerged. Cost: a merge an
analyst made has no effect on the analysis.

**D-22. Fixed wording.** **[RULED 2026-10-08: accepted; the final reworded NO_ADJUDICATION_CAVEAT and limitation lists go to the owner before they are committed.]** *Recommended:* `NO_ADJUDICATION_CAVEAT` (reworded) and the
contradiction and correlation limitation lists join `REPORT_WORDING` in `packages/core`, so each
stored document carries the wording it was produced under. *Alternative:* keep them in
`case-engine`. Cost: a stored analysis cannot show the wording it was read with.

**D-23. Locations by name.** **[RULED 2026-10-08: accepted: recorded in ARCHITECTURE-DECISIONS.md now; enforced when R3 creates LOCATION entities.]** Legacy merged LOCATION entities by name automatically. No
collector here creates LOCATION entities yet. *Recommended:* extend the rule that forbids
automatic merges on a name alone to LOCATION before R3 creates any. *Alternative:* decide in
R3. Cost: none now; the risk arrives with R3.

**D-24. Pinning a whole run.** **[RULED 2026-10-08: accepted: not in R1.]** Legacy attached a run's results to a case in one step.
*Recommended:* not in R1; pins stay one record at a time. *Alternative:* a bulk pin endpoint
(refusing an empty batch). Cost: a new state-changing endpoint, its person gate and its limits.

**D-25. Media claims, when they come.** **[RULED 2026-10-08: accepted, for R3.]** *Recommended (for R3):* stored as claims (so they can be
pinned and cited), with the official-statement marker kept as an attribute and the strength
REPORTED. *Alternative:* derived on read, as legacy did. Cost: they cannot be pinned or cited.

**D-26. EXIF and image GEOINT, when they come.** **[RULED 2026-10-08: accepted, for R3.]** *Recommended (for R3):* EXIF fields are
REPORTED (the file states them, and they are forgeable), and image GEOINT collectors sit behind
the person gate when they read device identifiers or a photo's position. *Alternative:*
OBSERVED, as legacy labelled them. Cost: a forgeable statement shown as seen by the platform.

**D-27. A strength ceiling for model sentences.** **[RULED 2026-10-08: accepted as defined.]** Neither codebase checks that a sentence is no
stronger than what it cites. A citation is an evidence id, and evidence is only OBSERVED,
REPORTED or DERIVED, so the ceiling needs a defined input: the strength of a cited evidence id
taken as the strongest claim in the model's context that rests on it. *Recommended:* define it
so, and have R1-f reject a sentence labelled CORRELATED or INFERRED whose citations rest only on
HYPOTHESIS claims. Today no collector emits a HYPOTHESIS claim, so the check is latent until R3,
and its test uses a fixture. *Alternative:* rely on the citation validator. Cost: once
hypotheses exist, a hypothesis can be restated as an inference.

**D-28. Re-checking access in the job.** **[RULED 2026-10-08: accepted as recommended.]** The API checks plan and vetting when an analysis is
requested; the job then reads the case later and, in R1-f, sends it to the model. CLAUDE.md §6
says the API and the workers apply the same rules; `ReportGenerator` does not re-check today
either. *Recommended:* the job re-checks the person gate before reading and before any model
call, and fails with the gate's code if refused. Today the read decision is composed only in
`apps/api/src/http/person-gate.ts`; the guard's homes are that file, `packages/access/src/`,
`packages/collectors/src/runtime.ts` and the probe in `exploration.ts`
(`person-gate-guard.ts:78-83`). A helper composed in `packages/access` and called by both the
API and the worker may need no change to that list. Either way, CLAUDE.md §9's sentence naming
`apps/api/src/http/person-gate.ts` as the shared gate, and standing rule 6, which names
`requirePersonAccess`, are amended in the same change, with the owner's approval; `case-engine`
then depends on `access`. *Alternative:* trust the request-time check. Cost: a tenant
whose vetting is withdrawn between request and job still has its person data sent to the model.

**D-29. Merge partners in the probe** **[RULED 2026-10-08: accepted (recommended option): the shared probe follows active merges. Done in D-10b.]** (raised by the D-10 audit). The entity list shows each
entity's `mergedEntityCount`, and a count of entities merged into it is part of what it says, but
the partners are not probed: the list does not carry their ids. Likewise a merge request naming
two technical entities answers 409 when one of them is already merged into a person-evidence
entity, which says it has some active merge. *Recommended:* the probe's `entityIds` also cover
each entity's active merge partners, in the shared probe (`touchesPersonData`), so every read
that names an entity follows its merges. *Alternative:* the list returns its partners' ids and
probes them. Cost: either changes the probe or a repository (not small, so not done in D-10);
the first also refuses reads that show no merge field (relationship detail, merge candidates)
when a partner is person data.

**D-30. Replaying a job of a person run** **[RULED 2026-10-08: accepted: replay is gated. Done in D-10b; the reversal of the Phase 6a ruling is recorded in ARCHITECTURE-DECISIONS.md §6.]** (raised by the D-10 audit). `POST
/api/v1/jobs/:id/replay` is ungated: for a locked tenant, a replay of a failed person job
re-queues it and its run, and the worker then overwrites the job's recorded failure with a
refusal. The Phase 6a ruling left replay ungated ("returns the run id only; the worker
re-checks admission"); that did not consider the state the request changes. *Recommended:*
gate it before the replay with the job's run (`runJobs`), as for a run read. *Alternative:*
keep the ruling. Cost: a locked tenant can still change a person run's recorded state.

**D-31. Where a refusal falls in a paged list** **[RULED 2026-10-08: accepted with changes, then the cheaper option chosen: the entity list and merge candidates probe the whole scope in SQL, the merge list keeps a fixed window (its residual accepted), and the graph probes its whole hops-bounded neighbourhood. Done in D-10c (commit 9e4369c).]** (raised by the D-10 review). The merge list and
the entity list probe every row they fetch, the next page's first row included, so `hasMore`
is covered. A refusal still moves with `limit`: stepping it shows where in the list a row
resting on person data sits. The case pins list avoids this by probing every pin of the case.
*Recommended:* probe every row the query matches (needs a repository read without a page limit,
or one probe query over the same filter). *Alternative:* accept it. Cost: a locked tenant can
place a person-data row in its own lists.

**D-32. A scope that changes between read and probe** **[RULED 2026-10-08: accepted, folded into R1-b as its prerequisite. Not built now.]** (raised by the D-10 review). Entity
detail, relationship detail and the run stream now read first and probe after, so the probe sees
at least what was read: what they show cannot shrink.
A case scope can also shrink (an unpin is not gated) as well as grow (a fusion commits claims on
a pinned entity), so for case-scope reads neither order is safe alone. *Recommended:* run each
gated read and its probe on one snapshot (a repeatable-read transaction for gated reads).
*Alternative:* probe before and after each case-scope read. Cost: the windows are milliseconds
and need a concurrent unpin or fusion; the first is a change to the transaction layer.

**D-33. The cost of a three-hop neighbourhood** (raised by D-10c). Measured on one machine, on
a synthetic TECHINT-shaped tenant of 125k entities, 260k relationships and 385k claims, where
person evidence exists but none is reachable (the worst case, as the whole walk runs). The
person probe as built takes 0.1 s at 0 hops, 0.3 s at 1, 0.6 s at 2 and 0.8 s at 3; it runs only
for a tenant without person access. As first written it exceeded the 15 s statement timeout at
3 hops; listing each relationship both ways made every step a join Postgres can hash. The
existing graph read is the larger problem: it still walks the old way, takes 0.7 to 2.4 s at
0 to 1 hops and exceeds the timeout at 2 and 3 hops at that size (4.7 s at 3 hops on a tenant
of 12.5k entities). Measurements in docs/PLAN.md, D-10c. *Recommended:* walk the graph store
the same way (each relationship listed both ways), add indexes on
`entity_relationships (tenant_id, target_entity_id)` and `claims (tenant_id, relationship_id)`
(a forward-only migration), and measure again before R1-e shows the graph more widely.
*Alternative:* cap the hop limit by tenant size. Cost of the alternative: a deep graph is
refused to large tenants, and the probe's cost remains.

**D-34. Report generation re-checks the person gate** **[RULED 2026-10-09: report generation
re-checks the person gate in the job, no later than R1-f.]** (raised by R1-b). The API checks plan
and vetting when a report is requested. `ReportGenerator` then reads the run, and may send it to
a model, without checking again. The case analysis job re-checks before it reads the case's
records (D-28); report generation does not yet. CLAUDE.md §9 states the gap and points here.

**Noted, not a decision.** The brief refers to "the 11 non-negotiable rules" in CLAUDE.md. No
document numbers eleven rules: CLAUDE.md has sections 1 to 10 plus three unnumbered ones (product
name, the legacy folder, source labelling). The 17 standing rules above are the list R1 follows.





## Appendix: every export not dropped, and where it goes

All 115 rows of `R1-INVENTORY.md` whose verdict is not DROP (the 109 DROP rows are ported nowhere). Generated from the inventory, so no kept export is left without a home.

| Goes to | File | Export | Verdict |
|---|---|---|---|
| R1-a | `case-intelligence-breakdown.ts` | `DISCIPLINES` | PORT-ADAPTED |
| R1-a | `case-intelligence-breakdown.ts` | `DisciplineKey` | PORT-ADAPTED |
| R1-a | `case-intelligence-breakdown.ts` | `NotCaseScoped` | PORT-ADAPTED |
| R1-a | `case-intelligence-breakdown.ts` | `CountedMetric` | PORT-ADAPTED |
| R1-a | `case-intelligence-breakdown.ts` | `MetricValue` | PORT-ADAPTED |
| R1-a | `case-intelligence-breakdown.ts` | `DisciplineMetric` | PORT-ADAPTED |
| R1-a | `case-intelligence-breakdown.ts` | `DisciplineStatus` | PORT-ADAPTED |
| R1-a | `case-intelligence-breakdown.ts` | `DisciplineSection` | PORT-ADAPTED |
| R1-a | `case-intelligence-breakdown.ts` | `CaseIntelligenceBreakdown` | PORT-ADAPTED |
| R1-a | `case-intelligence-breakdown.ts` | `TOTALS_OVERLAP` | PORT-ADAPTED |
| R1-a | `case-intelligence-breakdown.ts` | `SILENT_MEANING` | PORT-ADAPTED |
| R1-a | `case-intelligence-breakdown.ts` | `NOT_CASE_SCOPED_MEANING` | PORT-ADAPTED |
| R1-a | `case-intelligence-breakdown.ts` | `BREAKDOWN_CAVEATS` | PORT-ADAPTED |
| R1-a | `case-intelligence-breakdown.ts` | `CollectorDisciplines` | PORT-ADAPTED |
| R1-a | `case-intelligence-breakdown.ts` | `BreakdownInput` | REWRITE |
| R1-a | `case-intelligence-breakdown.ts` | `evidenceByCollector` | PORT-ADAPTED |
| R1-a | `case-intelligence-breakdown.ts` | `entitiesByCollectorId` | PORT-ADAPTED |
| R1-a | `case-intelligence-breakdown.ts` | `relationshipsByCollectorId` | PORT-ADAPTED |
| R1-a | `case-intelligence-breakdown.ts` | `buildCaseIntelligenceBreakdown` | REWRITE |
| R1-a | `case-intelligence-breakdown.ts` | `breakdownHeadline` | PORT-ADAPTED |
| R1-a | `case-report.ts` | `CollectionStatus` | PORT-ADAPTED |
| R1-a | `case-report.ts` | `CompletenessReason` | PORT-ADAPTED |
| R1-a | `case-report.ts` | `CollectionCompleteness` | REWRITE |
| R1-a | `case-report.ts` | `COMPLETENESS_CAVEATS` | PORT-ADAPTED |
| R1-a | `case-report.ts` | `CompletenessInput` | REWRITE |
| R1-a | `case-report.ts` | `assessCompleteness` | REWRITE |
| R1-a | `case-report.ts` | `completenessHeadline` | REWRITE |
| R1-c | `case-entities.ts` | `contributingSourcesOf` | PORT-ADAPTED |
| R1-c | `cross-intelligence.ts` | `CORRELATION_TYPES` | PORT-ADAPTED |
| R1-c | `cross-intelligence.ts` | `CorrelationType` | PORT-ADAPTED |
| R1-c | `cross-intelligence.ts` | `DISCIPLINES` | PORT-ADAPTED |
| R1-c | `cross-intelligence.ts` | `Discipline` | PORT-ADAPTED |
| R1-c | `cross-intelligence.ts` | `NOT_IMPLEMENTED` | PORT-AS-IS |
| R1-c | `cross-intelligence.ts` | `CORRELATION_NOT_A_FINDING` | PORT-ADAPTED |
| R1-c | `cross-intelligence.ts` | `NO_CORRELATIONS_MESSAGE` | PORT-ADAPTED |
| R1-c | `cross-intelligence.ts` | `CORRELATION_CAVEATS` | PORT-ADAPTED |
| R1-c | `cross-intelligence.ts` | `CorrelationEntityRef` | PORT-ADAPTED |
| R1-c | `cross-intelligence.ts` | `CrossIntelligenceCorrelation` | PORT-ADAPTED |
| R1-c | `cross-intelligence.ts` | `CrossIntelligenceReport` | PORT-ADAPTED |
| R1-c | `cross-intelligence.ts` | `CollectorDisciplines` | PORT-ADAPTED |
| R1-c | `cross-intelligence.ts` | `CrossIntelligenceInput` | PORT-ADAPTED |
| R1-c | `cross-intelligence.ts` | `buildCrossIntelligence` | REWRITE |
| R1-c | `cross-intelligence.ts` | `CrossIntelligenceSummary` | PORT-ADAPTED |
| R1-c | `cross-intelligence.ts` | `summariseCrossIntelligence` | REWRITE |
| R1-d | `case-contradictions.ts` | `ContradictionProvenance` | PORT-ADAPTED |
| R1-d | `case-contradictions.ts` | `CaseInfraContradiction` | PORT-ADAPTED |
| R1-d | `case-contradictions.ts` | `CaseContradiction` | PORT-ADAPTED |
| R1-d | `case-contradictions.ts` | `CaseContradictionReport` | PORT-ADAPTED |
| R1-d | `case-contradictions.ts` | `CASE_CONTRADICTION_LIMITATIONS` | PORT-ADAPTED |
| R1-d | `case-contradictions.ts` | `NO_ADJUDICATION_CAVEAT` | PORT-ADAPTED |
| R1-d | `case-contradictions.ts` | `observedAtByCollector` | REWRITE |
| R1-d | `case-contradictions.ts` | `toContradictionInputs` | PORT-ADAPTED |
| R1-d | `case-contradictions.ts` | `BuildOptions` | PORT-ADAPTED |
| R1-d | `case-contradictions.ts` | `buildCaseContradictions` | REWRITE |
| R1-d | `case-contradictions.ts` | `CaseContradictionSummary` | PORT-ADAPTED |
| R1-d | `case-contradictions.ts` | `summariseCaseContradictions` | PORT-ADAPTED |
| R1-d | `case-report.ts` | `ReportContradiction` | PORT-ADAPTED |
| R1-d | `case-report.ts` | `NO_CONTRADICTIONS_MESSAGE` | PORT-ADAPTED |
| R1-d | `case-report.ts` | `toReportContradictions` | REWRITE |
| R1-d | `case-report.ts` | `CONTRADICTION_CAVEAT` | PORT-ADAPTED |
| R1-f | `case-analysis.ts` | `GroundedFindingSchema` | PORT-ADAPTED |
| R1-f | `case-analysis.ts` | `GroundedFinding` | PORT-ADAPTED |
| R1-f | `case-analysis.ts` | `GroundedAnswerSchema` | REWRITE |
| R1-f | `case-analysis.ts` | `GroundedAnswer` | REWRITE |
| R1-f | `case-analysis.ts` | `GroundedResult` | PORT-ADAPTED |
| R1-f | `case-analysis.ts` | `GROUNDED_SYSTEM` | PORT-ADAPTED |
| R1-f | `case-analysis.ts` | `serializeCaseContext` | REWRITE |
| R1-f | `case-analysis.ts` | `buildGroundedPrompt` | REWRITE |
| R1-f | `case-analysis.ts` | `analyseCaseGrounded` | PORT-ADAPTED |
| R1-f | `case-context.ts` | `ContextEvidence` | PORT-ADAPTED |
| R1-f | `case-context.ts` | `ContextClaim` | PORT-ADAPTED |
| R1-f | `case-context.ts` | `ContextEntity` | PORT-ADAPTED |
| R1-f | `case-context.ts` | `ContextRelationship` | PORT-ADAPTED |
| R1-f | `case-context.ts` | `ContextTimelineEvent` | PORT-ADAPTED |
| R1-f | `case-context.ts` | `CaseContext` | PORT-ADAPTED |
| R1-f | `case-context.ts` | `MAX_CONTEXT_EVIDENCE` | PORT-AS-IS |
| R1-f | `case-context.ts` | `MAX_CONTEXT_ENTITIES` | PORT-AS-IS |
| R1-f | `case-context.ts` | `MAX_CONTEXT_RELATIONSHIPS` | PORT-AS-IS |
| R1-f | `case-context.ts` | `MAX_CONTEXT_CLAIMS` | PORT-AS-IS |
| R1-f | `case-context.ts` | `MAX_CONTEXT_TIMELINE` | PORT-AS-IS |
| R1-f | `case-context.ts` | `isSecretKey` | PORT-ADAPTED |
| R1-f | `case-context.ts` | `summariseValue` | PORT-ADAPTED |
| R1-f | `case-context.ts` | `CaseContextInput` | PORT-ADAPTED |
| R1-f | `case-context.ts` | `buildCaseContext` | REWRITE |
| R1-f | `case-context.ts` | `citableEvidenceIds` | PORT-ADAPTED |
| R1-f | `case-context.ts` | `resolveCitation` | PORT-ADAPTED |
| D-15 (after R1) | `case-report-build.ts` | `CaseReportBuildInput` | REWRITE |
| D-15 (after R1) | `case-report-build.ts` | `CaseReportBuild` | PORT-ADAPTED |
| D-15 (after R1) | `case-report-build.ts` | `buildCaseReport` | REWRITE |
| D-15 (after R1) | `case-report-build.ts` | `caseReportBlocker` | PORT-ADAPTED |
| D-15 (after R1) | `case-report.ts` | `CaseReportProvenance` | PORT-ADAPTED |
| D-7 (recommended: drop) | `case-analysis.ts` | `EvidenceConfidenceSummary` | NEEDS-DECISION |
| D-7 (recommended: drop) | `case-analysis.ts` | `GroundedFindingWithEvidence` | NEEDS-DECISION |
| D-7 (recommended: drop) | `case-analysis.ts` | `evidenceConfidenceFor` | NEEDS-DECISION |
| D-8 (after R1) | `case-scope.ts` | `CaseSnapshotState` | NEEDS-DECISION |
| D-8 (after R1) | `case-scope.ts` | `caseSnapshotState` | NEEDS-DECISION |
| D-9 (question answering) | `case-analysis.ts` | `GroundedInput` | REWRITE |
| Not R1: already built (OutputProblem (packages/llm/src/errors.ts)) | `case-analysis.ts` | `GroundedProblem` | PORT-ADAPTED |
| Not R1: already built (assertsCertainty (packages/llm/src/citations.ts)) | `case-analysis.ts` | `assertsCertainty` | PORT-AS-IS |
| Not R1: already built (validateCitations and checkOutput (packages/llm)) | `case-analysis.ts` | `validateGroundedAnswer` | PORT-ADAPTED |
| Not R1: already built (write-time resolution (fusion/identifiers.ts, fuse.ts) and merge candidates) | `case-entities.ts` | `resolvedCaseEntities` | REWRITE |
| Not R1: already built (EntityView merge state; nothing is resolved on read) | `case-entities.ts` | `resolutionSummary` | REWRITE |
| Not R1: already built (no score exists to caveat; merges are analyst records) | `case-entities.ts` | `RESOLUTION_CAVEATS` | REWRITE |
| Not R1: already built (COVERAGE_CAVEATS[0] (packages/osint-engine/src/reports/assemble.ts)) | `case-report.ts` | `NO_EXHAUSTIVE_CLAIM` | PORT-ADAPTED |
| Not R1: already built (caseView and pinCountOf (apps/api/src/routes/cases.ts)) | `case-runs.ts` | `toCaseView` | REWRITE |
| Not R1: already built (runStatusOf (packages/osint-engine/src/fusion/fuse.ts); add the all-cancelled branch when cancellation exists) | `case-runs.ts` | `runStatusFromJobs` | PORT-ADAPTED |
| Not R1: no consumer (no consumer in R1; the closed-tally pattern it needs exists in progress.ts, which initialises every status first) | `case-runs.ts` | `summariseRuns` | REWRITE |
| R3 | `case-claims.ts` | `NO_CLAIMS_MESSAGE` | REWRITE |
| R3 | `case-claims.ts` | `CASE_CLAIM_CAVEATS` | PORT-ADAPTED |
| R3 | `case-claims.ts` | `CaseClaimsInput` | PORT-ADAPTED |
| R3 | `case-claims.ts` | `CaseClaims` | PORT-ADAPTED |
| R3 | `case-claims.ts` | `caseMediaClaims` | REWRITE |
| R3 | `case-claims.ts` | `isConflicted` | REWRITE |
| R3 | `case-contradictions.ts` | `CaseClaimConflict` | PORT-ADAPTED |
| R3 | `case-geoint.ts` | `geointHypothesisCount` | PORT-ADAPTED |

Totals: D-15 5, D-7 3, D-8 2, D-9 1, Not R1 10, R1-a 27, R1-c 17, R1-d 16, R1-f 26, R3 8.
