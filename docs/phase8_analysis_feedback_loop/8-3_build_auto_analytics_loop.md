# Phase 8-3: Autonomous Analytics Loop (Revised)

> **Date:** 2026-03-09
> **Status:** Planning
> **Scope:** LLM performance analysis, canonical report persistence, RAG feedback, durable background worker, desktop report viewing
> **Depends on:** Phase 8-1 (performance scoring), Phase 8-2 (auto-collection, in progress)

---

## 0. Revision Notes

This revision corrects the main issues in the prior draft:

1. **`analysis_reports` becomes the canonical store** for full markdown reports.
   Optional filesystem export is a secondary artifact, not the source of truth.
2. **Historical learning is preserved.**
   The DB keeps the full report history, and RAG keeps the latest N reports instead of replacing all prior chunks.
3. **The background loop uses a durable DB-backed run queue**, not an in-memory per-org fan-out loop.
4. **No new channel constants module is introduced.**
   The current shared source of truth remains `packages/analytics/src/channels.ts`.
5. **The LLM contract is made parseable.**
   The model returns JSON containing `markdown`, `summary`, and `key_actions` instead of free-form markdown only.
6. **The document is rewritten as clean UTF-8 markdown.**
   No box-drawing diagrams or garbled copy should remain.

---

## 1. Problem Statement

Phase 8-1 created the scoring layer and insight accumulation. Phase 8-2 moves metric collection toward platform/API ingestion. The system still lacks the autonomous learning loop that turns collected performance data into durable analysis and feeds those learnings back into future generation.

Current gaps:

| Gap | Impact |
|---|---|
| No LLM-generated performance review | Insights remain mostly rule-based summaries |
| No canonical persisted analysis report | There is no human-readable report history to inspect or reuse |
| No historical report retrieval in RAG | The planner cannot learn from prior analysis cycles |
| No durable background execution model | A process restart can lose in-flight analysis work |
| UI has no full-report surface | Operators cannot inspect the latest analysis end-to-end |
| Prior draft assumed duplicated channel/scoring ownership | That would reintroduce drift already reduced in Phase 8-2 |

Desired loop:

```text
Auto-collected metrics
  -> scoring + accumulated insights refresh
  -> analysis run queued
  -> LLM generates structured performance review
  -> report stored in DB (canonical) + optional markdown export
  -> report embedded into RAG
  -> memory.md + generation prompts include latest findings
  -> future content uses learned recommendations
```

---

## 2. Target Outcome

| Step | Module | Behavior |
|---|---|---|
| 1 | Metrics ingestion | New `content_metrics` rows arrive from automated collectors |
| 2 | Follow-up hook | Score sync and accumulated insights refresh already run, then analysis may be queued |
| 3 | Analysis worker | A durable worker leases a queued run and generates the analysis |
| 4 | Report persistence | Full markdown report is written to `analysis_reports` |
| 5 | Optional export | A `.md` copy may be exported to disk if enabled |
| 6 | RAG indexing | Latest N reports are embedded as `analysis_report` chunks |
| 7 | Planning feedback | `memory.md` and Tier-2 retrieval use latest analysis findings |
| 8 | Desktop UX | Analytics page shows a latest-report preview and full report viewer |

---

## 3. Architecture Overview

```text
content_metrics
  -> runMetricsFollowUp()
      -> syncPerformanceScoreToRag()
      -> updateAccumulatedInsights()
      -> invalidateMemoryCache()
      -> maybeEnqueueAnalysisRun()

analytics_analysis_runs (queued/running/done/failed)
  -> startAnalyticsAnalysisWorker()
      -> lease queued run
      -> generatePerformanceAnalysis()
      -> persistAnalysisReport()
      -> exportAnalysisReportToFile() [optional]
      -> indexAnalysisReportInRag()
      -> invalidateMemoryCache()

analysis_reports (canonical markdown history)
  -> latest report summary injected into memory.md
  -> latest N full reports available to Tier-2 RAG retrieval
  -> desktop viewer loads report markdown from API
```

