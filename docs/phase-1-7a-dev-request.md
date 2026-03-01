# Phase 1-7a Development Request
## Ddohago - Brand Review Markdown Foundation on Existing Contracts (v1.0)

---

## Overview

Phase 1-7 is split into **1-7a** and **1-7b**.

Phase **1-7a** upgrades the current onboarding synthesis from heuristic JSON output to a high-quality Korean Markdown brand review, while strictly following the **current repository contracts**:

- existing API route: `POST /onboarding/synthesize`
- existing table: `public.org_brand_settings`
- existing shared types (`BrandProfile`, `OnboardingResultDocument`)

Reference style and section quality must follow:
`docs/월드프렌즈코리아_브랜드리뷰.md`

**Depends on:** Phase 1-6b (Brand Review + Interview + Synthesis MVP)

---

## Why 1-7 Was Split

The original 1-7 scope was too large for one delivery unit:

- crawl upgrades
- report-quality prompt engineering
- dual-model extraction flow
- renderer markdown UX
- storage/export behavior
- security and validation hardening

Split strategy:

- **1-7a** = contract-safe markdown pipeline for website + Naver Blog
- **1-7b** = Instagram best-effort integration + cross-channel quality hardening

---

## Core Decisions for 1-7a

1. **Keep endpoint compatibility.**
   Extend existing `POST /onboarding/synthesize`; do not add a new route.
2. **Keep DB schema compatibility.**
   No breaking schema change. Reuse `org_brand_settings` and store markdown under JSONB `result_document`.
3. **No "regenerate" action in Step 5.**
   The onboarding flow has a single forward path in this phase.
4. **Two-model synthesis flow.**
   - Main review markdown generation: Claude Opus (current API model config)
   - Structured `brand_profile` extraction from generated markdown: `gpt-4o-mini`
5. **Node 18 built-in fetch only.**
   Do not add `node-fetch`.
6. **Security remains JWT-first.**
   Keep `requireUserJwt` + org membership checks for user-facing onboarding routes.

---

## Final User Journey Covered in 1-7a

0. Ddo-Daeri introduction
1. Account creation/login (email + Google)
2. URL input (website/blog/instagram/facebook/youtube/threads)
3. Brand review crawl (website + Naver Blog only)
4. Interview (4 questions)
5. Markdown review synthesis (new in 1-7a)
6. Marketing folder setup
7. Summary/tutorial with synthesized outputs

---

## Objectives

- [ ] Upgrade synthesis in `POST /onboarding/synthesize` to produce review markdown + structured profile
- [ ] Render markdown result in onboarding Step 5 using `react-markdown`
- [ ] Persist markdown output into existing `org_brand_settings.result_document` JSONB (non-breaking)
- [ ] Export markdown to local watch folder when configured
- [ ] Preserve backward compatibility for existing `brand_profile` and `onboarding_result_document`
- [ ] Keep `pnpm type-check` and `pnpm build` passing

---

## 1. API Contract Upgrade (Backward-Compatible)

### Route

- Keep: `POST /onboarding/synthesize`

### Request extension

- Continue accepting:
  - `org_id`
  - `crawl_result`
  - `interview_answers` (`q1..q4`)
  - `url_metadata`
- Add optional:
  - `synthesis_mode: "phase_1_7a"`

### Response extension

- Keep current response keys:
  - `brand_profile`
  - `onboarding_result_document`
- Add optional key:
  - `review_markdown`

No required field removal or rename is allowed in 1-7a.

---

## 2. Synthesis Pipeline (Model Split)

### Step A: Markdown generation

- Input:
  - org metadata
  - website + Naver crawl outputs
  - interview answers
  - explicit data-gap notices for failed/skipped sources
- Output:
  - Korean markdown review with section structure aligned to `docs/월드프렌즈코리아_브랜드리뷰.md`
- Model:
  - Claude Opus (from existing model configuration)

### Step B: Structured profile extraction

