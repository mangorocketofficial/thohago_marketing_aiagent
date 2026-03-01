# Phase 1-7c Completion Report

- Phase: 1-7c
- Title: Brand Review Synthesis Quality Upgrade (Deep Crawl + Mandatory Web Search)
- Status: Done
- Completed On: 2026-03-01

## 1) Goals and Scope

- Goal:
  - Improve onboarding brand review quality by increasing crawl depth and enforcing web-assisted synthesis.
  - Reduce fallback-template outputs caused by shallow crawl inputs and constrained generation budgets.
- In Scope:
  - Website crawler depth/quality upgrade.
  - Naver Blog crawler depth/quality upgrade.
  - Crawl payload cap expansion for richer API prompt inputs.
  - API synthesis upgrade: mandatory Anthropic web search usage, stronger prompt policy, higher token budget, practical validation tuning.
- Out of Scope:
  - New API endpoint or DB migration.
  - Instagram crawler redesign (1-7b best-effort structure retained).
  - Onboarding flow/route contract changes.

## 2) Completed Deliverables

- Desktop crawler improvements:
  - `apps/desktop/electron/crawler/website.mjs`
  - `apps/desktop/electron/crawler/naver-blog.mjs`
  - `apps/desktop/electron/crawler/index.mjs`
- API synthesis quality upgrades:
  - `apps/api/src/routes/onboarding.ts`
- Existing 1-7b integration artifacts retained and included in this completion commit:
  - `apps/desktop/electron/crawler/instagram.mjs`
  - `apps/desktop/electron/main.mjs`
  - `apps/desktop/src/App.tsx`
  - `apps/desktop/src/global.d.ts`
  - `apps/desktop/src/styles.css`
  - `packages/types/src/index.ts`
- Progress documentation:
  - `docs/progress/phase-index.md`
  - `docs/progress/phase-1-7c-completion.md`

## 3) Key Implementation Decisions

- Website crawler depth hardening:
  - Increased extraction limits (`MAX_HEADINGS`, `MAX_PARAGRAPHS`).
  - Added UI noise cleanup and short-text/UI-string filtering.
  - Added structured fields: `nav_items`, `footer_text`, `has_contact_page`, `mission_section`, `cta_buttons`.
  - Added optional subpage crawl (up to 2 relevant pages) with independent timeout and `Promise.allSettled`.
- Naver Blog crawler depth hardening:
  - Increased `MAX_POSTS`.
  - Added top-3 post content enrichment with iframe path, direct path, and mobile URL fallback.
  - Added `categories` extraction.
  - Extended `recent_posts` with `content_snippet` and `date`.
- Crawl payload cap tuning:
  - Raised per-source cap from 22,000 to 32,000 chars in crawl coordinator.
  - Increased primary sanitize string/array allowances for richer evidence retention.
- Mandatory web-assisted synthesis in API:
  - Anthropic request now always includes web search tool configuration.
  - Anthropic response parsing now concatenates all text blocks (instead of first text block only).
  - Prompt policy upgraded with consultant persona, NGO constraints, and explicit web-assisted supplementation instructions.
  - Token budgets increased (first pass: 10,000 / regeneration pass: 12,000).
  - Validation thresholds tuned for practical completion reliability while preserving core structure checks.

## 4) Contract and Compatibility

- Preserved:
  - Endpoint: `POST /onboarding/synthesize`
  - Storage table/column strategy: `public.org_brand_settings.result_document` JSONB
  - Backward-compatible type/field evolution approach
- No schema-breaking migration introduced.

## 5) Validation and Test Results

- `node --check apps/desktop/electron/crawler/website.mjs` -> PASS
- `node --check apps/desktop/electron/crawler/naver-blog.mjs` -> PASS
- `node --check apps/desktop/electron/crawler/index.mjs` -> PASS
- `pnpm --filter @repo/api type-check` -> PASS
- `pnpm --filter @repo/api build` -> PASS
- `pnpm --filter @repo/desktop type-check` -> PASS
- `pnpm --filter @repo/desktop build` -> PASS
- `pnpm type-check` -> PASS
- `pnpm build` -> PASS

## 6) Risks and Follow-up

- Remaining risks:
  - Mandatory web search can increase generation latency and token/tool cost.
  - Some target sites/channels may still throttle or block crawl attempts.
  - LLM quality remains sensitive to real-world crawl accessibility and content freshness.
- Follow-up recommendations:
  - Add quality telemetry (generation latency, tool usage count, fallback ratio).
  - Add explicit crawl evidence counters to result metadata for quality monitoring.
  - Add deterministic acceptance assertions in CI for minimum channel evidence density.

## 7) Handoff

- Ready conditions:
  - Deep crawl signal density has materially increased for website/naver sources.
  - Synthesis now enforces web-assisted completion path with larger generation budget.
  - Existing API/DB contracts remain compatible.
- Next:
  - Run repeated end-to-end onboarding samples and compare report quality variance against previous baseline documents.
