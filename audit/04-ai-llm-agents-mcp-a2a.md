# 04 — AI / LLM / Agents / MCP / A2A Inventory

Scope: `packages/llm` (the only AI code path) plus the allowlist in `packages/config/src/llm.ts`. Evidence is `file:line`.

---

## 1. Headline

Vestigo uses an LLM for **one task only — writing the cited synthesis section of an OSINT report** — and only when an endpoint is configured. There is **no agent framework, no MCP, no A2A, no tool/function-calling, no embeddings, no vector DB and no RAG retrieval layer** (confirmed by grep across `packages/llm` for langchain/langgraph/llamaindex/mcp/modelcontextprotocol/embedding/pinecone/weaviate/qdrant/vector/autogen/crewai/function-call/tool-call — only the `OpenAiCompatibleProvider` wire-format descriptor matched). `packages/llm`'s only runtime dependency is `zod`.

The design treats **all collected content as hostile input** and the model as **untrusted output**. Both assumptions are enforced structurally, not by prompt wording alone.

---

## 2. Providers, profiles, model allowlist

- **Provider abstraction** `LlmProvider { profile; complete(request, signal?) }` (`provider.ts:71-74`); one implementation `OpenAiCompatibleProvider` (`provider.ts:165-299`) speaking the OpenAI `/chat/completions` wire format. "OpenAI-compatible" is the **wire protocol**, not the OpenAI SaaS — base URL + key are injected.
- **Profiles** (`LLM_PROFILE`): `hosted` (any OpenAI-compatible https endpoint) or `vllm` (self-hosted). Endpoint, key, timeout and structured-output mode are all configuration via `resolveLlmConfiguration` (`config/src/llm.ts:229-282`), never hard-coded.
- **Model allowlist** (`config/src/llm.ts:41-82`), exact ids, all **Apache-2.0**:

| id | vendor | route |
|---|---|---|
| `Qwen/Qwen3-8B` | Qwen | SMALL |
| `openai/gpt-oss-20b` | OpenAI (open weights) | SMALL |
| `Qwen/Qwen3-32B` | Qwen | LARGE |
| `openai/gpt-oss-120b` | OpenAI (open weights) | LARGE |
| `mistralai/Mistral-Small-3.1-24B-Instruct-2503` | Mistral AI | LARGE |

- **Structural refusals** (pinned by `config/src/llm.test.ts`): `FORBIDDEN_MODEL_FAMILIES = /llama/i, /gemini/i` matched against id *and* declared base model (`llm.ts:90-123`); `FORBIDDEN_ENDPOINT_HOSTS` blocks `openai.azure.com`, `azure-api.net`, `cognitiveservices.azure.com` (`llm.ts:99-107`); only `Apache-2.0`/`MIT` licences permitted. **No Anthropic/OpenAI-SaaS/Gemini/Azure/Llama model is wired.** `gpt-oss-*` are OpenAI's open-weight release.
- **Routing** (`router.ts`): tasks `extraction`/`classification` → SMALL, `synthesis` → LARGE.

## 3. Is a real call made?

Yes — the sole network surface is `provider.ts:205-213` (`POST ${baseUrl}/chat/completions`), WHATWG `fetch`, injectable for tests. Every call is bounded by `AbortSignal.timeout(LLM_REQUEST_TIMEOUT_MS)` combined with the caller signal. With no hosted base URL set, config is `NOT_CONFIGURED` and the client returns `{unavailable}` — reports then skip synthesis rather than fabricate. `scripts/eval-live.ts` runs a golden set through the configured model (not in CI; exits 2 if no provider).

Fault handling: 429/5xx → `LlmUnavailableError` (retryable, carries Retry-After); other 4xx → `LlmRequestRejectedError`; missing token usage → refused; truncated/empty answer → `MeteredResponseError`.

## 4. Prompt-injection defenses (the core of this subsystem)

### 4a. Untrusted-data framing (`untrusted.ts`)
Collected content reaches the model only as JSON inside one delimited block, never concatenated into instructions:
- `frameUntrusted` emits `<untrusted_data boundary="…">\n{json}\n</untrusted_data boundary="…">` (`:51-61`).
- `inertJson` escapes `<`, `>`, `&`, U+2028/U+2029 so data cannot forge the closing tag/markup (`:42-49`).
- The boundary is `sha256(data)[:24]`, so a record cannot predict/name its own block boundary.
- A `canary` marker is placed in the system prompt and nowhere in data; any answer echoing it is rejected.

