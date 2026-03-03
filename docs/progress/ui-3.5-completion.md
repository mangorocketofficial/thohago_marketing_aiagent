# UI-3.5 Completion Report

- Phase: UI-3.5
- Title: Onboarding Extraction from App.tsx
- Status: Done
- Completed On: 2026-03-03

## 1) Goals and Scope

- Goal:
  - Extract onboarding flow (steps 0-7) from `App.tsx` into a dedicated layout component.
  - Keep `App.tsx` focused on mode routing and shared runtime orchestration.
- In Scope:
  - Onboarding UI/state/handlers/effects extraction to `OnboardingLayout`.
  - Crawl listener ownership move (`onCrawlProgress`, `onCrawlComplete`) to onboarding layout.
  - App-side wiring for shared dependencies and onboarding completion callback.
- Out of Scope:
  - Onboarding UX redesign.
  - Dashboard/chat/settings behavior changes.
  - Runtime API contract changes unrelated to extraction.

## 2) Implementation Summary

- Added onboarding layout:
  - `apps/desktop/src/layouts/OnboardingLayout.tsx`
    - owns onboarding step flow, draft/interview/synthesis/crawl state, onboarding auth form state
    - owns onboarding crawl listener lifecycle and teardown
    - exports `resolveOnboardingEntryStep` and `OnboardingStep` type for App routing entry
- Updated `App.tsx`:
  - replaced inlined onboarding render block with `<OnboardingLayout />`
  - preserved shared orchestration responsibilities (auth session bootstrap, watcher/chat subscriptions, dashboard routing)
  - keeps single `onComplete` handoff to transition onboarding -> dashboard with updated runtime/config/file state
- Updated dev request:
  - `docs/ui/UI-3.5-onboarding-extraction-dev-request.md`
    - reflects corrected extraction contract and App vs Onboarding responsibility boundary

## 3) Boundary Outcomes

- `App.tsx` is now primarily a mode router + shared runtime coordinator.
- Onboarding concerns are no longer duplicated across App and dedicated layout.
- Extraction preserves existing behavior while making next UI phases easier to iterate safely.

## 4) Validation Executed

- `pnpm --filter @repo/desktop type-check` -> PASS
- `pnpm --filter @repo/desktop build` -> PASS
- Structural result:
  - `apps/desktop/src/App.tsx`: 835 lines
  - `apps/desktop/src/layouts/OnboardingLayout.tsx`: 1255 lines

## 5) Final Result

- UI-3.5 onboarding extraction is complete.
- Onboarding flow remains functional behind a dedicated layout module.
- `App.tsx` no longer contains the onboarding monolith and is ready for subsequent UI-phase modularization.
