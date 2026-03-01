# Phase 1-7a Completion Report

- Phase: 1-7a
- Title: Brand Review Markdown Foundation (Contract-Safe)
- Status: Done
- Completed On: 2026-03-01

## 1) Goals and Scope

- Goal:
  - Upgrade onboarding synthesis from heuristic-only JSON to readable Korean markdown brand review.
  - Keep API/DB contracts backward-compatible with existing Phase 1-6b runtime.
- In Scope:
  - Extend existing `POST /onboarding/synthesize` route (no new endpoint).
  - Generate markdown review + structured `brand_profile` extraction.
  - Render markdown in onboarding Step 5.
  - Export markdown to local watch folder when available.
  - Add truncation guard for incomplete/partial LLM outputs.
- Out of Scope:
  - Instagram crawler integration (planned for 1-7b).
  - Facebook/YouTube/Threads crawling.
  - Settings-triggered re-run UX.

## 2) Completed Deliverables

- API synthesis pipeline upgrade:
  - `apps/api/src/routes/onboarding.ts`
  - `apps/api/src/lib/env.ts`
- Desktop onboarding/runtime integration:
  - `apps/desktop/electron/main.mjs`
  - `apps/desktop/src/App.tsx`
  - `apps/desktop/src/global.d.ts`
  - `apps/desktop/src/styles.css`
  - `apps/desktop/package.json`
- Shared types and deps:
  - `packages/types/src/index.ts`
  - `pnpm-lock.yaml`
- Planning/phase docs:
  - `docs/phase-1-7-dev-request.md`
  - `docs/phase-1-7a-dev-request.md`
  - `docs/phase-1-7b-dev-request.md`
  - `docs/월드프렌즈코리아_브랜드리뷰.md`

## 3) Key Implementation Decisions

- Contract-safe extension:
  - Kept `POST /onboarding/synthesize`.
  - Kept `org_brand_settings` schema unchanged.
  - Stored markdown in `result_document.review_markdown` (JSONB).
- Two-step model flow:
  - Step A: markdown review generation via Anthropic model config.
  - Step B: structured `brand_profile` extraction via OpenAI (`gpt-4o-mini` default).
- Step 5 UX:
  - Removed manual regenerate button from onboarding step 5.
  - Added markdown preview renderer (`react-markdown`).
- Local export:
  - Exports `브랜드리뷰_YYYY-MM-DD.md` to watch folder if available.
  - Retries export at onboarding completion when watch path is set after synthesis.

## 4) Truncation Prevention Guard

Added completion guard in synthesis flow to prevent partial markdown from being persisted:

- Validate generated markdown for:
  - required section headings
  - heading order
  - balanced code fences
  - minimum body length/section count
- If validation fails:
  - run one regeneration attempt with strict corrective prompt
- If still invalid:
  - fallback to deterministic complete markdown template output

This prevents broken documents (missing ending section or unclosed code block) from final storage/export.

## 5) Validation and Test Results

- `pnpm --filter @repo/api type-check` -> PASS
- `pnpm --filter @repo/api build` -> PASS
- `pnpm --filter @repo/desktop type-check` -> PASS
- `pnpm --filter @repo/desktop build` -> PASS
- `pnpm type-check` -> PASS
- `pnpm build` -> PASS

Manual checks:

- Step 5 now displays markdown result body.
- Step 5 has no regenerate action.
- API response includes `review_markdown` and `onboarding_result_document.review_markdown`.
- Local markdown export works when watchPath is configured.

## 6) Risks and Follow-up

- Remaining risks:
  - Crawl depth is still shallow (website/naver main-page-centric in 1-7a).
  - Instagram section remains limited by 1-7a scope.
  - LLM quality still depends on input crawl coverage.
- Follow-up recommendation (1-7b):
  - Add Instagram best-effort crawler and 3-channel consistency depth.
  - Add stronger crawl evidence blocks (status, source counts, fetch result reason).
  - Add post-generation quality gate assertions for minimum issue counts per channel.

## 7) Handoff to Next Phase

- Ready conditions:
  - 1-7a markdown synthesis is operational end-to-end.
  - Existing runtime contracts remain compatible.
  - Truncation/partial-output guard is in place.
- Next:
  - Phase 1-7b: Instagram best-effort integration + cross-channel depth hardening.

