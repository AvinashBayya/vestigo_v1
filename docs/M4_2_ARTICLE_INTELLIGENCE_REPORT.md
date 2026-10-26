# M4-2 — grounded article-text intelligence

Date: 2026-10-22. Branch `milestone/vestigo-days-1-3-osint-addendum`; **nothing committed, pushed, reset, or cleaned**. No live publisher request, no source-verdict change, no third-party extraction service, no LLM, no new paid dependency, no security gate weakened. Everything added is deterministic, offline-tested, and evidence-grounded.

## Outcome

The M3 gap — "article text is extracted then discarded" — is closed, and article content now produces **persisted, evidence-linked intelligence that reaches the real analysis pipeline**:

- The article collector now **retains** the extracted body text (bounded) in its stored result, instead of throwing it away.
- It **deterministically extracts the unambiguous identifiers the text states** (explicit URLs and email addresses) with exact character spans — and nothing it cannot ground (no guessed people, organisations, places, bare domains or dates).
- Fusion turns those mentions into **entities and `mentions` relationships** in the real evidence graph, resolved by identifier through the existing write path.
- The article's own metadata claims already reach M4-1 contradiction detection; this is now proven end to end (two fetches of one URL whose titles disagree surface a contradiction), and the mentions are deliberately modelled as relationships so they can never be mistaken for one.

Nothing is isolated: the body text is retained in the tenant-scoped job result and the raw bytes; the structured mentions flow through fusion into the persisted graph; and article claims reach the stored contradiction analysis.

## Where article content is stored, and how access is controlled

Two existing, tenant-scoped, secure stores — no new storage, no migration:

1. **The raw bytes** are the evidence: content-hashed into the content store under `tenants/<tenantId>/sha256/…`, re-hashed on every read, served only as an `application/octet-stream` attachment (CLAUDE.md §9). Unchanged by M4-2.
2. **The extracted, decoded body text** and the structured mentions are stored in the collector's **result** (`jobs.result`, jsonb), under the result's `derived` block — so they are a parse the platform computed, never presented as a verbatim quote of the publisher. The job row is tenant-scoped under Postgres RLS, like all tenant data. The body text is **bounded to 100,000 characters** (a flag records truncation; the whole page remains in the content-hashed bytes), and the mention list is **bounded to 100** (a hostile link-dump cannot flood the graph).

Access control is the existing model: the result is read only inside a tenant transaction; the evidence API is permission-gated (`evidence:read`), person-gated, and tenant-scoped. No per-claim or per-document duplication of the full text: it lives once in the result (plus the raw bytes), never copied into each claim or into the case-analysis document.

## Deterministic extraction implemented

All in the pure, offline, dependency-free extractor (`packages/collectors/src/platform/article-extract.ts`), reused by the collector — no parallel data model:

