# UI-3 Development Request
## Page Migration Batch A (Dashboard, Agent Chat, Settings)

---

## Goal

Move high-value existing views into modular page components while preserving live behavior for approvals, chat, and settings.

---

## Why This Phase

These pages already use real data and user actions. Migrating them first establishes reusable patterns for hooks, props, and shared state.

---

## Scope

### In Scope

- Create page components:
  - `Dashboard.tsx`
  - `AgentChat.tsx`
  - `Settings.tsx`
- Extract reusable hooks for real data paths:
  - `usePendingApprovals`
  - `useChat`
  - `useRuntime` (minimal wrapper if needed)
- Preserve current approval actions and chat send/receive behavior.
- Auto-hide context panel on `agent-chat` and `settings` pages.

### Out of Scope

- Onboarding extraction.
- New business logic.
- Visual redesign beyond structural migration.

---

## Target File Additions

- `apps/desktop/src/pages/Dashboard.tsx`
- `apps/desktop/src/pages/AgentChat.tsx`
- `apps/desktop/src/pages/Settings.tsx`
- `apps/desktop/src/hooks/usePendingApprovals.ts`
- `apps/desktop/src/hooks/useChat.ts`

## Target File Updates

- `apps/desktop/src/layouts/MainLayout.tsx`
- `apps/desktop/src/App.tsx`

---

## Acceptance Criteria

1. Dashboard pending approval list still reads from Supabase.
2. Approval actions still work from migrated dashboard.
3. Agent Chat page behavior matches pre-migration behavior.
4. Settings still shows runtime/org data currently available in app.
5. Context panel is hidden on Agent Chat and Settings pages.
6. `pnpm --filter @repo/desktop type-check` passes.
7. `pnpm --filter @repo/desktop build` passes.

---

## Risks and Controls

- Risk: chat and approval behavior drift.
- Control: migrate with behavior parity checks before styling changes.