Key design principle:

- **DB first, filesystem second.** The UI and API must work even when filesystem export is disabled.

---

## 4. Existing Infrastructure to Reuse

| Component | File | Reuse Strategy |
|---|---|---|
| Shared analytics channel definitions | `packages/analytics/src/channels.ts` | Keep as the single source of truth |
| Shared insight helpers | `packages/analytics/src/index.ts` | Reuse for best times, CTA extraction, pattern summaries |
| Score sync to RAG | `apps/api/src/rag/rag-score-sync.ts` | Keep existing behavior |
| Insight recomputation | `apps/api/src/rag/compute-insights.ts` | Keep and extend follow-up trigger path only |
| Metrics follow-up | `apps/api/src/routes/metrics-helpers.ts` | Add queue-enqueue decision after existing follow-up |
| Memory cache invalidation | `apps/api/src/rag/memory-service.ts` | Reuse after report persistence and RAG indexing |
| Memory markdown builder | `packages/rag/src/memory-builder.ts` | Extend with optional latest analysis input |
| Tier-2 RAG retrieval | `apps/api/src/orchestrator/rag-context.ts` | Add `analysis_report` retrieval section |
| LLM fallback client | `apps/api/src/orchestrator/llm-client.ts` | Reuse `callWithFallback()` |
| RAG embedder/store | `apps/api/src/rag/ingest-content.ts`, `packages/rag/src/store.ts` | Reuse embedding generation and per-source replacement |
| Worker startup pattern | `apps/api/src/rag/ingest-brand-profile.ts` | Mirror the existing queue/recovery pattern |
| Desktop analytics surface | `apps/desktop/src/pages/analytics/InsightsPanel.tsx` | Add latest analysis preview and full report viewer |
| Desktop IPC metrics namespace | `apps/desktop/src/global.d.ts`, `apps/desktop/electron/main.mjs` | Extend existing `metrics` runtime methods |

What should **not** be added:

- No `packages/types/src/channels.ts`
- No resurrection of `fixture-analytics-engine.ts`
- No filesystem-only report storage
- No `queueMicrotask`-only scheduler without durable DB state

---

## 5. Corrected Design Decisions

### 5a. Canonical storage

`analysis_reports` stores the full markdown report, summary, key actions, and metadata.

- The **canonical report body** lives in Postgres.
- A markdown file export is optional and best-effort.
- The desktop viewer reads report content from API, not from a local file path.

### 5b. Historical retention

History is required for learning, so the loop must not replace all prior reports.

- `analysis_reports` keeps full history.
- RAG keeps the **latest 4 reports** per org by default.
- Older report embeddings may be pruned from RAG, but the DB history remains intact.
- The analyzer may look back at the **latest 2 summaries** for prompt comparison.

### 5c. Durable execution

Analysis execution should survive process restarts and avoid duplicate concurrent work.

- New table: `analytics_analysis_runs`
- Trigger paths enqueue a run row with an idempotency key
- Worker leases queued rows and marks them `running`
- Recovery loop re-queues stale leased jobs

### 5d. Shared ownership remains in `@repo/analytics`

The current repo already centralizes analytics channel semantics in `packages/analytics/src/channels.ts`.

- Reuse `ANALYTICS_CHANNELS`
- Reuse `ANALYTICS_METRIC_FIELDS`
- Reuse current score/insight helper ownership
- Do not move those constants back into `packages/types`

### 5e. Parseable LLM output contract

The worker should not scrape free-form markdown to recover summary fields.

Required model response contract:

```json
{
  "summary": "3-5 sentence Korean summary",
  "key_actions": ["...", "...", "..."],
  "markdown": "# ... full markdown report in Korean ..."
}
```

If parsing fails, the run is marked failed with a truncated diagnostic.

---

## 6. Data Model and Migrations

