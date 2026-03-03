# UI-3.5 Development Request
## Onboarding Extraction from App.tsx

---

## Goal

Extract the onboarding flow (steps 0-7) from `App.tsx` into a dedicated `OnboardingLayout.tsx` component and reduce `App.tsx` to a cleaner mode router/orchestrator.

---

## Why This Phase

After UI-3 and Phase 3-4, dashboard mode runs through `MainLayout` with independent page components (`Dashboard`, `AgentChat`, `Settings`), and onboarding is now the largest remaining monolith in `App.tsx`.

1. Main-mode pages are already modular and can remain untouched.
2. Onboarding extraction can proceed without changing dashboard/chat interaction model.
3. Keeping onboarding in `App.tsx` slows every subsequent phase because engineers must traverse a very large mixed-responsibility file.

---

## Scope

### In Scope

- Move onboarding JSX (steps 0-7 render block) into `layouts/OnboardingLayout.tsx`.
- Move onboarding-only state and handlers into the new component:
  - `onboardingStep`, `onboardingDraft`, `interviewAnswers`
  - `crawlStatus`, `synthesisResult`, onboarding-local notice/error state
  - onboarding auth form/mode/notice state
  - handlers for draft save, crawl start/retry, interview save, synthesize, step navigation
- Move onboarding helper functions:
  - `resolveOnboardingEntryStep`
  - `defaultOnboardingDraft`
  - `defaultInterviewAnswers`
  - `defaultOnboardingCrawlStatus`
  - `isCrawlSourceComplete`
  - `isCrawlFullyComplete`
  - `formatCrawlStatusLabel`
- Preserve App-side shared responsibilities:
  - auth session hydration/persistence lifecycle
  - watcher/chat realtime subscriptions
  - dashboard/chat/settings orchestration
- Pass shared dependencies/callbacks from `App.tsx` to `OnboardingLayout`:
  - `runtime`, `authSupabase`, `authSession`, `desktopConfig`, `selectedPath`
  - config/watch-path sync callbacks
  - `onComplete` callback to switch to `"dashboard"`
  - shared `onSignOut` callback
- Move onboarding crawl IPC listeners to `OnboardingLayout`:
  - `runtime.onboarding.onCrawlProgress`
  - `runtime.onboarding.onCrawlComplete`

### Out of Scope

- Onboarding UX redesign.
- MainLayout/page-component refactor.
- Shared auth hook extraction.
- Runtime/API contract changes unrelated to extraction.

---

## Target File Additions

- `apps/desktop/src/layouts/OnboardingLayout.tsx`

## Target File Updates

- `apps/desktop/src/App.tsx` (onboarding logic extraction)

---

## Props Interface (Reference)

```ts
interface OnboardingLayoutProps {
  runtime: Runtime;
  authSupabase: SupabaseClient | null;
  authSession: Session | null;
  desktopConfig: DesktopAppConfig | null;
  selectedPath: string;
  entryStep: OnboardingStep;
  entryVersion: number;
  formatDateTime: (iso?: string | null) => string;
  onDesktopConfigChange: (config: DesktopAppConfig) => void;
  onSelectedPathChange: (path: string) => void;
  onSignOut: () => Promise<void>;
  onComplete: (payload: {
    status: WatcherStatus;
    config: DesktopAppConfig;
    files: RendererFileEntry[];
    notice: string;
  }) => void;
}
```

---

## Migration Strategy

1. Copy first, verify, then delete.
   - Copy onboarding render block + onboarding handlers/effects into `OnboardingLayout.tsx`.
   - Wire props from `App.tsx`.
   - Validate onboarding flow parity.
   - Remove original onboarding block and onboarding-only logic from `App.tsx`.

2. No behavior changes.
   - Keep auth/crawl/interview/synthesis/step flow behaviorally equivalent.

3. Listener lifecycle ownership.
   - Ensure crawl listeners are mounted/unmounted inside `OnboardingLayout`.

---

## Acceptance Criteria

1. Onboarding flow remains end-to-end functional (auth -> URL setup -> crawl -> interview -> synthesis -> folder -> complete).
2. Dashboard mode remains behaviorally unchanged.
3. `App.tsx` no longer contains onboarding render block or onboarding-only handlers/effects.
4. No duplicated onboarding state between `App.tsx` and `OnboardingLayout.tsx`.
5. `pnpm --filter @repo/desktop type-check` passes.
6. `pnpm --filter @repo/desktop build` passes.

---

## Risks and Controls

| Risk | Control |
|---|---|
| Onboarding regression from missed dependency | Copy-first extraction + parity validation before deleting |
| Listener leak/missing cleanup | Explicit `useEffect` teardown in `OnboardingLayout` |
| Shared state drift (config/watch path/session) | Keep App as single source; update through callbacks only |
| Over-extraction into App-shared concerns | Limit extraction strictly to onboarding-only concerns |

---

## Depends On

- UI-3 (page migration baseline)
- Phase 3-4 (dashboard decision-path cleanup)

