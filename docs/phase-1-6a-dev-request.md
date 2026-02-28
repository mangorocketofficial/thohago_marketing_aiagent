# Phase 1-6a Development Request
## Ddohago - Onboarding Foundation, Account Auth, and Flow Skeleton (v1.0)

---

## Overview

Phase 1-6 is split into **1-6a** and **1-6b** to reduce delivery risk.

Phase **1-6a** delivers the onboarding foundation on top of the **current repository implementation**:

- Electron desktop runtime in `apps/desktop`
- Existing local config storage in `apps/desktop/electron/config-store.mjs` (`desktop-config.json`)
- Existing API app in `apps/api`

Primary goal for 1-6a:

- Ship a stable first-run onboarding shell with account auth, URL intake, folder setup, and tutorial handoff.
- Establish a stronger auth/security baseline before review/crawling logic is added in 1-6b.

**Depends on:** Phase 1-5b (Frontend Integration)

---

## Why 1-6 Was Split

The original single phase combined too many concerns at once:

- i18n + multi-step onboarding UI
- account auth
- crawling and AI analysis
- interview flow
- result synthesis
- folder setup and runtime activation

Splitting makes quality gates and debugging practical:

- **1-6a** = foundation, auth, step framework
- **1-6b** = real brand review pipeline and result synthesis

---

## Target User Journey for 1-6a

This is the intended end-state journey, with 1-6a coverage marked:

0. Ddo-Daeri introduction (implemented in 1-6a)
1. Account creation/login (email + Google) (implemented in 1-6a)
2. URL input (website/blog/instagram/facebook/threads) (implemented in 1-6a)
3. Brand review (website + Naver Blog crawl) (placeholder state in 1-6a, real in 1-6b)
4. Interview (4 questions while review runs) (placeholder state in 1-6a, real in 1-6b)
5. Result document generation (review + interview synthesis) (placeholder state in 1-6a, real in 1-6b)
6. Marketing folder setup (implemented in 1-6a)
7. Summary and tutorial (implemented in 1-6a; real synthesized content wired in 1-6b)

---

## Core Decisions

1. **Keep current local storage approach.**
   Do not switch to `electron-store` for this phase. Extend `desktop-config.json` via `config-store.mjs`.
2. **Auth is required before onboarding data write.**
   Step 1 is mandatory and comes before URL input.
3. **Google auth uses system browser OAuth.**
   Use external browser + loopback callback (no embedded webview login).
4. **Org context is established during Step 1.**
   After auth, create/select organization and persist `orgId`.
5. **User routes move to Bearer JWT auth.**
   `x-api-token` remains only for internal machine-to-machine paths.
6. **Node 18 built-in fetch standard.**
   No `node-fetch` dependency is introduced.

---

## Objectives

- [ ] Implement onboarding route/controller structure in renderer with steps `0..7`
- [ ] Add i18n foundation (`react-i18next`) and KO/EN toggle at onboarding level
- [ ] Implement Step 1 account auth UX:
  - [ ] Email sign-up/sign-in
  - [ ] Google OAuth via system browser
- [ ] Implement org bootstrap after sign-in (create/select organization, persist `orgId`)
- [ ] Implement Step 2 URL form and draft persistence
- [ ] Implement Step 6 folder setup using existing native dialogs
- [ ] Implement Step 7 summary/tutorial shell
- [ ] Add secure session/token handling for desktop runtime
- [ ] Add JWT-based user auth middleware in API for onboarding routes
- [ ] Keep `pnpm type-check` and `pnpm build` passing

---

## 1. UI Scope (`apps/desktop/src`)

### New onboarding shell

- Add a dedicated onboarding state flow separate from dashboard rendering.
- Keep current watcher runtime behavior intact outside onboarding.

### Step components (1-6a)

- `Step0Intro`
- `Step1AccountAuth`
- `Step2UrlInput`
- `Step3BrandReviewPlaceholder`
- `Step4InterviewPlaceholder`
- `Step5ResultPlaceholder`
- `Step6FolderSetup`
- `Step7SummaryTutorial`

### i18n foundation

