# Phase 1-6b Development Request
## Ddohago - Brand Review, Interview Concurrency, and Result Synthesis (v1.0)

---

## Overview

Phase **1-6b** completes the real onboarding intelligence pipeline on top of 1-6a.

Primary goal for 1-6b:

- Turn placeholder steps 3/4/5 into production MVP behavior.
- Generate a structured onboarding result document by combining:
  - crawl-based brand review
  - live user interview answers

**Depends on:** Phase 1-6a (Onboarding Foundation, Account Auth, and Flow Skeleton)

---

## Final User Journey Covered in 1-6b

0. Ddo-Daeri introduction
1. Account creation/login (email + Google)
2. URL input (website/blog/instagram/facebook/threads)
3. Brand review (website + Naver Blog crawling)
4. Interview (4 questions while review is running)
5. Result document generation (review + interview synthesis)
6. Marketing folder setup
7. Summary and tutorial

---

## Core MVP Rules

1. **No Instagram crawling in MVP.**
   Instagram/Facebook/Threads URLs are collected and stored only.
2. **Brand review sources are fixed.**
   Crawl only:
   - website URL
   - Naver Blog URL
3. **Crawl is best-effort and non-blocking.**
   Any source failure must not stop onboarding.
4. **Interview runs concurrently with crawl.**
   The user should answer questions while background review progresses.
5. **Node 18 built-in fetch only.**
   Do not add `node-fetch`.
6. **Security remains JWT-first.**
   User onboarding endpoints require Bearer JWT and org membership checks.

---

## Objectives

- [ ] Implement real Step 3 crawler orchestration in Electron main process
- [ ] Implement real Step 4 interview flow and incremental answer persistence
- [ ] Implement Step 5 synthesis endpoint and result document generation
- [ ] Persist consolidated onboarding output to Supabase (`org_brand_settings`)
- [ ] Wire synthesized output into Step 7 summary/tutorial
- [ ] Keep onboarding resilient under partial crawl failure
- [ ] Keep `pnpm type-check` and `pnpm build` passing

---

## 1. Crawling Implementation (Electron Main)

### Module structure

```text
apps/desktop/electron/crawler/
  index.mjs
  website.mjs
  naver-blog.mjs
```

No `instagram.mjs` in MVP 1-6b.

### Runtime requirements

- Use global `fetch` from Node 18 runtime.
- Parse HTML with `cheerio`.
- Extract compact, bounded text payloads:
  - website title/meta/headings/paragraphs
  - Naver blog recent post snippets (best-effort)

### Progress and failure model

- Emit per-source progress updates to renderer.
- Track source status as `pending | running | done | failed | skipped`.
- Continue flow when one source fails.

---

## 2. Interview Flow (Concurrent with Crawl)

### Question set (fixed, 4 questions)

1. Tone confirmation
2. Primary audience
3. Forbidden words/topics
4. Campaign seasonality

### Behavior

- Interview starts immediately after Step 3 starts.
- Answers are persisted incrementally (after each user response).
- If crawl has not completed by Q4, show progress and continue waiting.
- If crawl completes early, proceed without interrupting interview.

---

## 3. Result Synthesis and Document Generation

### New API route

- `POST /onboarding/synthesize`

### Request (logical)

- `org_id`
- `crawl_result` (website + naver blog status/data)
- `interview_answers`
- optional URL metadata (instagram/facebook/threads links)

### Response (logical)

- `brand_profile`
- `onboarding_result_document`

### Result document shape

The generated document should include:

- organization summary
- detected tone + suggested tone guardrails
- key themes
- target audience
- forbidden words/topics
- campaign season hints
- recommended initial content directions
- known data gaps and confidence notes

---

## 4. Database Changes

### Migration file

`supabase/migrations/20260228150000_phase_1_6b_brand_settings.sql`

### Table

Create or update `public.org_brand_settings` with:

- org identity:
  - `org_id` (unique)
- input URLs:
  - `website_url`
  - `naver_blog_url`
  - `instagram_url`
  - `facebook_url`
  - `threads_url`
- crawl fields:
  - `crawl_status` (jsonb)
  - `crawl_payload` (jsonb, bounded)
- interview fields:
  - `interview_answers` (jsonb)
- synthesized output:
  - `detected_tone`
  - `tone_description`
  - `target_audience` (jsonb)
  - `key_themes` (jsonb)
  - `forbidden_words` (jsonb)
  - `forbidden_topics` (jsonb)
  - `campaign_seasons` (jsonb)
  - `brand_summary`
  - `result_document` (text or jsonb)
- timestamps:
  - `created_at`, `updated_at`

### Security policy

- Enable RLS.
- Policy: org members can read/write rows for their `org_id`.
- Upsert by `org_id` only.

---

## 5. API Security and Validation

### Required guards

- `requireUserJwt` on onboarding user routes
- org membership enforcement on all `org_id` writes
- strict payload schemas and size limits for crawl/interview/synthesis requests

### Secrets and keys

- Renderer must not use service-role keys.
- Service-role remains server-side only.
- Internal `x-api-token` routes stay scoped to machine relay paths, not onboarding synthesis.

---

## 6. Shared Types (1-6b additions)

Add to `packages/types/src/index.ts`:

- `CrawlSourceStatus`
- `OnboardingCrawlStatus`
- `InterviewAnswers`
- `BrandProfile`
- `OnboardingResultDocument`
- `OrgBrandSettings`

These types must be used by both renderer and API response contracts.

---

## 7. Acceptance Criteria (1-6b)

- [ ] Step 3 performs real website + Naver Blog crawl with progress updates.
- [ ] Instagram/Facebook/Threads are stored as URLs only (not crawled).
- [ ] Step 4 asks all 4 interview questions and saves each answer incrementally.
- [ ] Step 3 and Step 4 can run concurrently without UI deadlock.
- [ ] Crawl failure of one source does not block onboarding completion.
- [ ] Step 5 generates a structured result document from crawl + interview inputs.
- [ ] Result is upserted into `org_brand_settings` for the authenticated org.
- [ ] Step 7 summary shows synthesized data (not placeholder text).
- [ ] User-facing onboarding routes reject unauthorized or cross-org requests.
- [ ] Runtime uses Node 18 built-in `fetch` (no `node-fetch` dependency).
- [ ] `pnpm type-check` passes.
- [ ] `pnpm build` passes.
- [ ] Migration applies cleanly after 1-6a baseline.

---

## 8. Out of Scope (1-6b)

- Instagram content crawling
- Facebook/Threads crawling
- Meta publishing integration
- Brand review re-entry management screens
- Advanced analytics dashboards

---

*Document version: v1.0*
*Phase: 1-6b Brand Review, Interview Concurrency, and Result Synthesis*
*Depends on: Phase 1-6a (Onboarding Foundation, Account Auth, and Flow Skeleton)*
*Date: 2026-02-28*