**Migration file:** `supabase/migrations/20260309120000_phase_8_3_autonomous_analytics_loop.sql`

### 6a. `analysis_reports`

Canonical persisted reports.

```sql
create table if not exists public.analysis_reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  trigger_reason text not null check (trigger_reason in ('new_metrics', 'cadence', 'manual', 'recovery')),
  summary text not null,
  key_actions jsonb not null default '[]'::jsonb,
  markdown text not null,
  markdown_hash text not null,
  content_count integer not null check (content_count >= 0),
  model_used text not null,
  compared_report_ids jsonb not null default '[]'::jsonb,
  export_path text,
  exported_at timestamptz,
  analyzed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_analysis_reports_org_date
  on public.analysis_reports (org_id, analyzed_at desc);

create index if not exists idx_analysis_reports_org_hash
  on public.analysis_reports (org_id, markdown_hash);

drop trigger if exists analysis_reports_updated_at on public.analysis_reports;
create trigger analysis_reports_updated_at
before update on public.analysis_reports
for each row execute function public.update_updated_at();
```

### 6b. `analytics_analysis_runs`

Durable run queue and execution log.

```sql
create table if not exists public.analytics_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  trigger_reason text not null check (trigger_reason in ('new_metrics', 'cadence', 'manual', 'recovery')),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  idempotency_key text not null,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  lease_owner text,
  lease_expires_at timestamptz,
  metric_high_watermark timestamptz,
  report_id uuid references public.analysis_reports(id) on delete set null,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_analytics_analysis_runs_org_idempotency
  on public.analytics_analysis_runs (org_id, idempotency_key);

create index if not exists idx_analytics_analysis_runs_dispatch
  on public.analytics_analysis_runs (status, requested_at, lease_expires_at)
  where status in ('queued', 'running');

drop trigger if exists analytics_analysis_runs_updated_at on public.analytics_analysis_runs;
create trigger analytics_analysis_runs_updated_at
before update on public.analytics_analysis_runs
for each row execute function public.update_updated_at();
```

### 6c. `org_rag_embeddings.source_type`

Add `analysis_report` to the allowed source types.

```sql
alter table public.org_rag_embeddings
  drop constraint if exists org_rag_embeddings_source_type_check;

alter table public.org_rag_embeddings
  add constraint org_rag_embeddings_source_type_check
  check (source_type in (
    'brand_profile', 'content', 'local_doc', 'chat_pattern', 'analysis_report'
  ));
```

### 6d. RLS

Use the repo's existing policy style instead of `using (true)`.

```sql
alter table public.analysis_reports enable row level security;
alter table public.analysis_reports force row level security;

drop policy if exists "org members can read analysis reports" on public.analysis_reports;
create policy "org members can read analysis reports"
  on public.analysis_reports
  for select
  using (
    org_id in (
      select org_id
      from public.organization_members
      where user_id = auth.uid()
    )
  );

drop policy if exists "service role can manage analysis reports" on public.analysis_reports;
create policy "service role can manage analysis reports"
  on public.analysis_reports
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

alter table public.analytics_analysis_runs enable row level security;
alter table public.analytics_analysis_runs force row level security;

drop policy if exists "service role can manage analytics analysis runs" on public.analytics_analysis_runs;
create policy "service role can manage analytics analysis runs"
  on public.analytics_analysis_runs
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
```

---

## 7. Module Design

To keep files small and responsibilities clear, Phase 8-3 should live under a dedicated feature folder:

`apps/api/src/analytics/`

### 7a. Analyzer: `apps/api/src/analytics/analyze-performance.ts`

**Main export**

```ts
export const generatePerformanceAnalysis = async (
  orgId: string,
  options?: { comparedReportLimit?: number }
): Promise<PerformanceAnalysisDraft>;
```

**Prompt inputs**

