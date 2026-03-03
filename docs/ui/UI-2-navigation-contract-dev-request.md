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
```

---

## Acceptance Criteria

1. Page switching is driven by `NavigationContext`.
2. Components do not directly depend on ad-hoc page state from unrelated modules.
3. Navigation API can be adapted to router internals later without page component rewrites.
4. `pnpm --filter @repo/desktop type-check` passes.
5. `pnpm --filter @repo/desktop build` passes.

---

## Risks and Controls

- Risk: over-designing navigation early.
- Control: keep interface minimal and current needs focused.

