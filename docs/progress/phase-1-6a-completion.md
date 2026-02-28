# Phase 1-6a Completion Report

- Phase: 1-6a
- Title: Onboarding UX + Auth Hardening
- Status: Done
- Completed On: 2026-02-28

## 1) Goals and Scope

- Goal:
  - Deliver onboarding skeleton for steps `0..7` with bilingual UI.
  - Add desktop-friendly account flow (email/password + Google OAuth).
  - Persist onboarding draft/config and connect authenticated users to org bootstrap.
- In Scope:
  - i18n setup (`ko`/`en`) and onboarding step UI.
  - Supabase auth integration in desktop renderer/main process.
  - New API route for authenticated org bootstrap.
  - Onboarding draft persistence and folder setup flow.
- Out of Scope:
  - Full crawling/analysis orchestration (moved to 1-6b).
  - Instagram production-grade crawling strategy.

## 2) Completed Deliverables

- Onboarding and renderer UX:
  - `apps/desktop/src/App.tsx`
  - `apps/desktop/src/styles.css`
  - `apps/desktop/src/main.tsx`
  - `apps/desktop/src/global.d.ts`
- i18n:
  - `apps/desktop/src/i18n/index.ts`
  - `apps/desktop/src/i18n/locales/en.json`
  - `apps/desktop/src/i18n/locales/ko.json`
- Electron runtime/auth:
  - `apps/desktop/electron/main.mjs`
  - `apps/desktop/electron/preload.mjs`
  - `apps/desktop/electron/preload.cjs`
  - `apps/desktop/electron/config-store.mjs`
  - `apps/desktop/electron/secure-auth-store.mjs`
- API/auth bootstrap:
  - `apps/api/src/lib/auth.ts`
  - `apps/api/src/routes/onboarding.ts`
  - `apps/api/src/index.ts`
- Shared types/deps/config:
  - `packages/types/src/index.ts`
  - `apps/desktop/package.json`
  - `pnpm-lock.yaml`
  - `.env.example`

## 3) Key Implementation Decisions

- OAuth execution model:
  - Use system browser + local callback server (`127.0.0.1`) instead of Electron embedded webview.
- OAuth robustness:
  - Support PKCE code callback, hash-token fallback, detailed callback diagnostics, configurable host/port/timeout.
  - Remove manual `state` injection to avoid Supabase `bad_oauth_state` mismatch.
- Auth storage:
  - Persist secure auth session via `electron.safeStorage`, with in-memory fallback if OS encryption is unavailable.
- Onboarding resilience:
  - If org bootstrap fails, onboarding can continue to next step with notice, preventing hard UI deadlock.
- URL policy adjustment:
  - Website is optional (not required).
  - Added `YouTube URL` field to onboarding draft and UI.

## 4) Validation and Test Results

- `pnpm type-check` -> PASS
- `pnpm build` -> PASS
- Manual runtime validation -> PASS
  - Google OAuth callback completes through desktop loopback (`/auth/callback`).
  - Onboarding transitions continue after auth.
  - URL step accepts empty website and validates only provided URLs.
  - YouTube URL input is persisted and shown in brand review summary.

## 5) Risks and Follow-up

- Remaining risks:
  - OAuth requires exact dashboard settings (Google + Supabase redirect URLs); misconfiguration still causes timeout.
  - `ko.json` contains legacy mojibake content from prior encoding; functional but text quality should be normalized.
- Follow-up recommendation:
  - Add onboarding integration tests for auth callback + step transitions.
  - Normalize Korean locale file encoding/content.
  - Start 1-6b scope: crawler connectors, review synthesis, interview pipeline.

## 6) Handoff to Next Phase

- Ready conditions:
  - Desktop onboarding/auth foundation is stable and verified.
  - Authenticated org bootstrap path is available from desktop -> API.
  - Folder setup and onboarding completion path are operational.
- Suggested next items (1-6b):
  - Implement crawling connectors (website/naver blog first).
  - Wire review/interview synthesis into result document generation.
  - Add production error telemetry and retry UX around long-running review tasks.