| Data source | Purpose | Budget |
|---|---|---|
| `AccumulatedInsights` | Best times, CTA phrases, channel recommendations | ~500 |
| Top 10 scored contents | Winning examples | ~800 |
| Bottom 5 scored contents | Failure patterns | ~400 |
| Latest 2 report summaries | Trend comparison | ~300 |
| Brand context | Tone, audience, summary | ~300 |

**Guardrails**

- Minimum 10 scored contents
- Skip if no new metrics and no manual request
- Cooldown default 6 hours
- Use `callWithFallback()` with low temperature
- Require JSON-only output

**Prompt contract**

The model must return a JSON object with:

```ts
type PerformanceAnalysisDraft = {
  markdown: string;
  summary: string;
  key_actions: string[];
  analyzed_at: string;
  content_count: number;
  model_used: "claude" | "gpt-4o-mini";
  compared_report_ids: string[];
};
```

**Markdown sections requested from the model**

1. `## 핵심 요약`
2. `## 채널별 성과 분석`
3. `## 콘텐츠 패턴 분석`
4. `## CTA 효과 분석`
5. `## 발행 전략 제안`
6. `## 다음 사이클 액션`
7. `## 이전 분석 대비 변화`

### 7b. Report repository: `apps/api/src/analytics/report-repository.ts`

**Main exports**

```ts
export const insertAnalysisReport = async (
  orgId: string,
  draft: PerformanceAnalysisDraft,
  triggerReason: AnalysisTriggerReason
): Promise<AnalysisReportRecord>;

export const getLatestAnalysisReport = async (orgId: string): Promise<AnalysisReportRecord | null>;
export const getAnalysisReportById = async (orgId: string, reportId: string): Promise<AnalysisReportRecord | null>;
export const listRecentAnalysisReports = async (orgId: string, limit?: number): Promise<AnalysisReportRecord[]>;
```

Notes:

- `markdown_hash` is computed server-side
- `analysis_reports.markdown` is always populated
- `AccumulatedInsights` is **not** extended to carry reports

### 7c. Optional export: `apps/api/src/analytics/report-export.ts`

**Main export**

```ts
export const exportAnalysisReportToFile = async (
  report: AnalysisReportRecord
): Promise<{ exportPath: string | null }>;
```

Rules:

- Export is controlled by env flags
- Export failure does not invalidate the DB record
- File naming must be collision-safe:

```text
{ANALYSIS_REPORT_EXPORT_DIR}/{orgId}/performance-analysis_{YYYY-MM-DD_HHmmss}_{reportId}.md
```

- Default base dir may point to `docs/reports/analytics`, but cloud deployments can disable export or point to a writable volume

### 7d. RAG indexer: `apps/api/src/analytics/report-rag-indexer.ts`

**Main exports**

```ts
export const indexAnalysisReportInRag = async (
  orgId: string,
  report: AnalysisReportRecord
): Promise<void>;

export const pruneOldAnalysisReportEmbeddings = async (
  orgId: string,
  keepLatestReports?: number
): Promise<void>;
```

Behavior:

- `source_type = "analysis_report"`
- `source_id = report.id`
- Chunk by H2 sections
- Use `ragStore.replaceBySource(orgId, "analysis_report", report.id, ...)`
- After indexing, prune embeddings older than the latest 4 reports
- Do **not** delete older DB report rows

### 7e. Run queue + worker

#### `apps/api/src/analytics/run-queue.ts`

```ts
export const enqueueAnalysisRun = async (
  orgId: string,
  triggerReason: AnalysisTriggerReason,
  params?: { idempotencyKey?: string; metricHighWatermark?: string | null }
): Promise<AnalysisRunRecord>;
```

#### `apps/api/src/analytics/analysis-worker.ts`

```ts
export const startAnalyticsAnalysisWorker = (): void;
export const stopAnalyticsAnalysisWorker = (): void;
export const processQueuedAnalysisRun = async (runId: string): Promise<void>;
```

Worker behavior:

1. Recover stale `running` rows whose lease expired
2. Lease a small batch of `queued` rows
3. Process one run at a time per org
4. Insert canonical report
5. Export markdown if enabled
6. Index report in RAG
7. Invalidate memory cache
8. Mark run `done` or `failed`

This should follow the startup/recovery pattern already used in `startRagIngestionWorker()`.

### 7f. Trigger sources

#### Metrics-driven trigger

Extend `runMetricsFollowUp()` in `apps/api/src/routes/metrics-helpers.ts`:

```ts
await syncPerformanceScoreToRag(...)
await updateAccumulatedInsights(orgId)
await invalidateMemoryCache(orgId)
await maybeEnqueueAnalysisRun(orgId, { reason: "new_metrics" })
```

The enqueue decision checks:

- scored content count >= minimum
- no active queued/running run for the org
- cooldown passed since latest report
- new `content_metrics` rows since latest report >= threshold

#### Manual trigger

`POST /orgs/:orgId/analytics/trigger-analysis`

- enqueues a manual run
- still respects minimum-content guard
- may bypass new-metrics threshold
- does not bypass lease safety

#### Cadence trigger

Use a **bounded cadence sweep**, not a global 30-minute fan-out.

- Recovery/sweep timer runs every 6 hours by default
- It queries orgs whose latest report is older than 7 days, or missing entirely
- It enqueues idempotent `cadence` runs only for orgs with enough scored contents

This is acceptable because:

- it is infrequent
- it uses durable queue rows
- it does not execute analysis inline while scanning

### 7g. Memory and prompt integration

#### `packages/rag/src/memory-builder.ts`

Extend the builder signature:

```ts
export const buildMemoryMd = (
  brandSettings: OrgBrandSettings,
  activeCampaigns: Campaign[],
  insights: AccumulatedInsights | null,
  latestAnalysis: LatestAnalysisSummary | null,
  options?: BuildMemoryOptions
): MemoryMd;
```

Add a new section:

```markdown
## Latest Performance Analysis

{summary}

### Key Actions
- {action 1}
- {action 2}
- {action 3}

> Analyzed at: {analyzed_at}
```

`computeMemoryFreshnessKey()` must include this latest-analysis payload so cache invalidation stays correct.

#### `apps/api/src/rag/memory-service.ts`

- load latest report separately from `analysis_reports`
- pass it into `buildMemoryMd()`
- do not overload `AccumulatedInsights`

#### `apps/api/src/orchestrator/rag-context.ts`

Add a new Tier-2 section:

```ts
analysis_report: {
  source_types: ["analysis_report"],
  top_k: 2,
  min_similarity: 0.55,
  budget: env.ragTier2AnalysisReportBudget
}
```

#### `apps/api/src/orchestrator/ai.ts`

Append active guidance when a latest report exists:

```text
=== Performance Guidance ===
- Reflect these actions: {key_actions}
- Best publish time for this channel: {best_publish_time}
- Effective CTA references: {top_cta_phrases}
```

---

## 8. API and Desktop Runtime

### 8a. API routes

**File:** `apps/api/src/routes/analytics.ts`

Routes:

```ts
POST /orgs/:orgId/analytics/trigger-analysis
GET  /orgs/:orgId/analytics/reports/latest
GET  /orgs/:orgId/analytics/reports/:reportId
```

Behavior:

- Use existing `requireApiSecret()` route protection style
- Manual trigger should also reuse `requireActiveSubscription()`
- Read endpoints return canonical DB markdown

Suggested response shapes:

```ts
type TriggerAnalysisResponse = {
  ok: true;
  queued: boolean;
  run: AnalysisRunRecord | null;
  message?: string;
};

type GetAnalysisReportResponse = {
  ok: true;
  report: AnalysisReportRecord | null;
};
```

### 8b. Desktop runtime additions

Keep the existing `metrics` namespace and extend it.