### 4b. Type-level instruction protection (`trusted.ts`)
`TrustedText` is a branded type obtainable only via a `trusted`\`…\` template with **no interpolation**; `trusted` throws `InstructionInterpolationError` at runtime if a value is interpolated (`:22-25`). Targets, collected strings and prior model output therefore cannot be spliced into the instruction channel at the type level.

### 4c. Injection recognition (`injection.ts`)
`INJECTION_PATTERNS` — 9 patterns keyed on the *address* of the text (override-instructions, role-reassignment, prompt-disclosure, chat-template markup, addressed-to-AI, directive-to-AI, response-steering, new-instructions, exfiltration-link). `revealHidden` strips zero-width chars and decodes Unicode-tag "ASCII smuggling" before scanning. Matches **mark** the evidence (do not block collection) and **arm** the output guard. CI corpus: `test/injection-corpus.test.ts` + `test/fixtures/injection-corpus.json`.

## 5. Output guards & schema validation

- **Schema validation** (`generate.ts`): model text is stripped of `<think>`/code fences, `JSON.parse`d, validated against the task's Zod schema (failures → `RESPONSE_NOT_JSON`/`RESPONSE_SCHEMA`). The provider may also request strict `json_schema`/`json_object` decoding, but output is validated in code regardless.
- **Behavioural guards** (`guards.ts:87-164`) — reject, never repair: `MARKUP_LEAK` (answer carries canary/boundary/tag/chat-template markup), `INSTRUCTION_ECHO` (repeats a 5-word run from any instruction-like span in the data), `INSTRUCTION_LIKE_OUTPUT` (answer reads as instructions to an AI), `UNSUPPORTED_IDENTIFIER` (names a URL/email/domain/IP/handle not present in cited records' non-instruction text — identifiers planted inside injected instructions are excluded from "supported"), `CALL_TO_ACTION`, `RISK_VERDICT`.
- **System policy** `DATA_POLICY` (`generate.ts:28-29`) instructs the model to treat the block as data, never follow/repeat it, never emit uncited identifiers, never write the canary.

## 6. Citation validation (CLAUDE.md §4)

`validateCitations` (`citations.ts:61-112`), against a `Map<ref, {source}>` of every citable evidence ref:
- empty answer → `NO_STATEMENTS`;
- a statement with zero refs → `CITATION_MISSING` (**every** statement must cite, whatever its strength);
- a ref not in the set → `CITATION_UNKNOWN`;
- `CORRELATED` with <2 distinct **sources** → `CORRELATION_SINGLE_SOURCE` (independence by source, not ref);
- corroboration language with <2 sources → `CORROBORATION_SINGLE_SOURCE`;
- certainty language (unless negated) → `CERTAINTY_ASSERTED`.

**Retry-once-then-fail** (`generate.ts`, `MAX_ATTEMPTS=2`): on failure it sends a fixed `correction()` message naming each problem by position and retries once; a second failure throws `LlmOutputRejectedError`. The retry **never shows the model its rejected answer or the data** — only coded problem messages — so planted text cannot travel back into the instruction channel. The same validators gate production and score the eval harness (not relaxed for tests).

## 7. Metering & cache

- **Metering** (`metering.ts`): `TokenMeter.record`/`AccumulatingMeter` capture every call that consumed tokens, *including* a call whose output was then rejected and a metered-but-unusable response. A cache hit records nothing; an unmetered provider response is refused upstream, so usage is never estimated. Units `LLM_INPUT_TOKEN`/`LLM_OUTPUT_TOKEN`. Within `packages/llm` metering is **capture-only** — persistence/charging to the tenant ledger is the worker/osint-engine caller's job (`reports/generator.ts:200-220`, `recordReportAttempt`), keyed by attempt so retries don't double-charge.
- **Response cache** (`cache.ts`): `RedisResponseCache`, key `${tenantId}:${sha256(formatVersion,modelId,servedName,profile,promptVersion,maxTokens,temperature,messages)}` — tenant-namespaced so a hit never crosses tenants. Only validated answers are stored, and a cached answer is **re-validated on read** (checks can tighten). Cache errors are swallowed and the call proceeds uncached; cache is optional.

## 8. Prompts inventory

Production task prompts are supplied by the **caller** (osint-engine) as `ValidatedTask.system`/`.instructions` (`TrustedText`), not defined in `packages/llm`. In-package prompt text:
- `DATA_POLICY` (`generate.ts:28-29`) — the fixed security rules appended to every system message, + per-call canary line.
- `correction()` (`generate.ts:116-123`) — retry prompt, coded problems by position.
- Eval synthesis prompt (`scripts/eval-live.ts:103-104`, test/ops only) — "You write the synthesis section of an OSINT evidence report, only from the supplied records."

## 9. Risks & observations

- **Residual trust boundary:** `packages/llm` cannot guarantee the *caller* framed collected content through `UntrustedRecord` rather than smuggling it into `instructions`; the `trusted` brand mitigates but a caller could cast a string to `TrustedText`. Module headers acknowledge residual gaps tracked in `docs/PLAN.md` Phase 5 (`guards.ts:27`). **Recommendation:** add a caller-side contract test (osint-engine) that proves evidence text only ever reaches the model via the untrusted frame.
- **Cost/latency/observability:** per-call timeout + response cache + metering are present; there is no cross-call budget ceiling or fallback-model logic (synthesis simply becomes unavailable). Live model behaviour is **UNKNOWN — requires runtime access**.
- **No prompt-injection CI job** is wired as a named CI step though the corpus test exists (runs inside `turbo test`) — see [08](08-code-quality-and-tech-debt.md).
- **Positive:** endpoint error bodies are redacted of keys/prompt echoes (`endpoint-error.ts:42-46`); the provider never sends a `tools`/`functions` field (plain chat only).