- **Body text retention** — `extractArticle` already produced the readable text; the collector now keeps it (`derived.bodyText`, bounded; `derived.bodyTextTruncated`). `""` for a metadata-only page.
- **`extractMentions(text)`** — finds only **explicit `http(s)://` URLs and email addresses**, each with its exact `{start, end}` span in the retained text. It is deterministic and high-precision: it trims trailing sentence punctuation, validates URLs with `URL.canParse`, skips an email-looking substring inside a URL, deduplicates by value (first span kept), is bounded, and reads the untrusted text as data only — nothing it finds is fetched or acted on.
- **Deliberately NOT extracted** (ambiguity preserved as absence, never invented): people, organisations and places by name; bare domains; version strings; and dates/events from prose. The one grounded date — the stated publication time — is already captured (`derived.publishedAt`, and the evidence's `observedAt`). Extracting those reliably is the LLM increment, not forced deterministically here.

## Evidence-span and provenance design

- Each mention is `{ kind: "URL" | "EMAIL_ADDRESS", value, start, end }`, where `start`/`end` index the **stored** `bodyText` (mentions are computed from the same bounded text that is stored, so a span always resolves — the tests assert `bodyText.slice(start, end) === value`).
- Fusion (`article` extractor) creates an entity per mention via the **existing identifier resolution** (`URL` → URL entity, `EMAIL_ADDRESS` → EMAIL_ADDRESS entity; a `null` normalisation is dropped, never a junk entity) and a `mentions` **relationship** from the article's URL entity, carrying the one evidence citation (the article response). Provenance is therefore: mention entity ←`mentions`— article URL entity → cites the article evidence → whose bytes are content-hashed → whose `derived.mentions[i]` holds the exact span.
- Every extracted item is distinguished by construction: the raw `<title>` stays the single **REPORTED** value; everything `extractArticle`/`extractMentions` produced is **DERIVED** (under `derived`); no analyst/LLM interpretation exists in this milestone. Article intelligence uses the `article_*` attribute namespace and the direct-article source, never GDELT's `news_*` — they stay distinct on a shared URL entity.

## How extracted claims reach contradiction analysis

- Article **metadata claims** (`article_title`, `article_published_at`, …) are entity claims on the article's URL entity. Since M4-1, the case-analysis input carries each claim's attribute and value, so these are compared by `caseContradictions`. Proven end to end: a case with two article fetches of one URL whose `article_title` differs surfaces a contradiction on `(url, article_title)`, with both titles and their evidence kept and neither resolved.
- **Mentions are relationships, not entity claims.** `caseContradictions` considers entity claims only, so a URL or email mentioned by several articles stays **corroboration** in the graph (one resolved entity, several `mentions` edges) and is never read as a contradiction — avoiding the trap where differing spans or sources would look like a factual conflict.
- Analysis **versioning and stale behaviour** follow the existing contract unchanged (M4-1's `ENGINE_VERSION` 8; the case-analysis input hash already covers claim attributes and values; no new bump is needed because fusion feeds the same claim/entity tables).
- **Failure and partial extraction are truthful**: a page fetched but unreadable as an article is reported not found; `METADATA_ONLY` keeps `bodyText: ""` with no mentions; `extractionStatus` records which; a failed or refused retrieval writes no evidence (M2).

## Tests and outcomes (exact commands)

| Command | Result |
|---|---|
| `pnpm --filter @repo/collectors exec vitest run test/platform/article-extract.test.ts test/platform/article.test.ts` | **25 passed** (`extractMentions` precision/bounds/spans; collector retains text + mentions + spans; metadata-only; existing fail-closed semantics) |
| `pnpm --filter @repo/collectors test` | **26 files, 631 passed** (fixtures provenance incl. the two new synthetic fixtures; no regression) |
| `pnpm --filter @repo/osint-engine exec vitest run test/units.test.ts` | **57 passed** (fusion draws mention entities + `mentions` edges; no person/org from prose) |
| `pnpm --filter @repo/osint-engine exec vitest run test/case-analysis-job.test.ts` | **20 passed** (incl. two article fetches of one URL → a persisted `article_title` contradiction) |
| `pnpm --filter @repo/osint-engine exec vitest run test/pipeline.test.ts -t "exact-article"` | **9 passed** (incl. the DB-backed mentions-graph test: mentioned URL + email entities and `mentions` edges persisted) |
| `pnpm --filter @repo/osint-engine test` | **13 files, 211 passed** (full suite) |
| builds + lint + prettier (`@repo/collectors`, `@repo/osint-engine`) | typecheck exit 0; ESLint clean; prettier clean |

Deterministic offline tests cover, per the plan: a full-text fixture through extraction and canonical persistence; empty, metadata-only, malformed and failed extraction (the extractor and collector tests); exact source-span and provenance links for mentions; entity/event extraction without invented data (bare domains, names, versions and dates are not mentions); article text kept distinct from GDELT metadata; cross-source article claims reaching contradiction analysis; duplicate submission/idempotency and tenant isolation (M2 pipeline tests, re-run green); and prompt-injection safety (the text is read as data, never instructions, and nothing extracted is fetched or acted on). Real Postgres + Redis are provided by the suite's own Docker Compose infrastructure.

## Known limitations

- **Deterministic prose yields only unambiguous identifiers.** Article body prose often states no bare email or explicit URL (links are usually hyperlinks, outside the extracted paragraph text), so `mentions` is frequently empty — which is honest, not a bug (ambiguity is preserved, nothing invented). High-yield, attribute-value claims and named entities/events *from prose* are not deterministically reliable and are deliberately **not** attempted here.
- **The retained body text is not yet surfaced in the UI**, and is not itself an entity claim (it does not contradict). It is retained for retrieval and for the next increment to consume.
- **Spans are retained in the result, not as a queryable claim field.** The `mentions` relationships carry the evidence citation; the exact spans live in `derived.mentions` (reachable via the claim path), not as a separate indexed column — sufficient for provenance, not yet for span-level search.

## Next recommended increment

**M4-4 — optional, LLM-assisted grounded extraction from the retained body text**, using the existing hardened path (open-weight allowlist, delimited untrusted data, schema + citation validation, retry-once-then-fail, prompt-injection guards). It would consume `derived.bodyText` to produce attribute-value claims and person/organisation/place/event candidates, each cited to the article evidence and marked INFERRED/HYPOTHESIS, degrading to a no-op when the LLM is unavailable (the default). The deterministic foundation this milestone lays — retained text, grounded identifier mentions, and the contradiction path — is the input that increment reads.

## Conclusion

**Yes — article text now produces persisted, evidence-linked intelligence through the actual pipeline, not an isolated artefact.** The collector retains the bounded body text and the unambiguous identifier mentions (with exact spans) in its tenant-scoped result; fusion persists the mentioned identifiers as entities and `mentions` relationships in the real evidence graph via the existing write path; and the article's own metadata claims reach M4-1 contradiction detection, proven by a persisted cross-fetch contradiction. Everything is deterministic, grounded, bounded, and fail-closed: nothing is invented, ambiguity is preserved as absence, mentions cannot masquerade as contradictions, and no part remains unconnected — with the richer prose-to-claim extraction left, honestly, to a later LLM-assisted increment rather than forced deterministically.