```ts
window.desktopRuntime.metrics.triggerAnalysis(): Promise<TriggerAnalysisResponse>;
window.desktopRuntime.metrics.getLatestAnalysisReport(): Promise<GetAnalysisReportResponse>;
window.desktopRuntime.metrics.getAnalysisReport(payload: { reportId: string }): Promise<GetAnalysisReportResponse>;
```

IPC handlers should be added to `apps/desktop/electron/main.mjs` using the same pattern as:

- `metrics:get-insights`
- `metrics:list-published-with-metrics`

### 8c. Desktop UI

**Primary file:** `apps/desktop/src/pages/analytics/InsightsPanel.tsx`

Add:

- latest analysis summary card
- key actions list
- analyzed-at timestamp
- content count
- `View full report` action that opens a modal/drawer with markdown content from API
- `Refresh analysis` button that enqueues a manual run

Important:

- the UI must not depend on a local filesystem path
- the latest-report card is a preview, not a file browser

---

## 9. Environment Variables

Add to `apps/api/src/lib/env.ts`:

```ts
analyticsWorkerEnabled: parseBoolean(readEnv("ANALYTICS_WORKER_ENABLED", "true"), true),
analysisCadenceDays: parsePositiveInt(readEnv("ANALYSIS_CADENCE_DAYS", "7"), 7),
analysisCadenceSweepIntervalMs: parsePositiveInt(readEnv("ANALYSIS_CADENCE_SWEEP_INTERVAL_MS", "21600000"), 21600000),
analysisRecoveryIntervalMs: parsePositiveInt(readEnv("ANALYSIS_RECOVERY_INTERVAL_MS", "60000"), 60000),
analysisLeaseMs: parsePositiveInt(readEnv("ANALYSIS_LEASE_MS", "300000"), 300000),
analysisCooldownHours: parsePositiveInt(readEnv("ANALYSIS_COOLDOWN_HOURS", "6"), 6),
analysisMinScoredContents: parsePositiveInt(readEnv("ANALYSIS_MIN_SCORED_CONTENTS", "10"), 10),
analysisNewMetricsThreshold: parsePositiveInt(readEnv("ANALYSIS_NEW_METRICS_THRESHOLD", "20"), 20),
analysisMaxTokens: parsePositiveInt(readEnv("ANALYSIS_MAX_TOKENS", "4000"), 4000),
analysisReportHistoryRagCount: parsePositiveInt(readEnv("ANALYSIS_REPORT_HISTORY_RAG_COUNT", "4"), 4),
analysisReportExportEnabled: parseBoolean(readEnv("ANALYSIS_REPORT_EXPORT_ENABLED", "false"), false),
analysisReportExportDir: readEnv("ANALYSIS_REPORT_EXPORT_DIR", "docs/reports/analytics"),
ragTier2AnalysisReportBudget: parsePositiveInt(readEnv("RAG_TIER2_ANALYSIS_REPORT_BUDGET", "600"), 600),
```

Also update:

- `apps/api/src/index.ts` startup to call `startAnalyticsAnalysisWorker()`
- schema-probe warnings to mention the new migration
- `requiredTables` to include `analysis_reports` and `analytics_analysis_runs`

---

## 10. Types

**File:** `packages/types/src/index.ts`

Required additions:

```ts
export type RagSourceType =
  | "brand_profile"
  | "content"
  | "local_doc"
  | "chat_pattern"
  | "analysis_report";

export type AnalysisTriggerReason = "new_metrics" | "cadence" | "manual" | "recovery";

export type AnalysisReportRecord = {
  id: string;
  org_id: string;
  trigger_reason: AnalysisTriggerReason;
  summary: string;
  key_actions: string[];
  markdown: string;
  markdown_hash: string;
  content_count: number;
  model_used: string;
  compared_report_ids: string[];
  export_path: string | null;
  exported_at: string | null;
  analyzed_at: string;
  created_at: string;
  updated_at: string;
};

export type AnalysisRunRecord = {
  id: string;
  org_id: string;
  trigger_reason: AnalysisTriggerReason;
  status: "queued" | "running" | "done" | "failed";
  idempotency_key: string;
  requested_at: string;
  started_at: string | null;
  completed_at: string | null;
  lease_owner: string | null;
  lease_expires_at: string | null;
  metric_high_watermark: string | null;
  report_id: string | null;
  last_error: string | null;
};

export type LatestAnalysisSummary = {
  summary: string;
  key_actions: string[];
  analyzed_at: string;
  content_count: number;
};
```

