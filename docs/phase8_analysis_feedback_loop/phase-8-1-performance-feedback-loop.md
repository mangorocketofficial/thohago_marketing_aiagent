# Phase 8-1: Performance Analytics Feedback Loop

> **Date:** 2026-03-07
> **Status:** Planning
> **Scope:** Full-cycle performance analytics — data input, scoring, insight computation, AI feed-forward

---

## 1. Problem Statement

The current system only counts published content per channel. It does **not** collect actual engagement metrics (likes, comments, shares, follower growth), analyze content performance, or feed learnings back into future content generation.

### What is missing

| Gap | Impact |
|---|---|
| No engagement metrics storage | Cannot measure content effectiveness |
| No performance scoring | RAG retrieval boost (`performance_score`) is always null |
| `best_publish_times` always `{}` | AI cannot recommend optimal posting times |
| `top_cta_phrases` always `[]` | AI cannot learn which CTAs drive engagement |
| `channel_recommendations` count-based only | No quality signal, only volume |
| No input UI for metrics | Users cannot record performance data |
| Analytics page is a placeholder | No actionable insights displayed |

### Desired feedback loop

```
Publish Content → Collect Metrics → Analyze Performance → Feed into AI → Generate Better Content
       ↑                                                                         │
       └─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Architecture Overview

```
[UI: PerformanceInputPanel]
  └─ Manual metrics input per published content
       │
       ▼
[IPC: window.desktopRuntime.metrics.submitBatch]
  └─ Electron main → API route POST /orgs/:orgId/metrics/batch
       │
       ▼
[API Route: metrics.ts]
  └─ Validates input → writes content_metrics rows
       │
       ▼
[Service: performance-scorer.ts]
  └─ Computes 0-100 normalized score per content
       │
       ▼
[Service: rag-score-sync.ts]
  └─ Updates org_rag_embeddings.metadata.performance_score
       │
       ▼
[Service: compute-insights.ts (extended)]
  └─ Populates best_publish_times, top_cta_phrases,
     performance-aware channel_recommendations
       │
       ▼
[memory-service.ts]
  └─ Invalidates memory cache (memory_freshness_key = null)
       │
       ▼
[Next AI content generation call]
  ├─ memory-builder.ts renders insights into prompt (already wired)
  └─ rag-context.ts applies 1.5x boost by performance_score (already wired)