- Add:
  - `apps/desktop/src/i18n/index.ts`
  - `apps/desktop/src/i18n/locales/ko.json`
  - `apps/desktop/src/i18n/locales/en.json`
- Apply onboarding strings through i18n keys only.

---

## 2. Auth and Org Bootstrap

### Step 1 functional requirements

- Email sign-up/sign-in
- Google sign-in
- Sign-out
- Session restore on relaunch

### Org bootstrap requirements

- After successful auth:
  - Resolve existing org membership for user.
  - If none exists, create initial org and owner membership.
  - Persist selected `orgId` in desktop config.

### Security baseline

- Do not store raw passwords anywhere in desktop files.
- Store long-lived auth secrets via OS-secure storage mechanism (for example, keychain/keytar).
- `desktop-config.json` stores non-secret runtime state only.

---

## 3. API Security Hardening (1-6a baseline)

### New middleware

- `requireUserJwt`:
  - Read `Authorization: Bearer <access_token>`
  - Validate token/user through Supabase auth APIs
- `requireOrgMembership`:
  - Ensure authenticated user belongs to target `org_id`

### Route policy split

- Internal machine relay routes may keep `x-api-token` (`/trigger` class routes).
- User-facing onboarding/auth routes must require Bearer JWT + membership checks.

### Input validation

- Add strict schema validation for onboarding payloads (URLs, org IDs, step transitions).
- Reject oversized or malformed payloads early.

---

## 4. Desktop Main Process / IPC Updates

### Keep and extend current channels

- Reuse current onboarding/watcher channels where possible.
- Add auth-focused channels for:
  - start OAuth in system browser
  - complete OAuth callback exchange
  - email auth actions
  - session status retrieval

### Folder setup compatibility

- Keep using existing folder selection/create dialogs in `electron/main.mjs`.
- Integrate folder setup into step flow without breaking watcher startup logic.

---

## 5. Config Storage (Current-Code Compatible)

Extend `desktop-config.json` shape (via `config-store.mjs`) with non-secret keys:

```json
{
  "watchPath": "",
  "orgId": "",
  "language": "ko",
  "onboardingCompleted": false,
  "onboardingDraft": {
    "websiteUrl": "",
    "naverBlogUrl": "",
    "instagramUrl": "",
    "facebookUrl": "",
    "threadsUrl": ""
  }
}
```

Notes:

- Secrets/tokens are not persisted in this file.
- This keeps compatibility with existing `watchPath`/`orgId` behavior.

---

## 6. Shared Types (1-6a additions)

Add onboarding/auth baseline types to `packages/types/src/index.ts`:

- `OnboardingStep` (`intro`, `account_auth`, `url_input`, `brand_review`, `interview`, `result_doc`, `folder_setup`, `summary_tutorial`)
- `OnboardingDraftUrls`
- `AuthSessionSummary`

No crawling payload types are required yet in 1-6a.

---

## 7. Acceptance Criteria (1-6a)

- [ ] Fresh launch enters onboarding step 0.
- [ ] KO/EN toggle updates onboarding UI text immediately.
- [ ] Step 1 supports email auth and Google auth.
- [ ] After Step 1, `orgId` is resolved/created and available in runtime.
- [ ] Step 2 validates URLs and saves draft state.
- [ ] Steps 3/4/5 render as placeholders without blocking navigation.
- [ ] Step 6 folder setup uses native dialogs and saves `watchPath`.
- [ ] Step 7 tutorial summary renders and final action sets `onboardingCompleted = true`.
- [ ] Relaunch skips onboarding when completed and loads main dashboard.
- [ ] User-facing onboarding routes reject missing/invalid Bearer JWT.
- [ ] `pnpm type-check` passes.
- [ ] `pnpm build` passes.

---

## 8. Out of Scope (1-6a)

- Real website/blog crawling
- Real interview persistence
- Real review/result synthesis
- Instagram/Facebook/Threads data extraction
- Final production copy and visual polish

---

*Document version: v1.0*
*Phase: 1-6a Onboarding Foundation, Auth, and Flow Skeleton*
*Depends on: Phase 1-5b (Frontend Integration)*
*Date: 2026-02-28*