No channel-type refactor is needed in this phase.

---

## 11. Testing and Verification

### 11a. Unit tests

| File | Coverage |
|---|---|
| `apps/api/tests/phase-8-3-analyze-performance.test.ts` | prompt assembly, minimum-content guard, cooldown, JSON parsing |
| `apps/api/tests/phase-8-3-report-repository.test.ts` | DB insert, latest lookup, report fetch by id |
| `apps/api/tests/phase-8-3-report-export.test.ts` | filename format, optional export behavior |
| `apps/api/tests/phase-8-3-report-rag-indexer.test.ts` | chunking, per-report source ids, pruning policy |
| `apps/api/tests/phase-8-3-analysis-worker.test.ts` | lease handling, recovery, run completion order |
| `apps/api/tests/phase-8-3-memory-builder.test.ts` | latest-analysis section and freshness key changes |

### 11b. Integration test

| File | Coverage |
|---|---|
| `apps/api/tests/phase-8-3-analytics-loop.test.ts` | metrics -> follow-up -> queue -> analysis -> report -> RAG -> memory invalidation |

### 11c. Verification checklist

1. Submit 20+ metrics across at least 3 channels.
2. Confirm `runMetricsFollowUp()` still updates performance scores and accumulated insights.
3. Confirm an `analytics_analysis_runs` row is queued.
4. Run the worker and verify one canonical `analysis_reports` row is inserted with non-empty `markdown`.
5. If export is enabled, verify the markdown file is created with a timestamp-safe name.
6. Verify `org_rag_embeddings` includes `source_type = 'analysis_report'` rows for the latest report.
7. Insert 5+ reports for one org and verify RAG pruning keeps only the latest configured report count.
8. Verify `memory.md` includes the latest analysis summary section.
9. Generate new content and confirm the prompt includes performance guidance from latest analysis.
10. Trigger another run inside the cooldown window and verify it is rejected or deduped.
11. Mock stale `running` rows and verify recovery requeues them.
12. Run typecheck, lint, unit tests, and integration tests.
13. Smoke-test the desktop analytics page and verify the full report viewer renders correctly.

---

## 12. Implementation Order

| Step | Work | Depends on |
|---|---|---|
| 1 | Migration: `analysis_reports`, `analytics_analysis_runs`, RAG source type update | - |
| 2 | Types: `RagSourceType`, report/run types, latest-analysis summary type | Step 1 |
| 3 | API analytics repository + routes | Steps 1-2 |
| 4 | Analyzer with JSON contract | Steps 1-2 |
| 5 | Optional report export helper | Step 3 |
| 6 | Report RAG indexer + pruning | Steps 3-4 |
| 7 | Queue + worker + startup wiring | Steps 3-6 |
| 8 | Metrics follow-up enqueue logic | Step 7 |
| 9 | Memory builder + memory service updates | Steps 3-6 |
| 10 | `rag-context.ts` + `ai.ts` feedback integration | Step 9 |
| 11 | Desktop IPC/runtime additions | Step 3 |
| 12 | Analytics page preview + full report viewer | Step 11 |
| 13 | Tests, typecheck, lint, smoke verification | All |

---

## 13. Files to Create / Modify

