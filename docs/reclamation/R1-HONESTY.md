# R1 honesty audit: what the legacy case analysis claims, and what it can honestly claim

R1-0, 2026-10-08. One section per capability found in `legacy/src/utils/cases/` (26 capabilities over 224 exports; the export-by-export verdicts are in `R1-INVENTORY.md`). Each section answers the seven questions of the R1-0 brief in one paragraph each. Quotes are verbatim from `legacy/` with their line; nothing here was run against live data.

The six strengths, as `packages/core/src/report-wording.ts` defines them (owner-reviewed): **OBSERVED** seen directly by the platform; **REPORTED** stated by the cited source; **DERIVED** computed by the platform from recorded values; **CORRELATED** "a link drawn by the analysis model between two or more independent cited sources"; **INFERRED** an inference drawn by the analysis model; **HYPOTHESIS** a possibility the cited evidence permits but does not establish. Collector evidence may be only OBSERVED, REPORTED or DERIVED; model text only CORRELATED, INFERRED or HYPOTHESIS (`SYNTHESIS_STRENGTHS`).

## Headline

- **None of the 26 capabilities can ship as legacy computed it.** Nine are built in R1 (rewritten onto our evidence, claims and pins; two of them only in part: the case summary but not question answering, D-9, and the contradiction projection but not a case report, D-15), six are already built here, five wait for a later stage (four for R3, whose inputs are never collected, and the case report, D-15), and six are dropped or wait on an owner decision.
- **What the R1 capabilities can honestly carry.** Everything the engine computes itself is **DERIVED**: correlations, contradiction flags, coverage, breakdown counts. An explanation of why two sources disagree is **HYPOTHESIS**. Model-written sentences (R1-f) carry only **CORRELATED, INFERRED or HYPOTHESIS**, and the engine never raises a claim's strength: records keep the strength they were stored with. **OBSERVED** is produced by no collector today.
- **CORRELATED is reserved for the model by the current definitions.** Legacy labels its rule-computed cross-discipline links CORRELATED. Under our wording they are DERIVED, unless the owner widens CORRELATED (D-2). The same tension already exists in the shipped code: merge candidates are computed by a rule and labelled INFERRED.
- **Numbers not derived from cited evidence** (all removed, or replaced by null plus reason):
  - an invented merge "confidence", `Math.min(0.5 + 0.15 * (sources.length - 1), 0.95)` (`osint/entity-resolution.ts:119`), printed as a collector's confidence in the model prompt (`case-analysis.ts:221`, `case-context.ts:329`);
  - a hand-set corroboration curve given to every media claim (`mediaint/claims.ts:552`);
  - a storage report of zeros it never measured and a percentage of an assumed 5 MB quota (`case-scope.ts:274`, `:294`);
  - success booleans set after calls that swallow their errors (`case-delete.ts:100`);
  - `?? 0` counters (`cross-intelligence.ts:576`, `case-runs.ts:119`, `:378`, `case-claims.ts:151`, `case-report.ts:391`, `:405`, `:419`, `case-intelligence-breakdown.ts:410`), the last a missing GEOINT count shown as a measured zero;
  - minted evidence references when a collector gave none, `evidenceRefs[id] = ev.evidenceId ?? id;` (`mediaint/claims.ts:611`), which makes the traceability check always pass.
- **Auto-merging and auto-linking.** No legacy capability merges people or organisations by name (`NOT_MERGEABLE_BY_VALUE`, `osint/entity-resolution.ts:91`). But on every read legacy auto-merges every other kind by normalised value, including usernames across platforms on a lower-cased handle and locations by name, and the last collector's metadata silently overwrites the others (`entity-resolution.ts:234`). Media claims are grouped, and denials matched, by name tokens (Jaccard 0.6, `mediaint/claims.ts:390`), so two people who share a name can be joined. None of this is ported. Here, resolution happens once at write time by exact identifier, a person or organisation only by an external id, and every merge is a reversible, attributed record.
- **Person data.** Every capability that reads a case's records rests on person data whenever any pinned record came from a person collector (or from an unknown one), or any run that contributed to the case used one, whatever its jobs found (D-19). Legacy gates none of it. In R1 every such read goes through `requirePersonAccess` or `personLockFor` on the case scope and is refused whole. Separately, the audit found that `GET`, `POST /api/v1/entity-merges` and `POST /api/v1/entity-merges/:id/undo` (`apps/api/src/routes/entities.ts:377-475`) call no person gate, though a merge of PERSON entities exposes their ids and the analyst's reason (D-10).
- **LLM.** Only grounded case analysis needs a model (LARGE task, `synthesis`). Legacy built the context in the browser and trusted it (`case-analysis.ts:608` validates with the identity function), let the model label its own sentences OBSERVED or REPORTED (`case-analysis.ts:349`), and pasted case material straight after its instructions. Our `packages/llm` already holds the stricter versions: framed untrusted records, citation validation, output guards, the open-weight allowlist, a per-tenant cache and metering.
- **Inputs we do not collect.** No GEOINT collector exists; MEDIAINT is archive captures only (news is held, and GDELT gives headlines without body, publisher or date); person collection is phone-number parsing only; no evidence carries a per-record confidence. Every comparable infrastructure relationship kind has exactly one producer (`resolves_to` dns, `subdomain_of` crtsh, `uses_nameserver` rdap), and no attribute name is shared by two collectors, so contradictions have nothing to compare until a second source states the same thing about the same entity (D-5). These ship behind Not built, naming the missing input.
- **Source labels.** Legacy grouped and labelled by the source string a collector supplied (`case-report-build.ts:101` `collector: s.outlet,`; `osint/contradictions.ts`), which our source-labelling rule forbids. Every port groups by `evidence.collector_id` and labels from the registry.
- **Defence and PS-18 framing** to strip: "defence tool" / "defence product" comments (`case-context.ts:36`, `case-report.ts:21`), "intelligence analyst" in the prompt (`case-analysis.ts:169`), "iaf" in the official-source markers (`mediaint/claims.ts:181`), "Module 2" labels (`reports.ts:295`, `osint/timeline.ts:44`), and the product name "Sentinel" in caveats (`osint/timeline.ts:226`). Nothing in these files is specific to the frozen defence scope beyond wording.

## Capabilities at a glance