- Input:
  - generated markdown from Step A
- Output:
  - structured JSON mapped into existing `BrandProfile` contract
- Model:
  - `gpt-4o-mini`

### Fallback behavior

- If Step A fails: return current heuristic synthesis output path (non-fatal onboarding completion).
- If Step B fails: keep markdown and synthesize a safe fallback profile from existing heuristic logic.

---

## 3. Storage and Export (Current Schema First)

Persist with existing table and columns:

- `org_brand_settings.detected_tone`
- `org_brand_settings.tone_description`
- `org_brand_settings.target_audience`
- `org_brand_settings.key_themes`
- `org_brand_settings.forbidden_words`
- `org_brand_settings.forbidden_topics`
- `org_brand_settings.campaign_seasons`
- `org_brand_settings.brand_summary`
- `org_brand_settings.result_document` (JSONB)

Recommended `result_document` shape:

```json
{
  "version": "phase_1_7a",
  "format": "markdown",
  "review_markdown": "...",
  "template_ref": "docs/월드프렌즈코리아_브랜드리뷰.md",
  "generated_at": "2026-03-01T00:00:00.000Z",
  "data_coverage_notice": "..."
}
```

Local export:

- write `{watchPath}/브랜드리뷰_{YYYY-MM-DD}.md` if `watchPath` exists
- if missing watchPath, skip silently

---

## 4. Renderer Scope (Step 5)

- Install/use `react-markdown`
- Replace JSON-only synthesis preview with readable markdown viewer
- Show metadata:
  - generated time
  - coverage note
  - save/export status
- Keep navigation action as single forward action
- **Do not add "다시 생성하기" button**

---

## 5. Security, Validation, and Guardrails

- Keep `requireUserJwt` and org membership checks on all writes
- Keep payload size guardrails for crawl and synthesis inputs
- Apply text bounds before model calls (truncate/sanitize large crawl text blobs)
- Never expose service-role keys to renderer

---

## 6. Shared Types (Additive Only)

Add optional fields without breaking old consumers:

- `OnboardingResultDocument.review_markdown?: string`
- `OnboardingResultDocument.report_version?: "phase_1_7a"`
- `OnboardingResultDocument.template_ref?: "월드프렌즈코리아_브랜드리뷰.md"`
- `OnboardingResultDocument.data_coverage_notice?: string`
- `BrandProfile.channel_roles?: { website?: string; naver_blog?: string; instagram?: string }`
- `BrandProfile.top_priorities?: string[]`
- `BrandProfile.suggested_hashtags?: string[]`

Do not rename existing fields like `detected_tone`, `organization_summary`, or `confidence_notes`.

---

## 7. Acceptance Criteria (1-7a)

- [ ] Existing route `POST /onboarding/synthesize` is extended without breaking old clients
- [ ] Markdown review is generated for website + Naver Blog inputs
- [ ] Step B extraction uses `gpt-4o-mini` for structured `brand_profile` derivation
- [ ] Result persists into existing `org_brand_settings` columns without schema-breaking migration
- [ ] `result_document` JSONB contains markdown payload and metadata
- [ ] Step 5 renders markdown with `react-markdown`
- [ ] No "regenerate" button is present in Step 5
- [ ] Local export works when `watchPath` is configured
- [ ] Partial crawl failure does not block onboarding completion
- [ ] `pnpm type-check` passes
- [ ] `pnpm build` passes

---

## 8. Out of Scope (1-7a)

- Instagram crawling
- Facebook/YouTube/Threads crawling
- Scheduled periodic re-audit
- Settings-screen re-run actions
- Competitor analysis

---

*Document version: v1.0*
*Phase: 1-7a Brand Review Markdown Foundation*
*Depends on: Phase 1-6b (Brand Review + Interview + Synthesis MVP)*
*Reference output: docs/월드프렌즈코리아_브랜드리뷰.md*
*Date: 2026-03-01*