```

---

## 3. Existing Infrastructure (Already Built)

These components are already implemented and will be leveraged:

| Component | File | Status |
|---|---|---|
| `performance_score` in RAG embedding metadata | `apps/api/src/rag/ingest-content.ts` | Wired but hardcoded `null` |
| 1.5x retrieval boost by `performance_score` | `apps/api/src/orchestrator/rag-context.ts` | Wired but inert (score is null) |
| Score display in Tier-2 prompt context | `apps/api/src/orchestrator/rag-context.ts` | Shows `n/a` |
| `AccumulatedInsights` type | `packages/types/src/index.ts` | Defined |
| Insights rendered into AI memory markdown | `packages/rag/src/memory-builder.ts` | Working (empty sections) |
| Memory cache invalidation | `apps/api/src/rag/memory-service.ts` | `invalidateMemoryCache(orgId)` |
| Insights refresh trigger | `apps/api/src/rag/ingest-content.ts` | Every 5 embeds |
| Analytics page shell | `apps/desktop/src/pages/Analytics.tsx` | Placeholder with fixture data |
| Frontend Supabase client | `apps/desktop/src/App.tsx` | Available, passed to other pages |

---

## 4. Database Migration

**File:** `supabase/migrations/20260307120000_phase_8_1_performance_metrics.sql`

### New table: `content_metrics`

Stores raw engagement metrics per content per collection run. One content can have multiple snapshots (day 1, day 7, day 30). The latest snapshot is canonical for scoring.

```sql
create table if not exists public.content_metrics (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  content_id      uuid not null references public.contents(id) on delete cascade,
  channel         text not null,
  likes           integer,       -- Instagram/Facebook likes, Naver views, YouTube views
  comments        integer,
  shares          integer,
  saves           integer,       -- Instagram saves
  follower_delta  integer,       -- Follower count change after publication
  performance_score numeric(5,2),-- Server-computed 0-100 normalized score
  collection_source text not null default 'manual',  -- 'manual' | 'api_instagram' | ...
  collected_at    timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

create index idx_content_metrics_org_content
  on public.content_metrics (org_id, content_id, collected_at desc);

create index idx_content_metrics_org_score
  on public.content_metrics (org_id, performance_score desc)
  where performance_score is not null;

alter table public.content_metrics enable row level security;
create policy "service_role_all" on public.content_metrics
  using (true) with check (true);
```

### Design decisions

- **Separate table** (not columns on `contents`): Supports multiple snapshots, avoids triggering `contents.updated_at`, and keeps the `contents` table focused on content data.
- **`collection_source` column**: Future-proofs for API auto-collection. When Instagram Graph API is integrated, a background job inserts rows with `collection_source = 'api_instagram'` — no schema changes needed.
- **`performance_score` on this table**: Denormalized for fast aggregation queries. Also synced to `org_rag_embeddings.metadata.performance_score`.

---

## 5. Type Definitions

**File:** `packages/types/src/index.ts` — additions

```ts
/** Raw metrics submitted per content (from UI or API) */
export type ContentMetricsInput = {
  content_id: string;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  saves?: number | null;
  follower_delta?: number | null;
};

/** Stored row shape returned from database */
export type ContentMetricsRow = {
  id: string;
  org_id: string;
  content_id: string;
  channel: string;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  follower_delta: number | null;
  performance_score: number | null;
  collection_source: string;
  collected_at: string;
};

/** Published content with latest metrics for UI display */
export type PublishedContentWithMetrics = {
  id: string;
  channel: string;
  body: string | null;
  published_at: string | null;
  latest_metrics: ContentMetricsRow | null;
};
```

---

## 6. Backend Implementation

### 6a. NEW: `apps/api/src/rag/performance-scorer.ts` (~180 lines)

Channel-aware weighted scoring algorithm.

**Core function:**

```ts
export const computePerformanceScore = (
  metrics: RawMetrics,
  channel: string,
  orgStats: OrgChannelStats
): number | null;
```

**Scoring logic:**
- For each non-null metric: `ratio = value / (2 * org_avg)`, capped at 1.0
- Channel-specific weights:
  - Instagram: likes 1.0, comments 1.5, shares 1.0, saves 2.0, follower_delta 1.0
  - Threads: likes 1.0, comments 1.5, shares 1.0, follower_delta 1.0
  - Facebook: likes 1.0, comments 1.5, shares 1.5
  - Naver Blog: likes(views) 1.0, comments 2.0
  - YouTube: likes(views) 1.0, comments 1.5
- Weighted average of present metrics × 100 = final score (0-100)
- Returns `null` if all metrics are null
- If org has no prior data, uses fixed reference values (likes: 50, comments: 10, shares: 5, saves: 15, follower_delta: 20)

**Org stats loader:**

```ts
export const loadOrgChannelStats = async (
  orgId: string,
  channel: string
): Promise<OrgChannelStats>;
```

Queries `content_metrics` for per-channel averages. Falls back to defaults if fewer than 3 rows exist.

### 6b. NEW: `apps/api/src/rag/rag-score-sync.ts` (~80 lines)

Updates `org_rag_embeddings.metadata.performance_score` after scoring.

```ts
export const syncPerformanceScoreToRag = async (
  orgId: string,
  contentId: string,
  score: number
): Promise<{ updated: number }>;
```

Implementation: Fetches all embedding rows for the content, merges `performance_score` into metadata JSONB, batch updates. Follows the pattern in `ingest-content.ts`.

### 6c. MODIFY: `apps/api/src/rag/compute-insights.ts`

Extend with performance-aware insight computation.

**New functions:**

| Function | Purpose |
|---|---|
| `computeBestPublishTimes(rows)` | Group by channel + 2-hour time bucket, return bucket with highest avg score |
| `extractTopCtaPhrases(rows, topN=5)` | Regex-extract Korean/English CTA patterns from content with score >= 70 |
| `buildPerformanceAwareRecommendations(counts, avgScores)` | Factor avg score into channel recommendations |
| `computeInsights(orgId)` | Main entry — uses performance data when available, falls back to count-only |

**CTA extraction patterns:**
- Korean: `지금\s*(바로)?\s*[클릭|확인|신청|구매|방문|참여]`, `링크\s*(클릭|확인)`, `프로필\s*(링크|에서)`
- English: `click now`, `learn more`, `shop now`, `sign up`
- Ranked by frequency in high-performing content (score >= 70)

**Best publish time logic:**
- Group content by channel + 2-hour bucket (00-02, 02-04, ..., 22-24)
- Compute average `performance_score` per bucket
- Minimum 2 data points required per bucket
- Output: `{ instagram: "오후 6-8시", naver_blog: "오전 10-12시" }`

### 6d. NEW: `apps/api/src/routes/metrics.ts` (~220 lines)

REST endpoints following `contents.ts` pattern with `requireApiSecret` middleware.

**Endpoints:**

#### `GET /orgs/:orgId/metrics/published-contents`

Returns published contents with their latest metric snapshot.

- Query params: `channel?`, `limit` (max 50), `cursor` (content_id for pagination)
- Response: `{ ok, items: PublishedContentWithMetrics[], next_cursor }`
- SQL: LEFT JOIN `contents` with latest `content_metrics` per content_id

#### `POST /orgs/:orgId/metrics/batch`

Accepts batch metric inputs, computes scores, syncs to RAG, refreshes insights.

- Body: `{ entries: ContentMetricsInput[] }`
- Response: `{ ok, saved, failed, insights_refreshed }`

**Batch submit flow:**

1. Validate entries (content_ids belong to org, channel matches, non-negative values)
2. Load org channel stats per unique channel
3. Compute `performance_score` for each entry via `computePerformanceScore()`
4. INSERT into `content_metrics`
5. Sync scores to RAG embeddings via `syncPerformanceScoreToRag()`
6. Refresh insights via `computeInsights(orgId)` → update `org_brand_settings.accumulated_insights`
7. Invalidate memory cache via `invalidateMemoryCache(orgId)`
8. Return result

### 6e. MODIFY: `apps/api/src/index.ts`

Register the new router:

```ts
import { metricsRouter } from "./routes/metrics";
// ...
app.use(metricsRouter);
```

---

## 7. Electron IPC Bridge

### 7a. MODIFY: `apps/desktop/src/global.d.ts`

Add `metrics` namespace to `window.desktopRuntime`:

```ts
metrics: {
  listPublishedWithMetrics: (payload: {
    channel?: string;
    limit?: number;
    cursor?: string | null;
  }) => Promise<{
    ok: boolean;
    items: PublishedContentWithMetrics[];
    next_cursor: string | null;
    message?: string;
  }>;

  submitBatch: (payload: {
    entries: ContentMetricsInput[];
  }) => Promise<{
    ok: boolean;
    saved: number;
    failed: number;
    insights_refreshed: boolean;
    message?: string;
  }>;
};
```

### 7b. Main process IPC handlers

Follow existing `content.*` pattern — bridge IPC calls to API HTTP requests:

- `metrics.listPublishedWithMetrics` → `GET /orgs/:orgId/metrics/published-contents`
- `metrics.submitBatch` → `POST /orgs/:orgId/metrics/batch`

---

## 8. Frontend Implementation

### 8a. File structure

```
apps/desktop/src/pages/
  Analytics.tsx                              ← MODIFY: tab coordinator (~60 lines)
  analytics/
    InsightsPanel.tsx                        ← NEW: live insights display (~180 lines)
    PerformanceInputPanel.tsx                ← NEW: metrics input UI (~280 lines)
    useAnalyticsData.ts                      ← NEW: data fetching hook (~100 lines)
```

### 8b. `Analytics.tsx` — Tab coordinator

```tsx
type AnalyticsPageProps = {
  supabase: SupabaseClient | null;
  orgId: string | null;
};

export const AnalyticsPage = ({ supabase, orgId }: AnalyticsPageProps) => {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"insights" | "input">("insights");

  return (
    <div className="app-shell ui-page-shell">
      <section className="panel ui-page-panel">
        <p className="eyebrow">{t("ui.pages.analytics.eyebrow")}</p>
        <h1>{t("ui.pages.analytics.title")}</h1>
        <div className="ui-analytics-tab-row">
          <button className={`ui-analytics-tab ${tab === "insights" ? "active" : ""}`}
                  onClick={() => setTab("insights")}>
            {t("ui.pages.analytics.tabs.insights")}
          </button>
          <button className={`ui-analytics-tab ${tab === "input" ? "active" : ""}`}
                  onClick={() => setTab("input")}>
            {t("ui.pages.analytics.tabs.input")}
          </button>
        </div>
      </section>

      {tab === "insights"
        ? <InsightsPanel supabase={supabase} orgId={orgId} />
        : <PerformanceInputPanel />}
    </div>
  );
};
```

### 8c. `InsightsPanel.tsx` — Live insights display

Extracted from current `Analytics.tsx` layout. Replaces fixture import with live Supabase query:

```ts
const { data } = await supabase
  .from("org_brand_settings")
  .select("accumulated_insights, updated_at")
  .eq("org_id", orgId)
  .maybeSingle();
```

Renders same card layout (stat cards, tables, chips) but with real `AccumulatedInsights` data. Shows empty state with prompt to enter metrics when no data exists.

### 8d. `PerformanceInputPanel.tsx` — Metrics input UI

**Layout:**

```
[Channel filter chips]  전체 | 인스타그램 | 블로그 | 유튜브 | 페이스북 | 쓰레드

[Published content list — scrollable]
  ┌─────────────────────────────────────────────────────────────────────┐
  │ [IG badge] 오늘의 WFK 봉사 활동 소개...  │ 좋아요 [___] 댓글 [___] │
  │ 2026-03-05 18:30                          │ 공유 [___]   저장 [___] │
  │ Score: 72.5                               │ 팔로워 [___]            │
  ├─────────────────────────────────────────────────────────────────────┤
  │ [Blog badge] WFK 봉사단 모집 안내...      │ 조회수 [___] 댓글 [___] │
  │ 2026-03-04 10:00                          │                         │
  └─────────────────────────────────────────────────────────────────────┘

[Sticky bottom bar]
  "3개 항목 입력됨"  [초기화]  [성과 저장 및 AI 반영]
```

**Channel-aware metric fields:**

| Channel | Fields |
|---|---|
| Instagram | 좋아요, 댓글, 공유, 저장, 팔로워 증감 |
| Threads | 좋아요, 댓글, 공유, 팔로워 증감 |
| Facebook | 좋아요, 댓글, 공유 |
| Naver Blog | 조회수, 댓글 |
| YouTube | 조회수, 좋아요, 댓글 |

**State:**
- `draftMetrics: Map<contentId, ContentMetricsInput>` — tracks user input
- `isSubmitting: boolean` — loading state during API call
- On submit: calls `window.desktopRuntime.metrics.submitBatch({ entries })`
- On success: clears draft, shows success message, optionally switches to insights tab

### 8e. `useAnalyticsData.ts` — Data fetching hook

```ts
export const useAnalyticsData = (supabase, orgId) => {
  // Insights: direct Supabase query to org_brand_settings.accumulated_insights
  // Published contents: IPC call to window.desktopRuntime.metrics.listPublishedWithMetrics
  // Returns: { insights, publishedContents, isLoading, refresh, loadMore, hasMore }
};
```

### 8f. MODIFY: `apps/desktop/src/App.tsx`

Pass `supabase` and `orgId` to `AnalyticsPage`:

```tsx
// Before:
analyticsPage={<AnalyticsPage />}

// After:
analyticsPage={
  <AnalyticsPage
    supabase={supabase}
    orgId={chatConfig?.orgId ?? desktopConfig?.orgId ?? null}
  />
}
```

---

## 9. i18n Keys

### `ko.json` additions under `ui.pages.analytics`

```json
{
  "tabs": {
    "insights": "인사이트",
    "input": "성과 입력"
  },
  "input": {
    "eyebrow": "성과 데이터 입력",
    "title": "콘텐츠 성과 직접 입력",
    "description": "발행된 콘텐츠의 성과 지표를 입력하면 AI가 다음 콘텐츠 기획에 반영합니다.",
    "channelFilterAll": "전체",
    "fields": {
      "likes": "좋아요",
      "comments": "댓글",
      "shares": "공유",
      "saves": "저장",
      "follower_delta": "팔로워 증감",
      "views": "조회수"
    },
    "submitButton": "성과 저장 및 AI 반영",
    "resetButton": "초기화",
    "dirtyCount": "{{count}}개 항목 입력됨",
    "submitting": "저장 중...",
    "successMessage": "{{saved}}개 저장 완료. AI 인사이트가 업데이트되었습니다.",
    "partialFailure": "{{saved}}개 저장, {{failed}}개 실패.",
    "empty": "표시할 발행 콘텐츠가 없습니다.",
    "loading": "콘텐츠를 불러오는 중...",
    "loadMore": "더 보기",
    "noMetrics": "아직 성과 데이터가 없습니다"
  },
  "score": {
    "label": "성과 점수",
    "notAvailable": "-"
  }
}
```

### `en.json` — equivalent English keys

```json
{
  "tabs": {
    "insights": "Insights",
    "input": "Performance Input"
  },
  "input": {
    "eyebrow": "Performance Data",
    "title": "Enter Content Performance",
    "description": "Enter engagement metrics for published content. AI will use this to improve future content.",
    "channelFilterAll": "All",
    "fields": {
      "likes": "Likes",
      "comments": "Comments",
      "shares": "Shares",
      "saves": "Saves",
      "follower_delta": "Follower Change",
      "views": "Views"
    },
    "submitButton": "Save & Update AI",
    "resetButton": "Reset",
    "dirtyCount": "{{count}} items entered",
    "submitting": "Saving...",
    "successMessage": "{{saved}} saved. AI insights updated.",
    "partialFailure": "{{saved}} saved, {{failed}} failed.",
    "empty": "No published content to display.",
    "loading": "Loading content...",
    "loadMore": "Load more",
    "noMetrics": "No performance data yet"
  },
  "score": {
    "label": "Score",
    "notAvailable": "-"
  }
}
```

---

## 10. CSS Additions

**File:** `apps/desktop/src/styles.css`

```css
/* Analytics tab switcher */
.ui-analytics-tab-row { display: flex; gap: 6px; margin-bottom: 4px; }
.ui-analytics-tab { padding: 6px 14px; border-radius: 8px; font-size: 13px;
                     border: 1px solid #c4cedc; background: #fff; cursor: pointer; }
.ui-analytics-tab.active { background: #285ea8; color: #fff; border-color: #285ea8; }

/* Metrics content list */
.ui-metrics-content-list { display: grid; gap: 10px; }

/* Metrics row (content preview + inputs) */
.ui-metrics-row { border: 1px solid var(--ui-card-border); border-radius: var(--ui-radius-md);
                   background: var(--ui-bg-surface); padding: 14px;
                   display: grid; grid-template-columns: 1fr auto; gap: 16px; align-items: start; }

/* Content preview */
.ui-metrics-content-preview { display: grid; gap: 6px; }
.ui-metrics-content-body { font-size: 13px; color: #334155; overflow: hidden;
                            display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }

/* Metric input fields */
.ui-metrics-inputs { display: flex; gap: 8px; flex-wrap: wrap; }
.ui-metrics-field { display: grid; gap: 3px; min-width: 72px; }
.ui-metrics-field label { font-size: 11px; color: #64748b; text-transform: uppercase; }
.ui-metrics-field input { width: 80px; border: 1px solid #c8d2e1; border-radius: 8px;
                           padding: 6px 8px; font-size: 13px; font-family: inherit; }
.ui-metrics-field input:focus { outline: none; border-color: #5b8def; }

/* Score badge */
.ui-metrics-score-badge { display: inline-flex; padding: 3px 9px; border-radius: 999px;
                           font-size: 12px; font-weight: 600; border: 1px solid #bfd1f1;
                           background: #eef4ff; color: #1e40af; }

/* Sticky submit bar */
.ui-metrics-submit-bar { position: sticky; bottom: 0; background: rgba(255,255,255,0.96);
                          border-top: 1px solid #d6dce4; padding: 12px 18px;
                          display: flex; align-items: center; gap: 12px;
                          margin: 0 -18px -18px; border-radius: 0 0 16px 16px; }
```

---

## 11. Testing Strategy

### Unit tests

| File | What it tests |
|---|---|
| `tests/performance-scorer.test.ts` | Score computation: all-null → null, at-avg → ~50, 2x-avg → ~100, channel-specific weights |
| `tests/compute-insights-performance.test.ts` | `computeBestPublishTimes`, `extractTopCtaPhrases`, performance-aware recommendations |
| `tests/wfk-dummy-insights.test.ts` | Existing — validates fixture parsing (keep as-is) |

### Integration test

| File | What it tests |
|---|---|
| `tests/phase-8-1-metrics-feedback.test.ts` | Full route flow: batch submit → scoring → RAG sync → insights refresh |

### Manual smoke test checklist

1. Start desktop app → navigate to 성과분석 → "성과 입력" tab
2. Verify published content list loads with channel filter
3. Enter metrics for 2+ contents across different channels
4. Click "성과 저장 및 AI 반영" → verify success message
5. Switch to "인사이트" tab → verify `best_publish_times` and `top_cta_phrases` populated
6. Open Chat → generate content → verify AI prompt contains `score: XX.XX` (not `n/a`)

---

## 12. Implementation Order

| Step | Files | Depends on |
|---|---|---|
| 1. DB migration + types | `migration.sql`, `packages/types/src/index.ts` | — |
| 2. Performance scorer | `apps/api/src/rag/performance-scorer.ts` + test | Step 1 |
| 3. RAG score sync | `apps/api/src/rag/rag-score-sync.ts` | Step 1 |
| 4. Compute insights extension | `apps/api/src/rag/compute-insights.ts` + test | Step 2 |
| 5. Metrics API route | `apps/api/src/routes/metrics.ts`, `index.ts` | Steps 2-4 |
| 6. IPC bridge | `global.d.ts` + main process handlers | Step 5 |
| 7. Frontend analytics | `Analytics.tsx` refactor + new components | Steps 5-6 |
| 8. i18n + CSS | `ko.json`, `en.json`, `styles.css` | Step 7 |
| 9. Integration test + smoke test | `phase-8-1-metrics-feedback.test.ts` | All |

---

## 13. Files to Create / Modify

| File | Action | Est. Lines |
|---|---|---|
| `supabase/migrations/20260307120000_phase_8_1_performance_metrics.sql` | NEW | ~50 |
| `packages/types/src/index.ts` | MODIFY | +40 |
| `apps/api/src/rag/performance-scorer.ts` | NEW | ~180 |
| `apps/api/src/rag/rag-score-sync.ts` | NEW | ~80 |
| `apps/api/src/rag/compute-insights.ts` | MODIFY | ~200 |
| `apps/api/src/routes/metrics.ts` | NEW | ~220 |
| `apps/api/src/index.ts` | MODIFY | +2 |
| `apps/desktop/src/global.d.ts` | MODIFY | +20 |
| `apps/desktop/src/pages/Analytics.tsx` | MODIFY | ~60 |
| `apps/desktop/src/pages/analytics/InsightsPanel.tsx` | NEW | ~180 |
| `apps/desktop/src/pages/analytics/PerformanceInputPanel.tsx` | NEW | ~280 |
| `apps/desktop/src/pages/analytics/useAnalyticsData.ts` | NEW | ~100 |
| `apps/desktop/src/App.tsx` | MODIFY | +3 |
| `apps/desktop/src/i18n/locales/ko.json` | MODIFY | +30 |
| `apps/desktop/src/i18n/locales/en.json` | MODIFY | +30 |
| `apps/desktop/src/styles.css` | MODIFY | +50 |
| `apps/api/tests/performance-scorer.test.ts` | NEW | ~100 |
| `apps/api/tests/compute-insights-performance.test.ts` | NEW | ~100 |

---

## 14. Future: API Auto-Collection

The `collection_source` column enables seamless transition to automatic data collection:

1. A background job calls Instagram Graph API / Naver API / YouTube Data API
2. Inserts rows with `collection_source = 'api_instagram'` (or `api_naver`, etc.)
3. Same `computePerformanceScore()` → `syncPerformanceScoreToRag()` → `computeInsights()` pipeline runs
4. UI shows "자동 수집" badge instead of "직접 입력"
5. No schema or scoring logic changes needed

Required for API integration (not in this phase):
- OAuth token storage per org per platform
- Background scheduler for periodic metric fetching
- Rate limit handling per platform
- Token refresh logic

---

## 15. Hardening Updates Applied Before Implementation

The implementation plan now includes the following reliability/safety upgrades:

1. **RLS hardening on `content_metrics`**
   - Enforce `force row level security`
   - Restrict table access to `service_role` policy only

2. **Idempotent batch ingestion**
   - Added `idempotency_key` column + unique index `(org_id, idempotency_key)`
   - Added request-level idempotency key support in `POST /metrics/batch`

3. **Score stability improvements**
   - Replaced hard cap-at-2x behavior with log scaling
   - Added winsorized baseline computation for outlier resistance

4. **CTA regex correctness**
   - Fixed alternation patterns to use capture groups `(A|B|C)` instead of character classes

5. **Timezone-explicit publish-time insights**
   - `best_publish_times` now computed and rendered with explicit timezone labels (fallback: `UTC`)

6. **Latency risk mitigation**
   - For large batch submissions, heavy follow-up (`RAG sync`, `insights refresh`) is queued asynchronously
   - Small batches remain synchronous for immediate feedback
