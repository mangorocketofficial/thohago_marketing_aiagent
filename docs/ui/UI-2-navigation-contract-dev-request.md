# UI-2 Development Request
## Navigation Contract (Router-Ready, Router-Free)

---

## Goal

Introduce a `NavigationContext` contract that supports current state-based navigation and can be swapped to router-backed navigation later.

---

## Why This Phase

State switching is sufficient today, but deep-linking and route history requirements will likely appear. A stable interface now reduces future migration cost.

---

## Scope

### In Scope

- Define `PageId` and panel mode contract in `types/navigation.ts`.
- Implement `NavigationContext` provider and hook.
- Expose API methods that are router-ready:
  - `activePage`
  - `navigate(pageId, options?)`
  - `setContextPanelMode(mode)`
  - `setContextPanelCollapsed(value)`
- Move sidebar page switching to context API.
- Define side-effect behavior of `navigate()` in the contract.
- Define full-width page auto-hide policy in the navigation layer.

### Out of Scope

- `react-router` package introduction.
- Browser-like URL sync.
- Back/forward history stack.

---

## Target File Additions

- `apps/desktop/src/context/NavigationContext.tsx`

## Target File Updates

- `apps/desktop/src/types/navigation.ts`
- `apps/desktop/src/components/Sidebar.tsx`
- `apps/desktop/src/layouts/MainLayout.tsx`
- `apps/desktop/src/App.tsx` (wire provider)

---

## Navigation Contract (Reference)

```ts
export type PageId =
  | "dashboard"
  | "brand-review"
  | "campaign-plan"
  | "content-create"
  | "analytics"
  | "email-automation"
  | "agent-chat"
  | "settings";

export type ContextPanelMode = "page-context" | "agent-chat" | "hidden";

export type NavigateOptions = {
  // Optional override applied at the same time as page transition.
  contextPanelMode?: ContextPanelMode;
};

export const FULL_WIDTH_PAGES: PageId[] = ["agent-chat", "settings"];
// Default navigation policy:
// - navigate(target) => contextPanelMode is auto-resolved.
// - if target is in FULL_WIDTH_PAGES => contextPanelMode = "hidden"
// - otherwise => contextPanelMode = "page-context"
// - options.contextPanelMode overrides default policy for explicit transitions.
```

---

## Acceptance Criteria

1. Page switching is driven by `NavigationContext`.
2. Components do not directly depend on ad-hoc page state from unrelated modules.
3. Navigation API can be adapted to router internals later without page component rewrites.
4. `pnpm --filter @repo/desktop type-check` passes.
5. `pnpm --filter @repo/desktop build` passes.
6. Onboarding branch behavior remains unchanged (provider is applied to main layout path only).

---

## Risks and Controls

- Risk: over-designing navigation early.
- Control: keep interface minimal and current needs focused.