| Capability | Exports | Strengths its output can honestly carry | Ships as legacy computed | Where it goes |
|---|---|---|---|---|
| Case context projection for analysis (`case-context-assembly`) | 15 | each record keeps the strength it is stored with (any of the six); its own counts are DERIVED | no | R1-f (the model's view of a case; R1-a defines its own case-scope input types) |
| Case collection completeness (coverage and limitations) (`case-completeness`) | 11 | DERIVED | no | R1-a (case coverage), R1-e (shown) |
| Per-discipline breakdown of what a case holds (`case-discipline-breakdown`) | 21 | DERIVED | no | R1-a (breakdown), R1-e (shown) |
| Cross-discipline correlation (`cross-discipline-correlation`) | 18 | DERIVED, CORRELATED only if D-2 widens it, HYPOTHESIS | no | R1-c (the rule, across collectors or across disciplines, is D-20) |
| Infrastructure contradictions: disjoint value sets between collectors (`case-infra-contradictions`) | 3 | DERIVED, HYPOTHESIS | no | R1-d |
| Case-level contradiction report and summary (`case-contradiction-report`) | 9 | DERIVED, HYPOTHESIS | no | R1-d |
| Contradictions projected into a report (`case-contradictions-in-report`) | 4 | REPORTED, DERIVED, HYPOTHESIS | no | R1-d (the projection; a case report itself is out of R1, D-15) |
| Credential redaction and compact value projection before a model call (`prompt-value-hygiene`) | 2 | none (no claim of its own) | no | R1-f |
| Grounded case question answering (`case-grounded-qa`) | 14 | CORRELATED, INFERRED, HYPOTHESIS | no | R1-f builds the written case summary; question answering waits on D-9 |
| Case entity resolution (read-time accessor) (`case-entity-resolution`) | 9 | DERIVED | no | fusion resolves by identifier at write time; name matches are only offered as merge candidates (INFERRED, never merged automatically) |
| Run status from job statuses, and run tallies (`run-status-rollup`) | 7 | DERIVED | no | runStatusOf in packages/osint-engine/src/fusion/fuse.ts |
| Attach collector findings to an analyst-chosen case (`case-attach`) | 9 | DERIVED | no | case_pins and POST /api/v1/cases/:id/pins |
| Derived case view (status mapping, case number, updatedAt, evidence count) (`case-view`) | 8 | DERIVED | no | the cases API (pinCountOf refuses a missing count) |
| Snapshot-to-case scope gate (MATCH / MISMATCH / UNSCOPED) (`case-scope-check`) | 8 | none (no claim of its own) | no | ScopeQuery / resolveScope, and the pin route's case check |
| Capped snapshots with disclosed truncation (`snapshot-truncation`) | 5 | DERIVED | no | GraphSlice.truncated and limit plus hasMore on every list |
| MEDIAINT claims extracted from a case's article evidence (`case-media-claims`) | 8 | REPORTED, DERIVED | no | R3 (MEDIAINT: the news collector is held, and GDELT supplies headlines only) |
| Media assertion-versus-denial conflicts (`case-media-conflicts`) | 3 | DERIVED, HYPOTHESIS | no | R3, with media claims |
| GEOINT presence and location-hypothesis count for a case's discipline breakdown (`case-geoint-summary`) | 5 | DERIVED | no | R3 (no GEOINT collector is registered) |
| Attach an image's GEOINT analysis (EXIF, image matches, location hypotheses) to a case (`case-geoint-attach`) | 8 | REPORTED, DERIVED, HYPOTHESIS | no | R3, and even there nothing is ported: GEOINT evidence is pinned like any other |
| Case report assembly from stored case data (no new collection) (`case-report-assembly`) | 5 | each record keeps the strength it is stored with (any of the six); its own counts are DERIVED | no | after R1 (D-15): a case report extends assembleReport from one run to a case's pins; buildCaseReport is not ported |
| Confidence of the evidence a finding cites (`cited-evidence-confidence`) | 3 | DERIVED | no | NEEDS-DECISION D-7 (recommended: drop) |
| Browser snapshot eviction, eviction ledger and quota report (`storage-quota-eviction`) | 18 | DERIVED | no | browser storage; two rows wait on D-8 (retention tombstones) |
| Case-to-run edge store and run input classification (`case-run-link`) | 14 | DERIVED, HYPOTHESIS | no | browser storage; the server-side question is D-4 |
| Case snapshot selector for /graph and /timeline (`snapshot-selector`) | 9 | none (no claim of its own) | no | browser snapshot UI |
| Case deletion cascade across browser stores (`case-delete-cascade`) | 4 | none (no claim of its own) | no | browser storage; cases are archived here, never deleted |
| Sample-watchlist labelling and no-case blocker (`sample-watchlist-separation`) | 4 | none (no claim of its own) | no | demo data labelling |

## Built in R1

### Case context projection for analysis (`case-context-assembly`)

**Where it goes:** R1-f (the model's view of a case; R1-a defines its own case-scope input types). **Exports (15):** `ContextEvidence`, `ContextClaim`, `ContextEntity`, `ContextRelationship`, `ContextTimelineEvent`, `CaseContext`, `MAX_CONTEXT_EVIDENCE`, `MAX_CONTEXT_ENTITIES`, `MAX_CONTEXT_RELATIONSHIPS`, `MAX_CONTEXT_CLAIMS`, `MAX_CONTEXT_TIMELINE`, `CaseContextInput`, `buildCaseContext`, `citableEvidenceIds`, `resolveCitation`.

**1. What it claims to produce.** A typed, capped, deterministic projection of one case for a model: evidence with short summaries, resolved entities and relationships, media claims, contradictions, a timeline separating observed from retrieval-positioned dates, cross-intelligence correlations, completeness, limitation sentences (completeness first) and counts of what was capped; plus the set of evidence ids a model may cite and a resolver back to the record.

**2. Strengths it can honestly carry.** The context makes no claims of its own: each projected record keeps the strength its evidence or claim already carries in our store, so any of the six can appear. Its own outputs (counts, truncation numbers, the retrieval-positioned flag) are DERIVED. Legacy OFFICIAL_STATEMENT on evidence maps to REPORTED.

**3. Numbers, scores or labels not derived from cited evidence.** legacy/src/utils/cases/case-context.ts:329 "confidence: e.confidence?.value ?? null," carries the resolver's corroboration formula (legacy/src/utils/osint/entity-resolution.ts:119) as entity confidence -> null. case-context.ts:437 "...built.caveats," brings in timeline caveats that hard-code the legacy product name (legacy/src/utils/osint/timeline.ts:226) -> product name only via PRODUCT_NAME, or none. case-context.ts:347 "evidence: input.evidence," builds claims from the uncapped evidence, so citable refs exceed what the model saw -> build records and refs from one set. Contradictions are never capped or counted in truncated (lines 369-382 vs 418-424) -> cap and count.

**4. Auto-merging or auto-linking by name.** Yes, indirectly. case-context.ts:302 "const resolved = resolvedCaseEntities({" re-runs legacy resolveEntities on every build, auto-merging same-type entities whose normalised value matches across collectors. PERSON and ORGANIZATION are excluded (entity-resolution.ts:91 NOT_MERGEABLE_BY_VALUE), so there is no name-based person or organisation merge. Usernames do merge across platforms on a lower-cased handle with '@' stripped (entity-resolution.ts:55-57), linking accounts on different platforms as one identity. Ours keys usernames as platform:handle and records merges as reversible entity_merges decisions; a port reads stored merges (GraphNode.mergedIntoEntityId) and never re-resolves at read time.

**5. Person data.** Yes: evidence, entities (usernames, e-mail addresses, phone numbers, PERSON), claims and timeline from person collectors are all projected. Building it is a read resting on person data, so it goes through the shared person gate and is refused whole when plan or vetting does not allow it.

**6. LLM.** No (deterministic). Its consumer, grounded Q&A, is LARGE.

**7. Inputs we do not collect.** Not collected or not built: media claims (polarity, publisher, publishedAt, syndication, independentSources; no media-claim extractor); contradictions (OverviewTab.tsx:82 already shows Not built); cross-intelligence correlations (no discipline capability matrix or correlation module); per-evidence, entity and relationship confidence; case-level completeness (only per-run ReportCoverage). Each section ships behind Not built naming the input. Available: evidence, claims (attribute, value, strength), entities, relationships, merges, observed_at and collected_at.

**Notes.** Delegated legacy modules, R0 bins: case-entities.ts resolvedCaseEntities PURE, resolutionSummary PURE (RESOLUTION_CAVEATS constant); case-claims.ts caseMediaClaims PURE; case-contradictions.ts buildCaseContradictions PURE; case-report.ts assessCompleteness, completenessHeadline, toReportContradictions PURE; cross-intelligence.ts buildCrossIntelligence PURE (CORRELATION_CAVEATS constant); osint/timeline.ts buildEvidenceTimeline PURE (it orders by observedAt ?? collectedAt but flags timestampType, and the context projects observedAt as null plus the flag, so no date is invented). LEGACY-RECLAMATION-AUDIT §1 puts these into a new packages/case-engine as REWRITE and warns to merge with our existing cases, entities and report pipeline. ContextEvidence.source was the collector-supplied string; ours must use the registry label (CLAUDE.md Source labelling). Our evidence has observed_at and collected_at columns, so timeline.ts's OBSERVED_AT_KEYS sniffing is unnecessary.


### Case collection completeness (coverage and limitations) (`case-completeness`)

**Where it goes:** R1-a (case coverage), R1-e (shown). **Exports (11):** `CollectionStatus`, `CompletenessReason`, `CollectionCompleteness`, `COMPLETENESS_CAVEATS`, `NO_EXHAUSTIVE_CLAIM`, `CompletenessInput`, `assessCompleteness`, `completenessHeadline`, `contributionByCollector`, `relationshipsByCollector`, `entitiesByCollector`.

**1. What it claims to produce.** A statement of what a case's stored run covered: COMPLETE, PARTIAL, FAILED or UNAVAILABLE, with named reasons (excluded by policy, credential-gated, planned but silent, produced but not in the plan, snapshot capped, run status) and a headline. Never a percentage.

**2. Strengths it can honestly carry.** DERIVED only. The status, counts and reasons are computed by the platform from recorded values (run status, plan, evidence). They describe the run, not the target. Legacy's credential and recomputed-plan reasons are not recorded values: at best they are HYPOTHESIS, which is why ours replaces them with recorded outcomes.

**3. Numbers, scores or labels not derived from cited evidence.** legacy/src/utils/cases/case-report.ts:155 '? input.plan.collectors.filter((c) => c.requiresCredentials).map((c) => c.collectorId).sort()' gives a CREDENTIALS_REQUIRED reason to every credential-declaring collector, including ones that produced evidence. Remove it: the state comes from the job's recorded outcome. legacy/src/utils/cases/case-report.ts:148 'const planned = input.plan ? input.plan.collectors.map((c) => c.collectorId).sort() : [];' and the headline denominator at legacy/src/utils/cases/case-report.ts:265 use a plan recomputed at report time (legacy/src/utils/cases/case-report-build.ts:56 '/** Recomputed from the registry, which is a read-only operation, or null when unavailable. */'). Remove: use the run's stored plan. The counters at legacy/src/utils/cases/case-report.ts:391, 405 and 419 trip the line gate but count correctly; they are dead and dropped.

**4. Auto-merging or auto-linking by name.** No.

**5. Person data.** Only indirectly: collector ids and counts, no person values. In a case whose pins come from a run that used a PERSON collector, the coverage itself shows that a person run happened. Here, reading it is a read resting on person data, so it goes through the shared person gate.

**6. LLM.** No.

**7. Inputs we do not collect.** None at run level. Here runs store their plan and jobs record outcomes, so every input exists and is better than legacy's. Snapshot truncation has no counterpart (database storage, no caps); the closest are omittedClaims and GraphSlice.truncated. Case level needs 'which runs contributed to this case', which can be derived: case_pins -> evidence.jobId -> jobs.runId (pinned claims, entities and relationships through their evidence). Nothing ships behind Not built.

**Notes.** Already ported at run level. packages/osint-engine/src/reports/assemble.ts (header lines 7-17) names cases/case-report.ts as the source of its completeness model and closes its two admitted gaps: it uses recorded job outcomes instead of evidence presence, and the run's stored plan instead of a recomputed one. Credential state also comes from the outcome. What exists here: ReportCoverage {runStatus, partial, headline, entries: CoverageEntry with state from COVERAGE_STATES (COLLECTED, NOTHING_FOUND, FAILED, NEEDS_CREDENTIALS, REFUSED, NOT_FINISHED, EXCLUDED, HELD), reasonCode, detail, evidenceCount, attempts; notApplicable; caveats (passive or active plus COVERAGE_CAVEATS)}. A partial run report says so on its first page. What a case-level version adds: (1) a case is a set of pins that can span many runs and investigations, so case completeness is the list of contributing runs, each with its own ReportCoverage (stored in its report or recomputed by coverageOf), plus an aggregate statement; (2) a selection caveat with a new 'not pinned' state: a collector that COLLECTED in a run can still contribute nothing to the case, which is different from NOTHING_FOUND; (3) the caveat 'no new collection was performed to build this product' (COMPLETENESS_CAVEATS[0]); (4) collection dates across runs, since runs happen at different times. Do not port assessCompleteness: compose the per-run coverage instead. R0: assessCompleteness PURE, completenessHeadline PURE, the three counters UI/DEAD. Delegated: legacy/src/utils/osint/query-planner.ts planInvestigation (PURE) always returns 'excluded: []' (lines 109 and 132); the legacy reports route builds the plan through the planOsintInvestigation server function at report time (reports.tsx line 339). legacy/src/utils/osint/gaps.ts is not referenced by these files.


### Per-discipline breakdown of what a case holds (`case-discipline-breakdown`)

**Where it goes:** R1-a (breakdown), R1-e (shown). **Exports (21):** `DISCIPLINES`, `DisciplineKey`, `NotCaseScoped`, `CountedMetric`, `MetricValue`, `DisciplineMetric`, `DisciplineStatus`, `DisciplineSection`, `CaseIntelligenceBreakdown`, `TOTALS_OVERLAP`, `SILENT_MEANING`, `NOT_CASE_SCOPED_MEANING`, `GEOINT_NOT_SCOPED_REASON`, `BREAKDOWN_CAVEATS`, `CollectorDisciplines`, `BreakdownInput`, `evidenceByCollector`, `entitiesByCollectorId`, `relationshipsByCollectorId`, `buildCaseIntelligenceBreakdown`, `breakdownHeadline`.

**1. What it claims to produce.** A per-discipline (SOCMINT, TECHINT, GEOINT, MEDIAINT) count of what a case holds: evidence, entities, relationships, infrastructure contradictions, media claims and conflicts, GEOINT hypotheses. Each discipline gets PRESENT, ZERO or NOT_CASE_SCOPED; the result also lists which collectors declare each discipline, which produced and which stayed silent, untagged and unmapped buckets, totals and caveats. Never a percentage.

**2. Strengths it can honestly carry.** DERIVED only: counts the platform computes from stored records and each registry entry's discipline. They are statements about the case's contents, not about the target.

**3. Numbers, scores or labels not derived from cited evidence.** legacy/src/utils/cases/case-intelligence-breakdown.ts:410 '? count(ctx.input.geointHypotheses ?? 0)' turns an unreported hypothesis count into a measured 0 (gate: no-fabricated-fallback and numeric-zero-flattening): null with reason instead. legacy/src/utils/cases/case-intelligence-breakdown.ts:381 'const mediaScoped = ctx.input.mediaEvidenceScoped ?? true;' fails open, so unread evidence renders 'Claims: 0': make the flag required, or treat unknown as not scoped. legacy/src/utils/cases/case-intelligence-breakdown.ts:451 '? "NOT_CASE_SCOPED"' (when declaredBy is empty) gives the wrong reason for a discipline nobody declares: say Not built instead. legacy/src/utils/cases/case-intelligence-breakdown.ts:424 mentions the news collector whether or not it contributed: reword. legacy/src/utils/cases/case-intelligence-breakdown.ts:330, 334 and 354 trip the line gate but count correctly. Quoted: line 330 `const producedIn = declaredBy.filter((id) => (ctx.evByCollector.get(id)?.length ?? 0) > 0);`, line 334 `(n, id) => n + (ctx.evByCollector.get(id)?.length ?? 0),`, line 354 `(n, id) => n + (ctx.relByCollector.get(id)?.length ?? 0),`: map-miss counters, rewritten to initialise every key first. Line 424: `From collectors declaring GEOINT (${contributing.join(", ")}). The news collector's geography is the publishing outlet's country, ...`: names the news collector whether or not it contributed.

**4. Auto-merging or auto-linking by name.** No. It counts. Entity attribution reads merged entities that upstream entity resolution produced (see case-report-assembly q4).

**5. Person data.** Yes. SOCMINT entity counts (usernames, social accounts), and here the PERSON discipline exists (contact.phone), which legacy's list leaves out. Counting a case's records is a read resting on person data whenever any record came from a person (or unknown) collector, so it goes through requirePersonAccess on the case scope and is refused whole under a lock (standing rule 6): no PERSON section is marked withheld, and no code outside the gate's homes compares a discipline with PERSON (person-gate-guard).

**6. LLM.** No.

**7. Inputs we do not collect.** GEOINT: no GEOINT collector is registered here, so 'Not built: GEOINT collector'. GEOINT hypotheses: 'Not built: image geolocation'. MEDIAINT claims and conflicts: 'Not built: media claim extraction' (wayback is registered; news is held). Infrastructure contradictions: 'Not built: contradiction detection'. Discipline declarations exist (RegistryEntry.discipline), and so do evidence, entity and relationship counts.

**Notes.** Discipline framing is not defence-specific. docs/vapt/FUTURE-SCOPE-defence.md never mentions disciplines; its do-not-build list covers a defence or government tier, active work against systems not owned, classification markings, air-gap or clearance handling, offensive capability, and weakening the scope or vetting gates. Here, COLLECTOR_DISCIPLINES = TECHINT, SOCMINT, MEDIAINT, GEOINT, PERSON (packages/core/src/vocabulary.ts lines 55-61). Every registry entry declares exactly one, and registry.ts validates it. packages/access maps discipline to module (DISCIPLINE_MODULE: PERSON -> PERSON_INVESTIGATION, the rest -> TECHINT). Today's registry: TECHINT = commoncrawl, crtsh, dns, rdap; SOCMINT = devto, github, hackernews, wikidata; MEDIAINT = wayback (news is held, not registered); PERSON = contact.phone; GEOINT = none. Difference from legacy: a legacy collector could declare several disciplines (wayback declares MEDIAINT and TECHINT, legacy/src/utils/collectors/existing/wayback.ts:197), so its counts overlap; here evidence splits cleanly by discipline and only entities and relationships overlap. R0 binned buildCaseIntelligenceBreakdown PURE and missed its private helper buildSection's gate hits; it binned the three groupers UI/DEAD only because they are used inside their own file. Legacy UI importers: components/case-intelligence-breakdown.tsx, components/case-summary-panel.tsx. Dependencies: case-entities contributingSourcesOf PURE; case-claims MEDIAINT_NOT_CASE_SCOPED (constant). INVENTORY.md: ADAPT, flagging line 410.


### Cross-discipline correlation (`cross-discipline-correlation`)

**Where it goes:** R1-c (the rule, across collectors or across disciplines, is D-20). **Exports (18):** `CORRELATION_TYPES`, `CorrelationType`, `DISCIPLINES`, `Discipline`, `NOT_IMPLEMENTED`, `EVIDENCE_REF_MEANING`, `CORRELATION_NOT_A_FINDING`, `NO_CORRELATIONS_MESSAGE`, `CORRELATION_CAVEATS`, `CorrelationEntityRef`, `CrossIntelligenceCorrelation`, `CrossIntelligenceReport`, `CollectorDisciplines`, `CrossIntelligenceInput`, `buildCrossIntelligence`, `CrossIntelligenceSummary`, `summariseCrossIntelligence`, `citedEvidenceIds`.

**1. What it claims to produce.** For a case, it lists where the observations behind one entity, one collector-asserted relationship, or one fetched URL span 2 or more disciplines (SOCMINT/TECHINT/GEOINT/MEDIAINT). Each entry carries its disciplines, entities, the asserting collector, evidence refs (every record the involved collectors contributed), source URLs, the underlying record's confidence verbatim, a claim class (CORRELATED, or HYPOTHESIS for MATCHED_TO and HAS_LOCATION_HYPOTHESIS edges), an explanation and limitations. It also counts single-discipline and unclassified relationships and summarises by type, discipline pair, hypotheses and unscored.

**2. Strengths it can honestly carry.** Code computes a correlation deterministically from recorded rows, and no source states it. Our glossary (packages/core/src/report-wording.ts:24) defines CORRELATED as 'A link drawn by the analysis model between two or more independent cited sources', and SYNTHESIS_STRENGTHS treats CORRELATED as a model strength. Under the current definitions these correlations are therefore DERIVED, or HYPOTHESIS when they rest on a hypothesis edge. They may carry CORRELATED only if the owner widens that definition to cover deterministic platform correlation across 2 or more distinct collectors. Never OBSERVED or REPORTED. The underlying claims keep their own strengths. A single-collector case is no correlation at all.

**3. Numbers, scores or labels not derived from cited evidence.** legacy/src/utils/cases/cross-intelligence.ts:334 "confidence: e.confidence ?? UNSCORED," carries legacy/src/utils/osint/entity-resolution.ts:119 "const corroboration = Math.min(0.5 + 0.15 * (sources.length - 1), 0.95);" onto every ENTITY_CORRELATION of a merged entity: remove. cross-intelligence.ts:394 "confidence: rel.confidence ?? UNSCORED," carries a collector's self-assigned score, which our model does not have: remove. The 'corroboration' wording at cross-intelligence.ts:337-338 is emitted for a single collector with two declared disciplines (gate at line 322): remove, by requiring 2 or more distinct collectors. The count fields (singleDisciplineRelationships, unclassifiedRelationships, summary counts) are measured: keep. Summary `unscored` goes with confidence. correlationId (lines 278-285) is a 32-bit hash used as the dedupe key (lines 406-408), so a collision would silently drop a distinct correlation: use the full content key.

**4. Auto-merging or auto-linking by name.** Not itself. It compares no values: its only grouping is exact equality of evidence.sourceUrl strings (lines 433-438), a deterministic match on the fetched URL, not a name. It consumes resolvedCaseEntities output, though, and so inherits resolveEntities' value merges (see case-entity-resolution q4). People and organisations are never merged by name there; locations are, by trim and lowercase.

**5. Person data.** Yes. CorrelationEntityRef.value and the explanation strings embed entity values (person names, emails, usernames, phones). IDENTITY_CANDIDATE_CORRELATION is built from person-to-identifier edges (CANDIDATE_IDENTITY, WORKS_AT, USES_USERNAME, HAS_EMAIL, CANDIDATE_ACCOUNT). Legacy has no gate, and its DISCIPLINES omits PERSON, so a person collector's discipline is silently dropped. A port must include PERSON, run the whole read through requirePersonAccess or personLockFor with the scope and every entity id, and refuse whole when gated.

**6. LLM.** no

**7. Inputs we do not collect.** We do not produce: MENTIONED_IN, APPEARS_AT, MATCHED_TO (no media-mention, reverse-image or perceptual-match collector), so MEDIA_ENTITY_CORRELATION ships behind 'Not built: media mention and image-match relationships'. LOCATED_IN, HAS_METADATA_LOCATION, HAS_LOCATION_HYPOTHESIS (no GEOINT collector; the LOCATION kind exists but no extractor creates it), so GEO_CORRELATION ships behind 'Not built: location relationships'. Also absent: HAS_EMAIL, USES_USERNAME, WORKS_AT, CANDIDATE_IDENTITY, OWNS_DOMAIN, HOSTED_ON, HAS_PORT, ARCHIVED_AS. IDENTITY_CANDIDATE has inputs (account_with_handle, wikidata_search_candidate), but every collector behind them is SOCMINT, so it cannot be cross-discipline today and must report none, not hide. Possible today: ENTITY and INFRASTRUCTURE, via DOMAIN entities with TECHINT claims (dns, crtsh, rdap, commoncrawl) and MEDIAINT claims (wayback), plus the resolves_to, uses_nameserver and subdomain_of edges. SOURCE needs two different-discipline collectors to fetch an identical source_url; current collectors query their own API hosts, so expect none. The news collector (MEDIAINT) is not registered and has no extractor.

**Notes.** The CORRELATED label is decision D-2. Legacy headers (cross-intelligence.ts:28, case-entities.ts:29) say 'A test greps this file', but no file in legacy/tests references cross-intelligence.ts or case-entities.ts, and INVENTORY.md marks cross-intelligence 'Pure; untested'. The structural no-value-comparison guarantee was never tested. A port needs a real test. Mapping: evidenceRefs must become exact (claims.relationship_id or entity_id, then claims.evidence_id); legacy's collector-wide refs would cite evidence unrelated to the edge. Registry discipline is single-valued here (packages/collectors registry entry.discipline). Dependencies: case-entities.ts contributingSourcesOf (PURE), osint/entity-resolution.ts resolveEntities and computeMergeConfidence (PURE), collectors/result.ts types and UNSCORED (constants unbinned; its functions PURE), capability rows from collectors/capability-report.ts capabilityReport (IO-BOUND), and case-geoint.ts GEOINT_DISCIPLINE_ROW. What exists here already: no correlation surface. Fusion already attaches claims from several collectors to one entity row by identifier, so the ENTITY and INFRASTRUCTURE data is in the database, just not surfaced as a correlation. Nothing is defence-specific; the INT discipline names match our COLLECTOR_DISCIPLINES.


### Infrastructure contradictions: disjoint value sets between collectors (`case-infra-contradictions`)

**Where it goes:** R1-d. **Exports (3):** `CaseInfraContradiction`, `observedAtByCollector`, `toContradictionInputs`.

**1. What it claims to produce.** For each (source entity, relationship type), it compares the value sets that each collector reported. It flags a pair of collectors whose sets share no value, and gives both sides' values, a time per side, an explanation typed isHypothesis:true and status 'warrants-review'. It never says which side is right. Overlap counts as partial coverage, not disagreement.

**2. Strengths it can honestly carry.** The flag ('collector A's and collector B's values for this entity and predicate share nothing') is a deterministic set computation over stored claims, so it is DERIVED. Each side's values keep their own stored strengths, e.g. dns resolves_to carries its evidence's strength. possibleExplanation is HYPOTHESIS, which matches our definition word for word ('A possibility the cited evidence permits but does not establish'). It is not CORRELATED, because in our glossary CORRELATED is a link drawn by the analysis model (report-wording.ts:24). It is never OBSERVED or REPORTED.

**3. Numbers, scores or labels not derived from cited evidence.** (1) legacy/src/utils/osint/contradictions.ts:158 `? "The two observations carry different collection times, so the underlying record may have changed between them."` is asserted whenever both times are non-null (:211 `a.observedAt !== null && b.observedAt !== null`), without comparing them. Disposition: compare the two times, print both verbatim, and say 'differ' only when they do. (2) legacy/src/utils/cases/case-contradictions.ts:155 `if (at && (current === null || at < current)) out[ev.collector] = at;`: the per-side time is the collector's earliest collectedAt over all its evidence, carried in a field documented 'When the claim was observed' (osint/contradictions.ts:70). Disposition: carry each side's own evidence observed_at and collected_at, each null when absent. No scores or percentages are produced.

**4. Auto-merging or auto-linking by name.** Not inside these exports. But every legacy caller first passes relationships through resolvedCaseEntities (legacy/src/utils/cases/case-entities.ts:118, R0 PURE; e.g. components/case-contradictions-panel.tsx:300-305), so detection keys on merged ids. Those merge rules are audited with case-entities. In ours, merges are entity_merges rows, and the DB check entity_merges_no_name_only_automerge forbids name-only automatic merges of PERSON and ORGANIZATION. The port must decide whether to fold merged entities (GraphNode.mergedIntoEntityId) before comparing.

**5. Person data.** Legacy applies no gate. In ours today, relationships come from TECHINT and SOCMINT collectors: account_with_handle links usernames to social accounts (github, hackernews, devto), and wikidata_search_candidate items can be people. The PERSON discipline (contact.phone) emits no relationships. Any read whose contributing runs used a person collector must go through personLockFor/requirePersonAccess (CLAUDE.md §9).

**6. LLM.** no

**7. Inputs we do not collect.** Needs at least two registered collectors asserting the same relationship kind from the same source entity. Today each comparable kind has a single producer. resolves_to comes only from dns (packages/osint-engine/src/fusion/extractors.ts:262), subdomain_of only from crtsh (:246), uses_nameserver only from rdap (:287) and wikidata_search_candidate only from wikidata (:329). hosted_on, legacy's other infrastructure predicate, comes from no collector. account_with_handle has three producers (:350, :372, :392), but each links to its own platform's account, so the sets are disjoint by construction and a direct port would flag every username found on two platforms. It must be kept out by a list of comparable kinds. Ships behind 'Not built: needs a second source for resolves_to / subdomain_of / uses_nameserver (for example a passive-DNS or second certificate-transparency collector)'.

**Notes.** Delegated module legacy/src/utils/osint/contradictions.ts: detectContradictions R0 PURE (port PORT-ADAPTED); describeContradiction R0 UI/DEAD; summariseContradictions R0 FABRICATION-FLAGGED (numeric-zero-flattening at :248, a counter initialiser). The AST rule no-fabricated-fallback is silent on the whole file (checked by running it). Defect to pin with a regression test: :122 builds the key as `${rel.sourceEntity} ${rel.relationshipType}`, and :189 `const entity = key.slice(0, key.indexOf(" "));` recovers the entity. An entity id containing a space is therefore reported truncated; legacy spiderfoot ids lowercase the event data (collectors/external/spiderfoot.ts:294). Use a structured key. Our stored data supports the computation: claims(relationship_id, evidence_id) -> entity_relationships(source_entity_id, kind, target_entity_id), and evidence(collector_id, observed_at, collected_at). Because observed_at is the source's own time, legacy's limitation 'Timestamps are the collector run times' no longer applies when it is present (rdap sets it; dns and crtsh set null). Comparing within one collector across runs (a value changing over time) is not legacy logic and is not covered. The disjointness rule is kept, but legacy compared every predicate, so it cannot ship exactly as legacy computed it. No legacy test file imports any of these modules.


### Case-level contradiction report and summary (`case-contradiction-report`)

**Where it goes:** R1-d. **Exports (9):** `ContradictionProvenance`, `CaseContradiction`, `CaseContradictionReport`, `CASE_CONTRADICTION_LIMITATIONS`, `NO_ADJUDICATION_CAVEAT`, `BuildOptions`, `buildCaseContradictions`, `CaseContradictionSummary`, `summariseCaseContradictions`.

**1. What it claims to produce.** One case-level report holding media conflicts and infrastructure contradictions with provenance (case, run, investigation, snapshot time). It includes denominators (claims, articles and relationships examined, collectors compared), a withheld-untraceable count, the merged limitations, a summary (totals, subjects affected, counts by relationship type, statuses present) and a fixed no-adjudication caveat.

**2. Strengths it can honestly carry.** The counts and denominators are DERIVED. Each contained item keeps its own labels: a DERIVED flag with a HYPOTHESIS explanation, and media sides that stay REPORTED. The report itself asserts nothing stronger, and is never OBSERVED, CORRELATED or INFERRED.

**3. Numbers, scores or labels not derived from cited evidence.** (1) legacy/src/utils/cases/case-contradictions.ts:263 `withheldUntraceable: allConflicts.length - traceable.length,` reads as a measured count but is structurally 0, because of the minted refs at mediaint/claims.ts:611. Disposition: compute it from real resolution failures. (2) :262 `collectorsCompared: inputs.length,` counts every collector that contributed any relationship, not the collectors compared on a shared predicate. Disposition: count the collectors that took part in at least one comparison, or rename the field. (3) :283-286 subjectsAffected puts media subject token keys and infrastructure entity ids into one Set. Disposition: report them separately. (4) Legacy callers fill provenance with empty strings, e.g. components/case-contradictions-panel.tsx:311 `(timelineOk ? timeline.snapshot!.investigationId : graph.snapshot!.investigationId) ?? "",` (UI file, outside cases/). Disposition: null. Per-claim scores are covered under case-media-claims.

**4. Auto-merging or auto-linking by name.** Inherited: legacy callers resolve entities with resolvedCaseEntities before calling it (infrastructure), and media claims are linked by name tokens. The report itself merges nothing.

**5. Person data.** Inherited from both halves. The whole read must use the shared person gate (personLockFor or requirePersonAccess) whenever any contributing run used a person collector, and must refuse the whole read rather than drop items.

**6. LLM.** no

**7. Inputs we do not collect.** Case scope. Our cases hold only case_pins (packages/db/src/schema/cases.ts) and have no link from case to run or investigation. Legacy scoped each case by a browser snapshot of a whole run (legacy/src/utils/graph-store.ts:40 and timeline-store.ts:36, held in browser storage). Beyond that, the inputs listed under case-infra-contradictions and case-media-claims are missing. Ships behind 'Not built' naming the missing second infrastructure source and the held news collector.

**Notes.** Owner decisions: (a) what a case's contradiction scope is: only its pinned evidence, claims, relationships and entities, or every claim of the runs linked to it (which needs a new link table); (b) whether media claims are persisted or derived on read (see case-media-claims); (c) whether NO_ADJUDICATION_CAVEAT and the limitation lists join REPORT_WORDING, so that every report stores them. Other legacy callers: utils/osint/verification.ts:259 passes `snapshotSavedAt: now`; case-context.ts, case-report-build.ts and case-summary-panel.tsx call buildCaseContradictions too. R0 bins: buildCaseContradictions PURE and summariseCaseContradictions PURE; the delegate summariseContradictions is FABRICATION-FLAGGED (osint/contradictions.ts:248). No legacy test file imports these modules.


### Contradictions projected into a report (`case-contradictions-in-report`)

**Where it goes:** R1-d (the projection; a case report itself is out of R1, D-15). **Exports (4):** `ReportContradiction`, `NO_CONTRADICTIONS_MESSAGE`, `toReportContradictions`, `CONTRADICTION_CAVEAT`.

**1. What it claims to produce.** Every detected media or infrastructure contradiction in the case as a report row: both claims, both sources, evidence refs, claim classes, confidences, publication times, review status, and a templated explanation labelled a hypothesis. Plus 'none detected' wording and a no-adjudication caveat.

**2. Strengths it can honestly carry.** Each side keeps its own evidence's strength (REPORTED for third-party records and articles here). That two values disagree is DERIVED (deterministic detection). The explanation is HYPOTHESIS (templated, with an explanationBasis). Nothing here is OBSERVED in our sense.

**3. Numbers, scores or labels not derived from cited evidence.** legacy/src/utils/cases/case-report.ts:363 'claimClassA: "OBSERVED",' and legacy/src/utils/cases/case-report.ts:364 'claimClassB: "OBSERVED",' hardcode a strength for every infrastructure contradiction. Remove: carry each side's recorded strength. legacy/src/utils/cases/case-report.ts:360 'evidenceRefA: null,' is honest but uncitable here (every claim maps to an evidence id), so infrastructure contradictions must cite both sides' evidence or not be emitted. Media confidences (legacy/src/utils/cases/case-report.ts:335 'confidenceA: a.confidence.value,') come from the legacy extractor's score; there is no counterpart here, so null or drop.

**4. Auto-merging or auto-linking by name.** No.

**5. Person data.** Possibly. Media claims carry attributedTo (named people) and publishers, and a contradiction can concern a person or username entity. If either side rests on PERSON-discipline evidence, the shared person gate applies.

**6. LLM.** No. Explanations are deterministic templates (legacy osint/contradictions.ts explanationFor).

**7. Inputs we do not collect.** There is no contradiction engine and no media claim extractor here, so this ships behind 'Not built: contradiction detection' (and 'Not built: media claim extraction' for the media half).

**Notes.** Depends on case-contradictions.ts (buildCaseContradictions PURE; NO_ADJUDICATION_CAVEAT), osint/contradictions.ts and mediaint/claim-conflicts.ts, which belong to other readers. legacy/src/utils/cases/case-report.ts:327 'sourceA: a.publisher ?? a.source,' falls back from the publisher to the record's own source string; here the source label comes from the registry and the publisher is a separate field. Legacy OBSERVED ('Read directly from the named source', collectors/result.ts) corresponds to our REPORTED, which is a vocabulary trap for every port.


### Credential redaction and compact value projection before a model call (`prompt-value-hygiene`)

**Where it goes:** R1-f. **Exports (2):** `isSecretKey`, `summariseValue`.

**1. What it claims to produce.** Replaces values under credential-like keys with [redacted] (reported, not dropped) and renders a collector's normalized value as a short readable string, never the raw payload.

**2. Strengths it can honestly carry.** None of its own: it makes no claim, and the projected text keeps the strength of the record it came from. To stay honest, truncated text must be marked as shortened, as displayValue does.

**3. Numbers, scores or labels not derived from cited evidence.** None found (no numbers, scores or labels). Honesty gaps: legacy/src/utils/cases/case-context.ts:233 "if (typeof value === "string") return value.slice(0, maxLength);" truncates without a marker -> flag truncation; case-context.ts:247 "if (v === null || v === undefined || v === "") continue;" silently skips null fields -> state them as not reported where the field matters.

**4. Auto-merging or auto-linking by name.** No.

**5. Person data.** It processes whatever values it is given, person data included; the redaction covers credentials only, not personal data.

**6. LLM.** No.

**7. Inputs we do not collect.** None.

**Notes.** isSecretKey's regex only matches whole segments between _ or . separators: tested with node, it returns false for accessToken, clientSecret, authToken, refreshToken, sessionId and x-api-key. Port with camelCase and hyphen splitting and a regression test. Ours redacts credentials only in URLs today (packages/collectors/src/evidence.ts:15, fetcher/capture.ts:11). summariseValue's job is already done by displayValue (assemble.ts:141), which flags truncation.


### Grounded case question answering (`case-grounded-qa`)

**Where it goes:** R1-f builds the written case summary; question answering waits on D-9. **Exports (14):** `GroundedFindingSchema`, `GroundedFinding`, `GroundedAnswerSchema`, `GroundedAnswer`, `GroundedResult`, `GROUNDED_SYSTEM`, `serializeCaseContext`, `buildGroundedPrompt`, `GroundedProblem`, `assertsCertainty`, `validateGroundedAnswer`, `GroundedInput`, `analyseCaseGrounded`, `llmAnalyseCaseGrounded`.

**1. What it claims to produce.** Answers an analyst's free-text question about one case: a headline answer, up to 12 findings each with a claim class, cited evidence ids and a basis, a non-empty list of what the evidence cannot answer, and a collection caveat. Claims every finding is checked in code against the case's own evidence, retried once, then rejected.

**2. Strengths it can honestly carry.** Model-written statements can honestly carry only CORRELATED (links two or more independent cited sources; validateCitations enforces two), INFERRED or HYPOTHESIS: core SYNTHESIS_STRENGTHS, and CLAIM_STRENGTH_DEFINITIONS define CORRELATED and INFERRED as drawn by the analysis model. Legacy lets the model self-label OBSERVED, REPORTED, OFFICIAL_STATEMENT and DERIVED (case-analysis.ts:349); OBSERVED and DERIVED describe what the platform saw or computed and REPORTED what a source stated, so a model's restatement cannot carry them. OFFICIAL_STATEMENT is not one of our six (on evidence it maps to REPORTED, never on model text).

**3. Numbers, scores or labels not derived from cited evidence.** legacy/src/utils/cases/case-analysis.ts:60 "answer: z.string().min(1)," (uncited headline) -> remove; the answer is cited statements. case-analysis.ts:67 "notSupported: z.array(z.string()).min(1)," and :72 "collectionCaveat: z.string().min(1)," (uncited model text about gaps and coverage; the caveat check at 534-535 passes any text containing 'not') -> coverage from ReportCoverage; whether uncited gap statements are allowed at all is an owner decision. case-analysis.ts:221 prints a merged entity's resolver formula score as the collector's confidence -> remove (null). case-analysis.ts:349 lets the model choose OBSERVED/REPORTED/DERIVED -> restrict to SYNTHESIS_STRENGTHS.

**4. Auto-merging or auto-linking by name.** Not in these lines directly; serializeCaseContext prints entities that buildCaseContext already auto-merged (see case-context-assembly).

**5. Person data.** Yes. The context sent to the model holds every evidence record, entity and relationship in the case, including person-collector output (usernames, e-mail addresses, phone numbers, social accounts, PERSON entities), plus the case title, description and target. A port is a read resting on person data: call requirePersonAccess or personLockFor (apps/api/src/http/person-gate.ts) and refuse the whole answer (403 MODULE_NOT_IN_PLAN or VETTING_NOT_APPROVED with a locked block); never drop person records to make it pass. Sending them to the model endpoint is processing, so the endpoint provenance is recorded as in ReportSynthesis.model.

**6. LLM.** Yes, LARGE: router task 'synthesis' (TASK_SIZE in packages/llm/src/router.ts). Validation (validateCitations, assertsCertainty, checkOutput) and prompt construction need no LLM.

**7. Inputs we do not collect.** Buildable from what we store: pinned evidence, claims, entities, relationships (case_pins). Not collected: per-evidence confidence (evidence has no confidence column), so the legacy rule at case-analysis.ts:487 (OBSERVED resting only on unmeasured evidence) has no input; media claims with polarity, publisher, syndication; contradictions (apps/web/src/workspace/OverviewTab.tsx:82 already says 'needs contradiction detection across sources'); cross-intelligence correlations; case-level coverage (cases pin items from many runs; Workspace.tsx:282 says a case report needs a case-level endpoint). Those context sections ship behind Not built naming the input.

**Notes.** ALREADY HERE: (1) Citation validation: validateCitations (packages/llm/src/citations.ts) was ported from validateGroundedAnswer (docs/PLAN.md:1128); it rejects unknown refs, requires a citation on EVERY statement (legacy let INFERRED/HYPOTHESIS cite nothing), needs two independent sources for CORRELATED and corroboration wording, and uses fixed-text problems (legacy quoted the model's statement into the retry, lines 446, 454, 595). assertsCertainty is ported with a longer word list. (2) Retry once then reject: generateValidated (generate.ts) with LlmOutputRejectedError. (3) Delimited content: frameUntrusted (hash boundary, inertJson escaping, canary), trusted`` instructions that cannot interpolate, DATA_POLICY; legacy concatenated case material and the question straight after the rules (lines 310-357). (4) Output guards checkOutput (markup leak, instruction echo, unsupported identifier, call to action, risk verdict); legacy had none. (5) Allowlists: citable refs via CitationContext.refs built from the framed records; models via LLM_MODEL_ALLOWLIST (packages/config/src/llm.ts), where legacy took any model from env LLM_MODEL (llm.ts:52). (6) Tenant-namespaced response cache (cache.ts) and per-tenant metering (metering.ts); legacy's cache was process-global and keyed only on model, system and prompt (llm.ts:255), with no metering. (7) Model strength restriction SYNTHESIS_STRENGTHS and provenance recording. The nearest existing consumer is report synthesis (synthesis.ts), which is run-scoped and takes no question. NEW: a question-driven task over a case (case_pins, not one run); where the analyst's question travels (trusted`` forbids interpolation, so it must be a framed record or the policy must be extended: design decision); a per-statement basis field; a strength-ceiling check (no finding stronger than its cited evidence; neither codebase validates it); how gaps (notSupported) are expressed; case-level coverage; Fastify route + worker job + typed errors (legacy throws LlmUnavailableError for an empty question at 563 and for a citation failure at 598). Legacy dependencies: llm.ts chatJson (IO-BOUND), LlmUnavailableError (PURE); collectors/result.ts CLAIM_CLASSES and CLAIM_CLASS_DETAIL (constants, unbinned), confidenceBandOf (PURE); case-contradictions.ts NO_ADJUDICATION_CAVEAT (constant). The legacy server function receives a browser-built context (agents.tsx:322-406) and validates nothing (line 608).

## Already built here: nothing to port

### Case entity resolution (read-time accessor) (`case-entity-resolution`)

**Where it goes:** fusion resolves by identifier at write time; name matches are only offered as merge candidates (INFERRED, never merged automatically). **Exports (9):** `RESOLUTION_SOURCE`, `RESOLVED_ID_PREFIX`, `ResolvedCaseEntities`, `isResolvedEntity`, `contributingSourcesOf`, `resolvedCaseEntities`, `currentEntityId`, `resolutionSummary`, `RESOLUTION_CAVEATS`.

**1. What it claims to produce.** At read time it applies resolveEntities to a case's stored per-collector entities and relationships. Every non-person, non-organization group with the same (type, normalised value) is collapsed into one synthetic `resolved:` entity with source 'entity-resolution', metadata.mergedFrom and a corroboration confidence. Relationship endpoints are remapped, self-loops are dropped and edges are deduped. It returns idRemap and mergedCount, plus a contributor lookup, an id follower, a one-line summary and caveats.

**2. Strengths it can honestly carry.** Matching identical normalised identifiers is deterministic computation (DERIVED). In our model it is identity resolution at write time, not a claim at all: the merged entity's facts are the contributors' own claims, each keeping its own strength (OBSERVED/REPORTED/DERIVED). legacy result.ts:60 files resolution merges under CORRELATED, which our glossary reserves for model-drawn links. The corroboration score can carry no strength and is removed.

**3. Numbers, scores or labels not derived from cited evidence.** legacy/src/utils/osint/entity-resolution.ts:119 "const corroboration = Math.min(0.5 + 0.15 * (sources.length - 1), 0.95);": remove (already removed in packages/osint-engine/src/fusion/identifiers.ts). case-entities.ts:149 asserts an absence nobody checked: rewrite as a rule statement. case-entities.ts:167 presents that score as computed from 'independent' collectors: remove. case-entities.ts:132 "mergedCount: idRemap.size," counts distinct remapped ids, so duplicate ids across a case's runs count once. It is measured, but the summary text attributes every merge to 'different collectors'. Quoted: case-entities.ts:149 `return `${originalCount} entities, none merged — no two collectors reported the same value for the same entity type.`;` and :167 `"A merged entity's confidence is recomputed from how many independent collectors reported it. ..."`.

**4. Auto-merging or auto-linking by name.** People and organisations: NO. entity-resolution.ts:91 "export const NOT_MERGEABLE_BY_VALUE: ReadonlySet<EntityType> = new Set(["person", "organization"]);" and :209 "if (NOT_MERGEABLE_BY_VALUE.has(entity.type)) {" pass them through unmerged. Every other type IS auto-merged on an exact normalised value, keyed at :213 "const key = `${entity.type}:${normalizeEntityValue(entity.type, entity.value)}`;". That includes `location`, whose values are place names, via normalizeGeneric at :74 "return value.trim().toLowerCase();". So two different places sharing a name merge automatically: a name-based automerge outside PERSON/ORGANIZATION. Usernames are lower-cased (:56), over-merging on case-sensitive platforms. Unparseable URLs merge on lower-cased text (:68). Conflicting metadata is silently overwritten by the last contributor (:234 "for (const e of group) Object.assign(mergedMetadata, e.metadata);"), losing which collector said what. The merges are NOT reversible records: they are recomputed on every read with no decision row, actor, reason or undo, and the originals leave the entity list (only idRemap keeps their ids).

**5. Person data.** Yes. It resolves the whole case, passes person entities through, and merges person identifiers (email, phone, username, social_account) by value, with no gate. In our model, every read of the resolved entities goes through requirePersonAccess.

**6. LLM.** no

**7. Inputs we do not collect.** None. Its inputs are the collected entities themselves. Nothing needs porting: our fusion already resolves at write time.

**Notes.** WHAT EXISTS HERE. (a) Write-time resolution (packages/osint-engine/src/fusion/fuse.ts:131-141 calling EntitiesRepository.resolveByIdentifier, an insert with on-conflict-do-nothing on the unique index entities_one_per_identifier (tenant_id, kind, identifier)). It is a DETERMINISTIC EXACT match on a normalised identifier per kind: DOMAIN normaliseDomain; IP_ADDRESS lower-cased; EMAIL_ADDRESS normaliseEmail; PHONE_NUMBER the raw target value, un-normalised; USERNAME normaliseUsername, case kept; URL normaliseUrl, or null for an unparseable URL, which then becomes a new entity; SOCIAL_ACCOUNT platform:handle, case per platform; ORGANIZATION only by wikidata:QID, otherwise a new entity every time; PERSON never by value. A database check (entities_named_kinds_external_identifier_only) enforces the named-kind rule. This is not a merge record and cannot be undone: by construction there is one row. Provenance survives per claim, because each claim cites one evidence item that carries collector_id. (b) entity_relationships is unique per (source, target, kind); asserting a relationship again adds a claim, not an edge. (c) NAME-match suggestions: GET /api/v1/entities/merge-candidates (exploration.ts mergeCandidates) pairs entities of the same kind whose lower(btrim(display_name)) is equal. They are computed on request and never stored, labelled INFERRED with nameOnly: true, never merged automatically, person-gated, and pairs with any merge on record are excluded. (d) entity_merges are REVERSIBLE DECISION RECORDS. A merge rewrites or deletes nothing. An undo sets the revert columns, is final, and is the only update allowed (trigger plus column grants). There is at most one active merge per merged entity; a trigger prevents cycles; composite foreign keys enforce the same kind; the check entity_merges_no_name_only_automerge forbids RULE merges of PERSON or ORGANIZATION on NAME alone, and the repository re-checks with the NAME_ONLY_AUTOMERGE error. The API creates only USER merges (POST /api/v1/entity-merges, POST /:id/undo, session required, API keys refused). No production code creates RULE merges; only the tests do. entity_merges.confidence is NOT NULL, supplied by the analyst and documented as 'as assessed by whoever made the decision'. Raised for the owner (confirmed in this audit): see D-10 and D-23. GET, POST and undo on /api/v1/entity-merges do not call requirePersonAccess, while a merge row for a PERSON entity exposes its ids, kind and the analyst's free-text reason; worth checking against CLAUDE.md §9. NAME_ONLY_AUTOMERGE_FORBIDDEN covers only PERSON and ORGANIZATION, and legacy's location-by-name merge shows LOCATION may deserve the same rule once a location extractor exists. Delegated modules read in full: legacy/src/utils/osint/entity-resolution.ts (296/296), legacy/src/utils/collectors/result.ts (430/430), plus dedupeRelationships in legacy/src/utils/osint/merge.ts:25-32. R0 bins: entity-resolution.ts functions all PURE; result.ts functions PURE.


### Run status from job statuses, and run tallies (`run-status-rollup`)

**Where it goes:** runStatusOf in packages/osint-engine/src/fusion/fuse.ts. **Exports (7):** `RUN_STATUSES`, `RunStatus`, `TERMINAL_RUN_STATUSES`, `RunJobStatusLike`, `runStatusFromJobs`, `CaseRunSummary`, `summariseRuns`.

**1. What it claims to produce.** A run's status derived from its jobs: COMPLETED only when every job completed, FAILED for zero jobs, RUNNING while any job is unfinished, CANCELLED when all were cancelled, FAILED when none collected anything, PARTIAL otherwise. Also counts of runs by type and status.

**2. Strengths it can honestly carry.** DERIVED: both the status and the counts are computed from recorded job and run statuses.

**3. Numbers, scores or labels not derived from cited evidence.** Gate hits: case-runs.ts:378 `byType[r.inputType] = (byType[r.inputType] ?? 0) + 1;` and case-runs.ts:379 `byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;` (numeric-zero-flattening). In substance this is a tally initialiser, not an invented value. Disposition: rewrite with every key of the closed vocabulary set to 0 before counting (as progress.ts:59-68 does). No invented status was found in runStatusFromJobs.

**4. Auto-merging or auto-linking by name.** No.

**5. Person data.** No. Statuses only.

**6. LLM.** No.

**7. Inputs we do not collect.** None. Our jobs table records every status the rule needs.

**Notes.** Still worth keeping: one branch. runStatusOf in packages/osint-engine/src/fusion/fuse.ts:57-63 already enforces the core rule: SUCCEEDED only when every job succeeded, zero jobs -> FAILED, any unfinished -> RUNNING, some succeeded -> PARTIAL. It returns FAILED where legacy returns CANCELLED for all-cancelled jobs. Nothing in this repository sets a job or run to CANCELLED yet (grep), so add the branch and a regression test when cancellation ships. Other differences: legacy jobs had a 'partial' status, which ours lack (FOUND and NOT_FOUND both settle as SUCCEEDED), and ours treat DEAD_LETTERED as terminal. TERMINAL_RUN is duplicated privately in progress.ts:44 and in the web app (apps/web/src/run/progress.ts), so exporting it from packages/core would match legacy's exported TERMINAL_RUN_STATUSES; this is optional.


### Attach collector findings to an analyst-chosen case (`case-attach`)

**Where it goes:** case_pins and POST /api/v1/cases/:id/pins. **Exports (9):** `AttachableResult`, `CaseAttachRefusal`, `CaseAttachOutcome`, `NOT_CASE_SCOPED_ATTACH`, `ATTACH_RESULT_CAVEATS`, `MergeResultInput`, `MergeResultOutput`, `mergeResultIntoCase`, `attachResultToCase`.

**1. What it claims to produce.** Puts a collector result (entities, relationships, evidence) into one chosen case's localStorage graph and timeline snapshots. It never infers the case, keeps existing records when ids collide, refuses rather than letting the store silently cap, and reports how many records were added and which evidence ids.

**2. Strengths it can honestly carry.** The attach makes no claim of its own. It passes each record's claimClass through unchanged and cannot raise it. The only values it produces are the added counts in the outcome, which are DERIVED (computed from the merge). Here a pin carries no strength: the pinned evidence or claim keeps its own claim_strength.

**3. Numbers, scores or labels not derived from cited evidence.** (1) case-attach.ts:216 `investigationId: input.graph?.investigationId ?? "",` writes an empty string for an unknown id. Disposition: null (the gate does not fire on ""; CLAUDE.md §1 forbids it). (2) case-attach.ts:217 `target: input.graph?.target ?? input.source,` makes the attach's source label the case snapshot's investigation target when the case has none. Disposition: remove; pins carry no target. (3) case-attach.ts:96 says id-less records 'may add duplicates if the underlying data changed between attaches', but lines 132 and 149 make positional keys for incoming records start at existing.length, so id-less records are duplicated on every re-attach. 'most social and web evidence' is an uncounted characterisation. Disposition: remove; our unique pin indexes make re-pinning idempotent. The added counts (lines 208-210, 247) are measured from the merge and are supported.

**4. Auto-merging or auto-linking by name.** No. Entities are deduplicated only by exact id (line 186 `const mergedEntities = mergeById(baseEntities, newEntities, (e) => e.id);`) and relationships by an exact source|type|target|source key (line 137). On a collision the existing record is kept and nothing is combined. No name matching.

**5. Person data.** Yes, indirectly. It carries any collector output unfiltered, including person, email, phone and username entities and CANDIDATE_IDENTITY edges, and the legacy attach applies no person gate. our POST /api/v1/cases/:id/pins already calls requirePersonAccess (apps/api/src/routes/cases.ts:311), and listing pins gates the whole case (line 353).

**6. LLM.** no

**7. Inputs we do not collect.** Nothing is missing. the platform already has this capability: case_pins (packages/db/src/schema/cases.ts:44) with one target per pin, a per-case unique index per target kind, an archived-case refusal, the person gate, and audit. The one difference is granularity: the platform pins one record per request, while legacy attached a whole result. A batch 'pin a run's results to a case' endpoint would be new API work, not a port (owner decision, see notes).

**Notes.** Delegates to graph-store.ts (readGraphSnapshotForCase and saveGraphSnapshotForCase, both R0 UI/DEAD because they use window/localStorage), timeline-store.ts (readTimelineSnapshotForCase and saveTimelineSnapshotForCase, both UI/DEAD), case-scope.ts MAX_SNAPSHOT_ENTITIES=500 / MAX_SNAPSHOT_EVIDENCE=300 / MAX_SNAPSHOT_RELATIONSHIPS=1000 (constants; capRecords is PURE), and the collectors/result.ts types. A legacy defect the caveats never disclose: a later case run overwrites the whole case slot (case-runs-panel.tsx:274 `saveTimelineSnapshot({` with caseId: run.caseId; timeline-store.ts:97 writes the scoped key wholesale), which silently erases every attached record. So the protection only works one way: an attach cannot evict run data, but a run evicts attachments. There are no legacy unit tests; only the osint/verification.ts harness calls mergeResultIntoCase. Owner decision, outside this port: does a the platform case need a bulk pin (for example 'pin every evidence row of run X'), and if so, should an empty batch be refused, as legacy's NOTHING_TO_ATTACH did, because an empty attachment reads as 'examined and clean'? Belongs in R1? No: there is nothing to port. Pins cover it.


### Derived case view (status mapping, case number, updatedAt, evidence count) (`case-view`)

**Where it goes:** the cases API (pinCountOf refuses a missing count). **Exports (8):** `CASE_STATUSES`, `CaseStatus`, `toCaseStatus`, `CaseView`, `caseNumberOf`, `toCaseView`, `listCases`, `findCase`.

**1. What it claims to produce.** A display record for a stored case: a status mapped onto OPEN/IN_PROGRESS/CLOSED, a case number parsed from the INV-n id, updatedAt as the newest pin time (else createdAt), and an evidence count.

**2. Strengths it can honestly carry.** DERIVED only. The count and the parsed number are computed from the stored record. updatedAt is DERIVED but mislabelled: it is the newest pin time, not an update time. The status mapping is a deterministic relabel, not a claim about the world.

**3. Numbers, scores or labels not derived from cited evidence.** legacy/src/utils/cases/case-runs.ts:119 `evidenceCount: inv.evidence?.length ?? 0,`: a count that was not measured becomes 0. Disposition: null, or here the measured case_pins count, which fails as PIN_COUNT_MISSING. case-runs.ts:118 `updatedAt: pinTimes[pinTimes.length - 1] ?? inv.createdAt,`: createdAt stands in for an update time. Disposition: our CaseView has no updatedAt; if one is added, name it lastPinnedAt and make it null when nothing is pinned. case-runs.ts:67-68 `default:` / `return "OPEN";`: an unrecognised stored status becomes OPEN. Disposition: dropped with the module.

**4. Auto-merging or auto-linking by name.** No.

**5. Person data.** Indirectly. The legacy case's `target` may name a person and is passed through unchanged. Our CaseView has no target, and reading a case's pins is person-gated (requirePersonAccess in apps/api/src/routes/cases.ts).

**6. LLM.** No.

**7. Inputs we do not collect.** None. Fully superseded.

**Notes.** Superseded by apps/api/src/routes/cases.ts (CaseView, caseView, pinCountOf) over packages/db/src/schema/cases.ts. Delegates to legacy investigations-store.ts (getInvestigations: localStorage). R0 bins listCases as PURE, which misses that localStorage call.


### Snapshot-to-case scope gate (MATCH / MISMATCH / UNSCOPED) (`case-scope-check`)

**Where it goes:** ScopeQuery / resolveScope, and the pin route's case check. **Exports (8):** `SnapshotProvenance`, `CaseScopeResult`, `CaseScopeVerdict`, `MaybeScoped`, `isUnscoped`, `assertSnapshotBelongsToCase`, `scopedKey`, `SCOPE_CAVEATS`.

**1. What it claims to produce.** Whether a persisted graph or timeline snapshot belongs to the case being viewed, with a sentence explaining why not. Per-case storage keys so one case's run does not overwrite another's.

**2. Strengths it can honestly carry.** None. It is an access and display gate, not a claim about a target. Its verdict restates stored metadata.

**3. Numbers, scores or labels not derived from cited evidence.** None found. The detail strings only repeat stored case ids and target.

**4. Auto-merging or auto-linking by name.** No.

**5. Person data.** Indirectly: snapshots may hold person entities, but this gate checks only case scope, not person access.

**6. LLM.** No.

**7. Inputs we do not collect.** None.

**Notes.** Still worth keeping: the idea, which is already implemented server-side and needs one test. ScopeQuery requires exactly one of caseId or runId, and resolveScope returns 404 for an unknown scope rather than an empty list (apps/api/src/routes/scope.ts). case_pins uses composite (tenant_id, case_id) foreign keys. The unpin route refuses a pin of another case (apps/api/src/routes/cases.ts:383), which is the server's MISMATCH check. Gap: no test covers a same-tenant cross-case unpin. Add one where DELETE /api/v1/cases/{B}/pins/{a pin of A} returns 404 and A's pin survives. Existing tests cover only the same case (apps/api/test/exploration-api.test.ts:227-228) and another tenant (line 1035). The legacy failure (a single last-write-wins browser slot) cannot occur with Postgres rows and scope-keyed web queries.


### Capped snapshots with disclosed truncation (`snapshot-truncation`)

**Where it goes:** GraphSlice.truncated and limit plus hasMore on every list. **Exports (5):** `SnapshotTruncation`, `MAX_SNAPSHOT_ENTITIES`, `MAX_SNAPSHOT_EVIDENCE`, `MAX_SNAPSHOT_RELATIONSHIPS`, `capRecords`.

**1. What it claims to produce.** A list cut to a cap, with truncated, total and stored counts recorded, so a capped view never reads as complete.

**2. Strengths it can honestly carry.** DERIVED: the counts are computed from the list.

**3. Numbers, scores or labels not derived from cited evidence.** None in capRecords. In the delegated legacy/src/utils/graph-store.ts:103-104, `totalRecords: snapshot.entities.length,` / `storedRecords: entities.kept.length,` record only entity counts even when only relationships were cut. A relationship-only truncation then reads truncated: true with total equal to stored. Disposition: dropped with the store. Any port should report each capped list separately.

**4. Auto-merging or auto-linking by name.** No.

**5. Person data.** No.

**6. LLM.** No.

**7. Inputs we do not collect.** None.

**Notes.** Still worth keeping: the principle, which already holds. GraphSlice.truncated (packages/core/src/graph.ts:52), graph.ts:89, exploration.ts:337-350, and required limits with hasMore on every list (packages/db/src/repositories/base.ts:15) all apply it. The only increment is total versus stored counts, which needs a COUNT query; it is optional. Latent gap where it applies: jobs.listForRun({ limit: 1000 }) in progress.ts:58, fuse.ts:87/99, runs.ts:62 and reports/assemble.ts:336 caps without disclosure. That cannot be reached today because the planner runs each registered collector at most once per run (planner.ts). A guard at planning (refuse more than MAX_JOBS_PER_RUN) would make it impossible rather than unreachable. The cap constants were sized for a 5 MB browser quota from legacy's own byte measurements and do not transfer.

## Waits for a later stage (no input exists today)

### MEDIAINT claims extracted from a case's article evidence (`case-media-claims`)

**Where it goes:** R3 (MEDIAINT: the news collector is held, and GDELT supplies headlines only). **Exports (8):** `MEDIAINT_NOT_CASE_SCOPED`, `NO_CLAIMS_MESSAGE`, `CASE_CLAIM_CAVEATS`, `CaseClaimsInput`, `CaseClaims`, `caseMediaClaims`, `citedEvidenceRefs`, `claimsHeadline`.

**1. What it claims to produce.** Turns a case's article-shaped evidence (records with a title and a url) into articles and extracts up to 5 claims per article from the headline and body sentences. Where a regex pattern matches it records attributedTo/subject/predicate/object; otherwise it keeps the sentence text only. Each claim gets a class (REPORTED or OFFICIAL_STATEMENT), a polarity (assert/deny), a syndicated flag, an independent-publisher count and a corroboration 'confidence', plus summary counts and caveats. Claims are derived on read and never persisted.

**2. Strengths it can honestly carry.** Each claim is what a publisher printed, so it is REPORTED. Our six strengths have no OFFICIAL_STATEMENT; it maps to REPORTED, with the official-source marker or attributedTo kept as a field. The parse (subject/predicate/object, polarity) and the counts (independentSources, publishers, undated, syndicated) are DERIVED. The syndicated flag is DERIVED from title similarity but depends on an ordering assumption for undated articles (see q3), and must carry that limitation. The corroboration confidence carries no strength and is removed. Nothing here is OBSERVED, which legacy also enforces.

**3. Numbers, scores or labels not derived from cited evidence.** (1) legacy/src/utils/mediaint/claims.ts:552 `c.confidence = { value: corroborationScoreFor(count - 1), reasons } satisfies ConfidenceScore;` uses the hand-set curve legacy/src/utils/credibility.ts:344-348 (0.2 / 0.45 / 0.65 / 0.85 / 0.95). It is always set, so 'confidence not measured' never shows, and it renders as 'confidence N%' (components/case-mediaint-panel.tsx:117, components/case-contradictions-panel.tsx:115) and goes into reports (utils/cases/case-report-build.ts:158). Disposition: remove it; confidence is null, and the measured independentSources count with its reasons remains (DERIVED). (2) claims.ts:539 "Single independent source — uncorroborated." is also pushed when the count is 0 (`count <= 1`, :538), e.g. a syndicated claim with no independent carrier. Disposition: state the measured count. (3) claims.ts:611 `evidenceRefs[id] = ev.evidenceId ?? id;` mints a positional `${ev.collector}#${index}` (claims.ts:595) that is presented as an evidence ref, against claims.ts:71 'Null otherwise — never minted'. Disposition: cite our evidence uuid only. (4) claims.ts:431-433 `const a = article.pubDate || "";`: an undated article sorts before any dated one, so a dated article is labelled a syndicated copy of an undated one. Disposition: syndication order is null (undetermined) when either date is missing. (5) NO_CLAIMS_MESSAGE (case-claims.ts:74) gives an untrue cause. Disposition: rewrite it (see its row). (6) OFFICIAL_SOURCE_MARKERS includes "iaf" (claims.ts:181), an IAF/PS-18-specific marker. Disposition: DROP that entry.

**4. Auto-merging or auto-linking by name.** No entity merge. For corroboration, claims are grouped across articles by token Jaccard >= 0.6 over subject/object tokens (claims.ts:390 `export const CLAIM_MATCH_THRESHOLD = 0.6;`; grouping at :524-529). For a named-person subject, two different people with the same name in similar sentences therefore corroborate each other. This links statements by name tokens rather than merging entities, and the port must label it that way.

**5. Person data.** Yes, in the text. attributedTo and subject are raw names from headlines (any named speaker or subject, possibly a private individual), and author is a byline when supplied. MEDIAINT is not the person module in ours (packages/access/src/entitlements.ts DISCIPLINE_MODULE maps MEDIAINT to TECHINT), so no discipline gate applies. The names are raw personal data and must never be logged, and a case whose runs used a person collector is gated as a whole.

**6. LLM.** no. Extraction is deterministic regex over closed verb and marker lists. Legacy deliberately keeps the model out of creating claims.

**7. Inputs we do not collect.** The news collector is HELD (packages/collectors/src/platform/index.ts HELD_PLATFORM_COLLECTORS: its NOT_FOUND may be systematically false), and there is no news fusion extractor (EXTRACTORS in packages/osint-engine/src/fusion/extractors.ts has none), so no article claim is ever stored. GDELT artlist gives only title, url, outletDomain and seendate. There is no article body (legacy also extracts body sentences), no publisher name, no publication date (seendate is when GDELT first saw the article and must never be shown as publishedAt) and no byline. One evidence row covers a whole GDELT response (observedAt null), so a claim cites that evidence id plus the article URL. Ships behind 'Not built: MEDIAINT article claims need the news collector released from hold and a news fusion extractor; headline-only'.

**Notes.** Delegated module legacy/src/utils/mediaint/claims.ts, R0 bins: extractClaims PURE, articlesFromEvidence PURE, summariseClaims PURE, claimKey PURE, claimsMatch PURE. isOfficialSource, parseClaimSentence, candidateSentences, claimIdFor, claimTokens, claimSimilarity and isSyndicatedCopy are all binned UI/DEAD, but all are used inside the file. legacy/src/utils/credibility.ts corroborationScoreFor is R0 PURE. The gate is silent on claims.ts (both line patterns and the AST rule, run here). The header comment at case-claims.ts:66 itself trips the line gate (numeric-zero-flattening on '`?? 0`'), so a port that copies the header verbatim fails CI. Owner decisions: (a) persist article claims through a news fusion extractor into claims rows (pinnable, since case_pins.claim_id is an FK to claims, and citable by uuid), or derive them on read as legacy did (not pinnable; ids are content hashes from claimIdFor); (b) whether to keep a separate 'official statement' attribute, given that the strength is REPORTED either way. No legacy test file imports these modules.


### Media assertion-versus-denial conflicts (`case-media-conflicts`)

**Where it goes:** R3, with media claims. **Exports (3):** `CaseClaimConflict`, `isTraceable`, `isConflicted`.

**1. What it claims to produce.** Pairs an asserting claim with a denying claim from a different publisher when their subject/object tokens match (Jaccard >= 0.6). It keeps both full records, gives an explanation typed isHypothesis:true and status 'warrants-review', and marks both sides as conflicted. It never adjudicates.

**2. Strengths it can honestly carry.** Each side's polarity (a denial verb from a closed list) and the token-similarity match are DERIVED. The conclusion that the two claims concern the same matter and conflict is a HYPOTHESIS: the subject match is a token heuristic, and a later denial may be a correction (claim-conflicts.ts:60). Each side stays REPORTED.

**3. Numbers, scores or labels not derived from cited evidence.** (1) Conflict records embed both full MediaClaims, including the corroboration confidence from legacy/src/utils/mediaint/claims.ts:552. Disposition: remove it (null). (2) withheldUntraceable can never be non-zero for claims derived from evidence, because claims.ts:611 `evidenceRefs[id] = ev.evidenceId ?? id;` mints a ref that passes isTraceable. Disposition: in ours traceability is guaranteed by claims.evidence_id NOT NULL, so report a count only for real resolution failures. CLAIM_MATCH_THRESHOLD 0.6 (claims.ts:390) is a stated, tuned policy constant, not a displayed score.

**4. Auto-merging or auto-linking by name.** Pairs claims by name tokens through claimsMatch (legacy/src/utils/mediaint/claim-conflicts.ts:98 `if (!claimsMatch(a, d)) continue;`). It does not merge entities. Same-publisher pairs are skipped by comparing `a.publisher ?? a.source` (claim-conflicts.ts:99-101).

**5. Person data.** Yes, the same as media claims: conflict records hold the named speakers and subjects from headlines.

**6. LLM.** no. Legacy notes that a model may later explain a conflict but must not resolve it.

**7. Inputs we do not collect.** The same inputs as case-media-claims: the news collector is held, there is no news fusion extractor, and no body text. The timing explanation (claim-conflicts.ts:66-69) depends on publishedAt, which we do not collect; GDELT's seendate may only be shown as 'first seen by GDELT'. Headline-only extraction finds a denial only when a DENIAL_VERBS word is in the headline. Ships behind 'Not built: MEDIAINT conflicts need stored article claims (news collector held)'.

**Notes.** Delegated module legacy/src/utils/mediaint/claim-conflicts.ts, R0 bins: detectClaimConflicts PURE (port PORT-ADAPTED: same rule over our claims); toContradiction UI/DEAD; summariseClaimConflicts UI/DEAD. Gate silent on the file. CLAIM_CONFLICT_LIMITATIONS carries two near-duplicate 'Absence ... not evidence that sources agree' lines (:61, and :62 via the CONTRADICTION_LIMITATIONS filter); dedupe them.


### GEOINT presence and location-hypothesis count for a case's discipline breakdown (`case-geoint-summary`)

**Where it goes:** R3 (no GEOINT collector is registered). **Exports (5):** `GEOINT_COLLECTOR_ID`, `GEOINT_DISCIPLINE_ROW`, `isGeointEvidence`, `geointEvidenceIn`, `geointHypothesisCount`.

**1. What it claims to produce.** Answers whether the case holds GEOINT records and how many of them are location hypotheses. Declares the GEOINT discipline for the 'geoint' pseudo-collector so the breakdown and correlation engine can map its records.

**2. Strengths it can honestly carry.** Presence and the count are DERIVED: deterministic counts over the case's own records, each of which carries an evidenceId. The records counted are HYPOTHESIS, and the count must never be shown as a count of locations found.

**3. Numbers, scores or labels not derived from cited evidence.** geointHypothesisCount, case-geoint.ts:171 `return geointEvidenceIn(evidence).filter((e) => e.claimClass === "HYPOTHESIS").length;`. The number is a real count of cited records, not invented, but it has five problems. (a) It filters on claim class, not record kind. It equals 'location hypotheses' only because geolocation-hypothesis.ts:167 is the one GEOINT producer that emits HYPOTHESIS (metadata.ts emits OBSERVED, image-match.ts emits DERIVED or REPORTED). (b) It undercounts when a revised hypothesis collides on its truncated id (geolocation-hypothesis.ts:147) and is dropped at merge (case-geoint.ts:187). (c) It counts a localStorage snapshot that a later case run overwrites wholesale (case-runs-panel.tsx:274), so it can silently fall to 0 and geointCaseScoped flips to false. (d) The consumer flattens absence to zero: case-intelligence-breakdown.ts:410 `? count(ctx.input.geointHypotheses ?? 0)` matches the numeric-zero-flattening line pattern. R0 did not attribute it, because it sits in the non-exported buildSection (line 324) and buildCaseIntelligenceBreakdown is binned PURE. (e) Ported into the platform now, it would return 0 for every case, because nothing produces GEOINT data: a measured zero hiding an unbuilt discipline. Disposition: do not ship in R1. The GEOINT section shows an em dash with 'Not built: no GEOINT collector is registered'. In R3, count HYPOTHESIS-strength claims citing evidence from GEOINT-discipline collectors in the case, return null (never `?? 0`) when no GEOINT collector exists, and label the figure as hypotheses. GEOINT_DISCIPLINE_ROW is a discipline label not taken from a registry entry → remove; it comes from collectors_registry.discipline.

**4. Auto-merging or auto-linking by name.** No.

**5. Person data.** Counts only. The underlying GEOINT records can be person-adjacent (see case-geoint-attach q5), so the R3 count must sit behind whatever gate the owner sets for GEOINT, and fail closed until then.

**6. LLM.** no

**7. Inputs we do not collect.** No GEOINT collector exists in packages/collectors: the registry has no GEOINT discipline entry, and a grep for geoint, exif or geolocation in packages/collectors/src returns nothing. → ships behind 'Not built: GEOINT, which needs a GEOINT collector (R3)'.

**Notes.** Consumers: case-intelligence-breakdown.tsx:282-283 and case-summary-panel.tsx:316-317 (both UI/DEAD), which feed buildCaseIntelligenceBreakdown (R0 PURE). isGeointEvidence is R0 UI/DEAD only because nothing outside its file imports it. Belongs in R1? No. The R1 breakdown should compute presence and claim counts by strength for every discipline from collectors_registry.discipline. GEOINT then gets a 'Not built' section in R1 and real values in R3, with no GEOINT-specific helper.


### Attach an image's GEOINT analysis (EXIF, image matches, location hypotheses) to a case (`case-geoint-attach`)

**Where it goes:** R3, and even there nothing is ported: GEOINT evidence is pinned like any other. **Exports (8):** `NOT_CASE_SCOPED`, `ATTACH_CAVEATS`, `AttachRefusal`, `AttachOutcome`, `MergeInput`, `MergeResult`, `mergeGeointIntoCase`, `attachGeointToCase`.

**1. What it claims to produce.** Merges the geointGraph projection of one analysed image into a case's snapshots: EXIF field observations, the EXIF GPS location (HAS_METADATA_LOCATION), reverse-image or perceptual matches (APPEARS_AT / MATCHED_TO), and visual geolocation hypotheses (HAS_LOCATION_HYPOTHESIS). The image itself is not stored.

**2. Strengths it can honestly carry.** The attach passes strengths through. EXIF fields are OBSERVED in legacy (metadata.ts:146 and others). Under our definitions they fit REPORTED better: the file states a camera, time or GPS position, the platform reads that statement, and EXIF is forgeable. The owner decides between REPORTED and OBSERVED. Perceptual-hash distances are DERIVED (image-match.ts:154). Analyst-entered matches are REPORTED (image-match.ts:240). Visual geolocation is always HYPOTHESIS (geolocation-hypothesis.ts:167) and must stay HYPOTHESIS whatever confidence the provider reports. Here HYPOTHESIS cannot be an evidence strength (RegistryEntry.claimStrength allows only OBSERVED, REPORTED or DERIVED), so a hypothesis must be a claim with strength HYPOTHESIS that cites the image evidence.

**3. Numbers, scores or labels not derived from cited evidence.** (1) case-geoint.ts:267 `investigationId: input.graph?.investigationId ?? "",` → null. (2) case-geoint.ts:268 `target: input.graph?.target ?? input.imageRef,` makes the image ref the case's investigation target when the case has no snapshot → remove. (3) case-geoint.ts:296 `? "Already attached to this case. Nothing changed — GEOINT ids are derived from the image and its findings, so re-attaching the same analysis does not duplicate it."`. The ids are only partly derived from the findings: geolocation-hypothesis.ts:147 `hypothesisId: `hypothesis:${input.provider}:${input.imageRef}:${candidate.slice(0, 48)}`,` ignores the point, reasoning and confidence. A revised hypothesis with the same 48-character candidate prefix is dropped by existing-wins (line 187), and the message claims it was the same analysis → remove. Use content-hashed evidence plus pin uniqueness. (4) Passed through unchanged: image-match.ts:146 `value: matchType === "EXACT_MATCH" ? 0.9 : matchType === "NEAR_MATCH" ? 0.65 : null,` is a fixed per-band number presented as a confidence → null confidence, keeping the measured Hamming distance as DERIVED. (5) Passed through: geoint/evidence.ts source labels come from the producer (line 159 `source: `EXIF · ${md.sourceFile}`,`, line 223 `source: `${m.provider} · ${m.matchType}`,`, line 315 `source: `${h.provider} · visual geolocation`,`), which breaks our source-labelling rule → the label comes from the registry entry.

**4. Auto-merging or auto-linking by name.** No people or organisations. The delegated geointGraph (geoint/evidence.ts) merges location entities by rounded coordinate (metadata.ts:238 `return `geoint:location:${point.lat.toFixed(5)},${point.lon.toFixed(5)}`;`), never by name. It keeps the observed and hypothesised edges separate and widens precision to the coarser of the two. The attach itself merges only on exact id.

**5. Person data.** Potentially. EXIF includes camera.serial (metadata.ts:94 `const CAMERA_FIELDS = ["make", "model", "lens", "serial"] as const;`), a device identifier that can be linked to a person, and the GPS fix of a photo can locate the photographer, for example at home. The legacy attach has no person gate. The owner must decide in R3 whether image GEOINT collectors are discipline GEOINT or PERSON-gated. Until that is decided, our fail-closed rule applies.

**6. LLM.** no (the attach path; visual geolocation comes from external providers or an analyst through geolocation-hypothesis.ts, not from an LLM here)

**7. Inputs we do not collect.** Every input is missing. No GEOINT collector exists: registry disciplines in packages/collectors/src/platform are only TECHINT, PERSON, SOCMINT and MEDIAINT. packages/media-forensics holds only package.json. No collector targets TARGET_TYPES 'FILE'. ENTITY_KINDS has no IMAGE kind (LOCATION exists). There is no image-upload path. → ships behind 'Not built: GEOINT image analysis (EXIF metadata, reverse-image match, visual geolocation); no GEOINT collector is registered'.

**Notes.** Delegates to geoint/evidence.ts geointGraph (R0 PURE; reclamation audit REWRITE), which pulls in metadata.ts, image-match.ts (matchesFromDuplicateReport and buildManualMatch PURE, the audit says DEFER until media forensics) and geolocation-hypothesis.ts (buildLocationHypothesis is R0 FABRICATION-FLAGGED: string-literal-as-measurement at line 150 `discoveredBy: input.discoveredBy ?? "MANUAL_ASSISTED",`). It shares the same graph-store and timeline-store localStorage dependencies (UI/DEAD) and the same run-overwrite defect as case-attach. Its consumer is the legacy /images route (src/routes/images.tsx:81). Belongs in R1? No. GEOINT is R3 in docs/MASTER-BUILD-SEQUENCE.md ('geoint (~1,300 lines, none today)'), and the attach mechanism is superseded by pins. In R3, GEOINT becomes registered collectors whose evidence and claims are pinned like any other, so nothing in this file is ported even then. Its one rule worth keeping (a hypothesis cannot be raised by attaching it) becomes an R3 test.


### Case report assembly from stored case data (no new collection) (`case-report-assembly`)

**Where it goes:** after R1 (D-15): a case report extends assembleReport from one run to a case's pins; buildCaseReport is not ported. **Exports (5):** `CaseReportProvenance`, `CaseReportBuildInput`, `CaseReportBuild`, `buildCaseReport`, `caseReportBlocker`.

**1. What it claims to produce.** A report's inputs built from one case's stored snapshot with no new collection: numbered citable sources from evidence and relationships, completeness, contradictions, cross-discipline correlations, media claims, provenance, and an adapter into the LLM product generator. Plus a refusal reason when a case cannot be reported.

**2. Strengths it can honestly carry.** Each source can honestly carry only its own evidence's recorded strength (our registry allows OBSERVED, REPORTED or DERIVED per collector, and today third-party records are REPORTED). Relationship sources with no evidence can carry no strength here; they must cite their claims' evidence. Legacy correlations are labelled CORRELATED, but here CORRELATED means a link drawn by the analysis model; a deterministic correlation computed by the platform would be DERIVED unless the owner redefines CORRELATED (D-2). Media claims are REPORTED (legacy OFFICIAL_STATEMENT also maps to REPORTED). Contradiction explanations are HYPOTHESIS.

**3. Numbers, scores or labels not derived from cited evidence.** legacy/src/utils/reports.ts:351 'publishedAt: e.collectedAt,' shows collection time as a publication date: remove it (ReportSource keeps collectedAt and observedAt separate). legacy/src/utils/reports.ts:350 'url: e.sourceUrl ?? "",' uses an empty string for a missing URL: use null. legacy/src/utils/reports.ts:349 'outlet: e.source,' takes the source label from a collector-supplied string: use the registry label. legacy/src/utils/reports.ts:352 'module: moduleForCollector(e.collector),' with legacy/src/utils/reports.ts:295 'return collector === "geoint" ? "Module 4 · imagery" : "Module 2 · content analysis";' puts a PS-18 module label on every non-geoint collector by default: remove (PS-18). legacy/src/utils/reports.ts:390 'publishedAt: "",' and legacy/src/utils/reports.ts:391 'module: "Module 2 · content analysis" as const,' on relationship sources: remove. legacy/src/utils/reports.ts:392 'credibility: r.confidence.value,' shows a relationship's confidence as source credibility: remove (no numeric score here). legacy/src/utils/cases/case-report-build.ts:101 'collector: s.outlet,': label from the record's own string; use the registry. legacy/src/utils/osint/entity-resolution.ts:119 'const corroboration = Math.min(0.5 + 0.15 * (sources.length - 1), 0.95);' puts a formula-made corroboration score on merged entities: remove, or null with reason.

**4. Auto-merging or auto-linking by name.** Not by name. The case path calls legacy/src/utils/osint/entity-resolution.ts resolveEntities, which never merges person or organization by value (legacy/src/utils/osint/entity-resolution.ts:91 'export const NOT_MERGEABLE_BY_VALUE: ReadonlySet<EntityType> = new Set(["person", "organization"]);'). It does merge every other entity type automatically on normalized value, usernames included (legacy/src/utils/osint/entity-resolution.ts:213 'const key = `${entity.type}:${normalizeEntityValue(entity.type, entity.value)}`;'), so one handle on two platforms becomes one entity. That links accounts with no analyst decision. Here, automatic merges are recorded RULE decisions in entity_merges; a name-only automerge of PERSON or ORGANIZATION is refused by the database; USERNAME is an allowed signal. Whether a cross-platform username match may automerge is an owner decision.

**5. Person data.** Yes. Sources include every evidence item in the case: usernames, social accounts, emails and phone numbers from SOCMINT or person collectors. Media claims carry attributedTo (named people). Here a case with evidence from a PERSON-discipline collector is person data, so a case report read must go through requirePersonAccess or personLockFor and is refused whole (403 MODULE_NOT_IN_PLAN or VETTING_NOT_APPROVED), never thinned (standing rule 6).

**6. LLM.** buildCaseReport itself: no. toGenerateInput feeds the legacy generateProduct (a large LLM task). Here the equivalent is synthesis.ts over untrusted records with citation validation, capped at MAX_SYNTHESIS_SOURCES = 40. A case-level synthesis is a large task.

**7. Inputs we do not collect.** Contradiction detection: no engine here, so it ships behind 'Not built: contradiction detection'. Cross-intelligence correlation: not built, so 'Not built: cross-intelligence correlation'. Media claim extraction: not built (wayback is registered and news is held; no claim extractor exists), so 'Not built: media claim extraction'. The capability matrix input exists (registry discipline). The case-to-runs link exists through pins and evidence.jobId.

**Notes.** R0: buildCaseReport PURE, caseReportBlocker PURE. Delegated legacy/src/utils/reports.ts: renumber PURE (lines 403-405, a pure renumber from 1); sourcesFromCaseEvidence PURE by R0 but carries the q3 defects; sourcesFromOsintRelationships PURE by R0 but carries the q3 defects; moduleForCollector UI/DEAD (same-file artefact, PS-18); generateProduct UI/DEAD; generateIntelligenceProduct IO-BOUND; GenerateInput is a type with optional case fields carried straight through. Other legacy dependencies (other readers' files): case-claims caseMediaClaims PURE, isConflicted FABRICATION-FLAGGED (case-claims.ts:151, a nullish-zero map-miss); case-contradictions buildCaseContradictions PURE; case-entities resolvedCaseEntities PURE; cross-intelligence buildCrossIntelligence PURE; case-runs RunStatus (type). The legacy caller (routes/reports.tsx lines 394-396) passes investigationId and collectedAt with an empty-string nullish fallback, which is outside these files. What exists here: assembleReport already does everything except the case scope: sources numbered by first citation with registry labels, evidence id, content hash, separate collectedAt and observedAt, relationships cited through their claims' evidence, attributions, untrusted-content warnings, omittedClaims, snapshotted wording. A case report is assembleReport generalised from one run's jobs' evidence to the evidence behind a case's pins, plus the case-only sections once their engines exist. INVENTORY.md said KEEP (pure, untested), and LEGACY-RECLAMATION-AUDIT says REWRITE and reconcile with Phase 5. This review sides with reconcile: the code is not ported, and assemble.ts is extended instead. No legacy tests exist for case-report, case-report-build or case-intelligence-breakdown (legacy/tests has only reports.test.ts, which covers renumber and sourcesFromOsintRelationships).

## Dropped, or waiting on an owner decision

### Confidence of the evidence a finding cites (`cited-evidence-confidence`)

**Where it goes:** NEEDS-DECISION D-7 (recommended: drop). **Exports (3):** `EvidenceConfidenceSummary`, `GroundedFindingWithEvidence`, `evidenceConfidenceFor`.

**1. What it claims to produce.** For each accepted finding, a code-computed band (HIGH/MEDIUM/LOW/HYPOTHESIS, or null when unmeasured) from the weakest measured cited record, with min and max measured confidence and counts of unmeasured and cited records, kept apart from the model's claim class.

**2. Strengths it can honestly carry.** The min, max and counts are computed by code from recorded values, so DERIVED, and only if the underlying scores were measured by the collectors. The HIGH/MEDIUM/LOW band is a policy mapping of those scores, not a measurement. Its HYPOTHESIS band name collides with our HYPOTHESIS strength.

**3. Numbers, scores or labels not derived from cited evidence.** legacy/src/utils/cases/case-analysis.ts:144 "band: confidenceBandOf({ value: min, reasons: [] }, finding.claimClass)," computes a band from measured records only even when unmeasured > 0, which can overstate the weakest link -> null whenever any cited record is unmeasured. legacy/src/utils/collectors/result.ts:121 "export const CONFIDENCE_BAND_THRESHOLDS = { high: 0.8, medium: 0.5 } as const;" is policy, as its own comment says -> owner decision. Refs that resolve only to a claim or contradiction are silently not counted (line 120 searches ctx.evidence only) -> count unresolved refs explicitly.

**4. Auto-merging or auto-linking by name.** No.

**5. Person data.** Only indirectly: it reads the confidence of whichever records are cited, person records included.

**6. LLM.** No.

**7. Inputs we do not collect.** Per-evidence collector confidence: packages/db/src/schema/evidence.ts has no confidence column and no collector writes one (only entity_merges.confidence exists). Every band would be null, so this ships behind Not built naming 'per-evidence collector confidence'.

**Notes.** NEEDS-DECISION for the owner: (1) does evidence gain a measured per-record confidence (additive column plus collector SDK field)? (2) do HIGH/MEDIUM/LOW bands at 0.8/0.5 enter our vocabulary, and under what name, given HYPOTHESIS is already a strength? Delegates to legacy confidenceBandOf (collectors/result.ts:138, PURE), which honestly returns null for an unmeasured score. If yes, port as REWRITE per the q3 dispositions.


### Browser snapshot eviction, eviction ledger and quota report (`storage-quota-eviction`)

**Where it goes:** browser storage; two rows wait on D-8 (retention tombstones). **Exports (18):** `MAX_SCOPED_CASES`, `listScopedCases`, `evictOldScopedCases`, `approximateBytes`, `StorageReport`, `ASSUMED_QUOTA_BYTES`, `storageReport`, `EvictionRecord`, `EVICTION_KEY`, `MAX_EVICTION_HISTORY`, `getEvictions`, `recordEvictions`, `clearEviction`, `evictionFor`, `evictedCaseIds`, `CaseSnapshotState`, `caseSnapshotState`, `EVICTED_MESSAGE`.

**1. What it claims to produce.** Keeps the five newest per-case snapshots, records each real eviction so 'evicted' is a recorded fact rather than an inference from absence, and reports localStorage usage as a percentage of a quota.

**2. Strengths it can honestly carry.** Eviction rows are facts about the app's own actions, not claims about a target. The byte counts are DERIVED. percentOfQuota rests on an assumed quota, so it cannot honestly be presented as measured at any strength.

**3. Numbers, scores or labels not derived from cited evidence.** case-scope.ts:274 `return { totalBytes: 0, byKey, scopedCases: 0, percentOfQuota: 0 };`: zeros returned where nothing was measured (no window). case-scope.ts:285 `// Storage unreadable (private mode). Report zero rather than throwing.`: unreadable storage reported as 0 bytes. case-scope.ts:294 `percentOfQuota: Math.round((totalBytes / ASSUMED_QUOTA_BYTES) * 1000) / 10,` against case-scope.ts:268 `export const ASSUMED_QUOTA_BYTES = 5 * 1024 * 1024;`: a percentage of an assumed quota. case-scope.ts:256 `return String(typeof value === "string" ? value : JSON.stringify(value)).length * 2;`: an estimate reported as bytes. Disposition: dropped (browser-only). If ever ported, use null when unmeasured. A gate hit on a comment: case-scope.ts:382 (timestamp-invention).

**4. Auto-merging or auto-linking by name.** No.

**5. Person data.** No.

**6. LLM.** No.

**7. Inputs we do not collect.** Nothing server-side is evicted. The analogue, retention purge, is not built: tenants.retention_days is recorded only, and settings answer enforced: false.

**Notes.** Still worth keeping, pending a decision: the rule that a missing record must say why ('removed', with when, versus 'never existed'), and that absence alone is never read as removal. It would apply when retention enforcement is built (packages/db/src/schema/tenancy.ts:41 'Recorded only: nothing deletes on expiry yet'; apps/api/src/routes/settings.ts:14, :32). The owner must decide whether a purge leaves a tombstone, given CLAUDE.md §9's genuine-deletion rule. The append-only audit log might serve as the record of purges instead of a tombstone table, which is also the owner's call.


### Case-to-run edge store and run input classification (`case-run-link`)

**Where it goes:** browser storage; the server-side question is D-4. **Exports (14):** `RUN_INPUT_TYPES`, `RunInputType`, `CaseRun`, `CASE_RUNS_CHANGED_EVENT`, `getCaseRuns`, `saveCaseRuns`, `classifyRunInput`, `CreateRunInput`, `createCaseRun`, `runsForCase`, `attachOsintRun`, `setRunStatus`, `deleteCaseRun`, `deleteRunsForCase`.

**1. What it claims to produce.** A localStorage record linking a case to an OSINT run id, the input's type (PERSON / DOMAIN / INFRASTRUCTURE / EMAIL / PHONE / IMAGE), and a run status.

**2. Strengths it can honestly carry.** A classification by input shape is DERIVED. The residual PERSON label for empty or unmatched input is not derived from anything, so it is HYPOTHESIS at most. A status set through attachOsintRun or setRunStatus is whatever the caller asserted and is not derived from jobs.

**3. Numbers, scores or labels not derived from cited evidence.** case-runs.ts:279 `if (!v) return "PERSON";` and case-runs.ts:285 `return "PERSON";`: empty or unmatched input is labelled PERSON. Disposition: superseded. detectTargetType throws EmptyTargetError and has no PERSON type. case-runs.ts:280 `if (/^(\d{1,3}\.){3}\d{1,3}$/.test(v)) return "INFRASTRUCTURE";` accepts octets above 255; ours checks the range (packages/core/src/target-detection.ts:49-52). case-runs.ts:327-355: attachOsintRun and setRunStatus write a status the caller supplies, with no job evidence. Disposition: superseded, since ours derives status with runStatusOf.

**4. Auto-merging or auto-linking by name.** No.

**5. Person data.** Yes. PERSON is a run input type, so runs could target people. Ours has no PERSON target type, and person collectors are admitted only through plan and vetting entitlement in the planner (packages/osint-engine/src/planner.ts runtime.admit).

**6. LLM.** No.

**7. Inputs we do not collect.** None. Fully superseded.

**Notes.** Superseded by runs and investigations (packages/db/src/schema/work.ts) and by POST/GET /api/v1/investigations/:id/runs (apps/api/src/routes/runs.ts). Runs belong to investigations, and a case's contributing runs are DERIVED through case_pins -> evidence.job_id -> jobs.run_id, so no edge table is needed. R0 bins runsForCase, attachOsintRun, setRunStatus, deleteCaseRun and deleteRunsForCase as PURE, but each reads or writes localStorage through getCaseRuns/saveCaseRuns. Delegates to legacy local-id.ts (crypto.randomUUID, else Date.now plus a counter; no fabrication) and investigations-store.ts.


### Case snapshot selector for /graph and /timeline (`snapshot-selector`)

**Where it goes:** browser snapshot UI. **Exports (9):** `UNSCOPED_SELECTION`, `SnapshotScope`, `SnapshotDisplay`, `noSnapshotMessage`, `noUnscopedMessage`, `resolveSnapshotSelection`, `CaseSnapshotOption`, `optionSuffix`, `buildSnapshotOptions`.

**1. What it claims to produce.** What the selector shows: a case's own snapshot only on MATCH, otherwise the reason (evicted or no snapshot); the latest-run slot with a note when it belongs to a case; an option list that never hides cases with no data.

**2. Strengths it can honestly carry.** None. UI selection logic and copy.

**3. Numbers, scores or labels not derived from cited evidence.** None found.

**4. Auto-merging or auto-linking by name.** No.

**5. Person data.** No.

**6. LLM.** No.

**7. Inputs we do not collect.** None.

**Notes.** docs/audit/INVENTORY.md rates this KEEP ('Pure'), but our architecture leaves nothing to select between: there is no unscoped slot, and web queries are keyed by scope kind and id (apps/web/src/workspace/queries.ts:111, :125). The rule 'list cases with no data, don't hide them' already holds in GET /api/v1/cases. Depends on case-scope (caseSnapshotState, EVICTED_MESSAGE).


### Case deletion cascade across browser stores (`case-delete-cascade`)

**Where it goes:** browser storage; cases are archived here, never deleted. **Exports (4):** `GRAPH_BASE_KEY`, `TIMELINE_BASE_KEY`, `CaseDeletionReport`, `deleteCaseCascade`.

**1. What it claims to produce.** Deleting a case also removes its snapshots, any unscoped mirrors carrying its id, its eviction rows and its runs, and unlinks (never deletes) vault exhibits, so a reused case id cannot resurrect another case's data. Returns a report of what was cleared.

**2. Strengths it can honestly carry.** None. An operation report, not a claim about a target. Its booleans are asserted, not observed.

**3. Numbers, scores or labels not derived from cited evidence.** case-delete.ts:100 `report.clearedScopedGraph = true;`, :101 `report.clearedScopedTimeline = true;`, :119 `report.runsDeleted = true;` and :130 `report.evidenceUnlinked = linked.length;` are all set after delegated calls that swallow storage errors (graph-store.ts:250-252, timeline-store.ts:164-166, case-runs.ts:262-265, evidence-store.ts:124-126). Disposition: report the rows actually deleted (DELETE ... RETURNING), and null when unknown.

**4. Auto-merging or auto-linking by name.** No.

**5. Person data.** Yes, indirectly. It deletes case content and keeps vault exhibits (which may concern people) by unlinking them.

**6. LLM.** No.

**7. Inputs we do not collect.** No case deletion endpoint exists (cases are archive-only: 'Archiving is one-way here' in apps/api/src/routes/cases.ts), and no tenant deletion path exists. All foreign keys are ON DELETE no action (packages/db/migrations/0001_tables.sql, e.g. case_pins_case_fk).

**Notes.** The defect it closes, an id reused through max+1 (legacy/src/utils/investigations-store.ts:133), is structurally impossible here: ids are uuid defaultRandom (packages/db/src/schema/columns.ts:7). Two ideas are worth keeping for when case deletion is built. (1) Deleting a case removes its case_pins and never the pinned evidence, entities, claims or relationships, which belong to runs; this matches unpin's 'Removes the pin only. The pinned record itself is untouched.' (2) Delete in one transaction and report counts from the rows actually deleted. Tenant deletion is different: CLAUDE.md §9 requires removing everything, including content-store payloads, which are namespaced per tenant (packages/db/src/content-store.ts:57-59). R0 bins deleteCaseCascade as PURE, but every step is localStorage I/O through the delegated stores. Delegated legacy modules: investigations-store.ts, graph-store.ts, timeline-store.ts and evidence-store.ts, all localStorage. In R0 they are browser-bound (UI/DEAD) or binned by their own calls, and docs/audit/INVENTORY.md rates them ADAPT as per-browser stores.


### Sample-watchlist labelling and no-case blocker (`sample-watchlist-separation`)

**Where it goes:** demo data labelling. **Exports (4):** `SAMPLE_EXCLUDED_NOTE`, `SAMPLE_WATCHLIST_PREFIX`, `sampleDerivedEntities`, `NO_CASE_SELECTED`.

**1. What it claims to produce.** Labels entity names that came from seeded [SAMPLE] watchlists so the /agents picker can mark them, states that sample data never reaches a grounded answer, and supplies the 'no case selected' blocker sentence.

**2. Strengths it can honestly carry.** None: UI labels and copy, not claims.

**3. Numbers, scores or labels not derived from cited evidence.** None found.

**4. Auto-merging or auto-linking by name.** No.

**5. Person data.** Seeded demo names only: the comment at case-context.ts:182 lists them ("`filters.people` / `filters.organizations` ("Chen", "Ortega", "Vector-17"," ...). No real person data.

**6. LLM.** No.

**7. Inputs we do not collect.** None: the platform has no watchlists or seeded sample data.

**Notes.** All DROP. Source data lives in localStorage (legacy/src/utils/watchlist-store.ts:145-148); only consumer is legacy/src/routes/agents.tsx (lines 224, 302).