| File | Action | Notes |
|---|---|---|
| `supabase/migrations/20260309120000_phase_8_3_autonomous_analytics_loop.sql` | NEW | tables, indexes, RLS, source type update |
| `packages/types/src/index.ts` | MODIFY | `RagSourceType`, report/run types |
| `apps/api/src/lib/env.ts` | MODIFY | new analysis env vars |
| `apps/api/src/index.ts` | MODIFY | required table checks + worker startup |
| `apps/api/src/analytics/analyze-performance.ts` | NEW | analyzer only |
| `apps/api/src/analytics/report-repository.ts` | NEW | DB persistence and fetches |
| `apps/api/src/analytics/report-export.ts` | NEW | optional filesystem export |
| `apps/api/src/analytics/report-rag-indexer.ts` | NEW | embedding + pruning |
| `apps/api/src/analytics/run-queue.ts` | NEW | enqueue and lookup helpers |
| `apps/api/src/analytics/analysis-worker.ts` | NEW | leasing, recovery, run execution |
| `apps/api/src/routes/analytics.ts` | NEW | manual trigger + report reads |
| `apps/api/src/routes/metrics-helpers.ts` | MODIFY | enqueue decision after existing follow-up |
| `apps/api/src/rag/memory-service.ts` | MODIFY | latest report load + builder input |
| `packages/rag/src/memory-builder.ts` | MODIFY | latest-analysis section and freshness key |
| `apps/api/src/orchestrator/rag-context.ts` | MODIFY | `analysis_report` Tier-2 section |
| `apps/api/src/orchestrator/ai.ts` | MODIFY | active performance guidance |
| `apps/desktop/src/global.d.ts` | MODIFY | extend `desktopRuntime.metrics` |
| `apps/desktop/electron/main.mjs` | MODIFY | IPC handlers for trigger/report fetch |
| `apps/desktop/src/pages/analytics/InsightsPanel.tsx` | MODIFY | preview card, refresh action, full report viewer |
| `apps/desktop/src/i18n/locales/ko.json` | MODIFY | clean UTF-8 labels |
| `apps/desktop/src/i18n/locales/en.json` | MODIFY | report viewer labels |
| `apps/api/tests/phase-8-3-analyze-performance.test.ts` | NEW | unit |
| `apps/api/tests/phase-8-3-report-repository.test.ts` | NEW | unit |
| `apps/api/tests/phase-8-3-report-export.test.ts` | NEW | unit |
| `apps/api/tests/phase-8-3-report-rag-indexer.test.ts` | NEW | unit |
| `apps/api/tests/phase-8-3-analysis-worker.test.ts` | NEW | unit |
| `apps/api/tests/phase-8-3-memory-builder.test.ts` | NEW | unit |
| `apps/api/tests/phase-8-3-analytics-loop.test.ts` | NEW | integration |

---

## 14. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| LLM cost grows with frequent ingestion | queue only when threshold/cadence/manual rules pass |
| Duplicate concurrent analysis runs | durable queue + idempotency key + lease ownership |
| Process restart during analysis | recovery loop reclaims stale `running` rows |
| Markdown export path unavailable in cloud | DB remains canonical; export is optional |
| RAG overfits to only one recent report | keep latest 4 report histories in RAG |
| Report parsing breaks on malformed model output | require JSON-only contract and fail fast |
| Memory cache misses latest report | include latest-analysis payload in freshness key |
| Future channel drift | continue using `packages/analytics/src/channels.ts` |

---

## 15. Success Criteria

This phase is complete when:

1. New metrics can enqueue an analysis run automatically.
2. The worker processes the run durably and inserts a canonical markdown report into `analysis_reports`.
3. The desktop analytics page can preview and open the latest report without relying on local files.
4. The latest report is embedded into RAG as `analysis_report` chunks, while recent report history remains available.
5. `memory.md` and generation prompts include latest performance guidance.
6. Manual trigger, cooldown, and stale-run recovery are all verified.
7. Typecheck, lint, unit tests, integration tests, and desktop smoke verification pass.
