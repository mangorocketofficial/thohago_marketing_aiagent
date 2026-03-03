# UI-1 Development Request
## Main Layout Shell Foundation

---

## Goal

Introduce a stable three-panel desktop shell (`sidebar + main + right context`) for dashboard mode **without touching onboarding behavior**.

---

## Why This Phase

`App.tsx` currently mixes onboarding, data loading, chat actions, and rendering logic. UI-1 creates the visual/container foundation first, with low refactor risk.

---

## Scope

### In Scope

- Create `MainLayout` as the container for non-onboarding mode.
- Create static `Sidebar` shell with menu items and active styling.
- Create `ContextPanel` shell container with collapse toggle state.
- Keep current onboarding flow in `App.tsx` unchanged.
- Keep current runtime, Supabase, and chat wiring in `App.tsx` unchanged.

### Out of Scope

- Onboarding extraction.
- Chat mini widget.
- Full page migration.
- Router adoption.

---

## Target File Additions

- `apps/desktop/src/layouts/MainLayout.tsx`
- `apps/desktop/src/components/Sidebar.tsx`
- `apps/desktop/src/components/ContextPanel.tsx`
- `apps/desktop/src/types/navigation.ts` (basic `PageId` type only)

---

## Implementation Notes

1. Use existing `mode` guard:
   - `mode === "onboarding"`: render existing onboarding block as-is.
   - else: render `MainLayout`.
2. Initial `MainLayout` can still receive handlers/state props from `App.tsx`.
3. Panel collapse state may be local in `MainLayout` for UI-1.

---

## Acceptance Criteria

1. Onboarding path works exactly as before.
2. Dashboard mode renders three-panel shell.
3. Sidebar selection changes visible active state.
4. Right panel can collapse/expand.
5. `pnpm --filter @repo/desktop type-check` passes.
6. `pnpm --filter @repo/desktop build` passes.

---

## Risks and Controls

- Risk: accidental onboarding behavior regression.
- Control: onboarding code is not moved in UI-1.

