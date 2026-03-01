# Phase 1-7b Development Request
## Ddohago - Instagram Best-Effort Integration and Cross-Channel Quality Hardening (v1.0)

---

## Overview

Phase **1-7b** completes the advanced brand review quality target on top of 1-7a by adding optional Instagram ingestion and full cross-channel consistency analysis.

1-7b must still preserve 1-7a compatibility:

- same onboarding route: `POST /onboarding/synthesize`
- same persistence table: `public.org_brand_settings`
- same non-breaking type strategy

Reference style and expected review quality:
`docs/월드프렌즈코리아_브랜드리뷰.md`

**Depends on:** Phase 1-7a (Brand Review Markdown Foundation)

---

## Core Decisions for 1-7b

1. **Instagram is best-effort and optional.**
   Onboarding must never block due to Instagram failure.
2. **No Electron webview/extension login flow for crawling.**
   Use HTTP fetch + HTML parsing fallback only for public data.
3. **Endpoint and schema remain stable.**
   Continue extending `POST /onboarding/synthesize` and existing JSONB output model.
4. **Two-model synthesis flow remains.**
   - Main markdown generation: Claude Opus
   - Structured profile extraction from markdown: `gpt-4o-mini`
5. **No "regenerate" onboarding action.**
   Keep one-way completion flow in onboarding.
6. **Node 18 built-in fetch only.**
   Do not add `node-fetch`.

---

## Final User Journey Covered in 1-7b

0. Ddo-Daeri introduction
1. Account creation/login
2. URL input
3. Crawl: website + Naver Blog + optional Instagram best-effort
4. Interview (4 questions)
5. Cross-channel markdown review synthesis
6. Marketing folder setup
7. Summary/tutorial

---

## Objectives

- [ ] Add optional Instagram crawler module and integrate into onboarding crawl orchestration
- [ ] Feed 3-channel crawl outputs into synthesis while preserving graceful degradation
- [ ] Upgrade markdown prompt/output to include cross-channel consistency and compliance sections
- [ ] Maintain backward-compatible storage and API contracts from 1-7a
- [ ] Keep quality gate measurable and repeatable
- [ ] Keep `pnpm type-check` and `pnpm build` passing

---

## 1. Instagram Crawler (Best-Effort)

### Module

`apps/desktop/electron/crawler/instagram.mjs`

### Crawl sequence

1. Attempt JSON endpoint:
   `https://www.instagram.com/{username}/?__a=1&__d=dis`
2. If blocked/fails, fallback to profile HTML extraction:
   - meta description
   - og tags
3. If both fail, return minimal username-only payload

### Status model

- `done`: profile + recent post metadata available
- `partial`: limited metadata available
- `failed`: username-only or null payload

### Non-blocking rule

Instagram errors must not fail onboarding synthesis.

---

## 2. Crawl Coordinator Extension

Update crawler orchestration (`crawler/index.mjs`) to support optional Instagram source:

- include source when Instagram URL is present
- keep status lifecycle (`pending | running | done | failed | skipped`)
- preserve existing parallel behavior for website and Naver Blog
- cap payload size before API submission

---

## 3. Synthesis Upgrade (3-Channel)

### Route

- Keep: `POST /onboarding/synthesize`
- Add optional `synthesis_mode: "phase_1_7b"`

### Prompt/output requirements

Generated markdown must include:

- channel-level analysis for website, Instagram, Naver Blog
- cross-channel consistency analysis
- legal/compliance flags (NGO/social venture context)
- before/after edit proposals
- strategy recommendations with difficulty levels
- explicit data coverage and limitation notice

### Model policy

- Markdown generation: Claude Opus
- Structured `brand_profile` extraction from markdown: `gpt-4o-mini`

---

## 4. Storage and Type Compatibility

Persist outputs into existing schema and columns:

- keep using `org_brand_settings.result_document` JSONB
- include `version: "phase_1_7b"` metadata
- include per-source crawl status in result metadata

Add only optional shared-type fields if needed for Instagram status/profile summaries.
No breaking field removal or rename is allowed.

---

## 5. UI Scope (Step 5 and Summary)

- Continue rendering markdown via `react-markdown`
- Show source coverage badges (website/naver/instagram status)
- Show guidance text for partial/failed Instagram crawl
- Keep forward-only action set
- **Do not add "다시 생성하기"**

---

## 6. Validation and Safety

- Enforce strict URL and payload bounds for Instagram input/output
- Add timeout and retry caps for Instagram crawl
- Sanitize large/unsafe HTML text before model submission
- Keep JWT + org membership enforcement unchanged

---

## 7. Acceptance Criteria (1-7b)

- [ ] Optional Instagram URL triggers Instagram crawl attempt
- [ ] Instagram crawl gracefully falls back: `done -> partial -> failed`
- [ ] `POST /onboarding/synthesize` accepts 3-channel crawl payload (with optional Instagram)
- [ ] Markdown output includes all required sections and coverage notices
- [ ] Cross-channel consistency section is present and meaningful
- [ ] Legal/compliance flags section includes NGO-relevant checks
- [ ] Step B extraction uses `gpt-4o-mini` for structured `brand_profile`
- [ ] Data persists without schema-breaking migration
- [ ] Step 5 shows markdown + source status indicators
- [ ] No regenerate action appears in onboarding flow
- [ ] Instagram failure never blocks onboarding completion
- [ ] `pnpm type-check` passes
- [ ] `pnpm build` passes

### Quality Gate

Run full onboarding with test data and verify:

- [ ] At least 5 issues across channel issue tables
- [ ] At least 1 before/after suggestion per analyzed channel
- [ ] At least 5 strategy recommendations with difficulty labels
- [ ] Cross-channel consistency analysis is present
- [ ] Data limitation notice is present for partial/failed Instagram cases

---

## 8. Out of Scope (1-7b)

- Facebook crawling
- YouTube crawling
- Scheduled re-audit jobs
- Settings-triggered re-run UX
- Competitor analysis
- Engagement-rate analytics requiring deeper private post data

---

*Document version: v1.0*
*Phase: 1-7b Instagram Best-Effort + Cross-Channel Quality Hardening*
*Depends on: Phase 1-7a (Brand Review Markdown Foundation)*
*Reference output: docs/월드프렌즈코리아_브랜드리뷰.md*
*Date: 2026-03-01*

