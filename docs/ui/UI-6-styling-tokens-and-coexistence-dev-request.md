# UI-6 Development Request
## Styling Tokens and Coexistence Cleanup

---

## Goal

Introduce a stable styling token system for new UI shell components while preventing conflicts with existing styles.

---

## Scope

### In Scope

- Add `--ui-*` CSS variables for layout, color, spacing, and typography.
- Apply `.ui-*` class namespace for all new shell/page components.
- Ensure old classes and onboarding styles continue to render unchanged.
- Harmonize key shell surfaces (sidebar, main, context panel, cards) with token usage.

### Out of Scope

- Full legacy CSS rewrite.
- Dark mode implementation.
- Design system overhaul.

---

## Styling Rules

1. Existing global selectors must not be broadly changed in this phase.
2. New token usage must be additive and isolated.
3. If a legacy class is touched, change should be minimal and regression-tested.

---

## Target File Updates

- `apps/desktop/src/styles.css`
- `apps/desktop/src/layouts/MainLayout.tsx`
- `apps/desktop/src/components/*.tsx` (new UI components)
- `apps/desktop/src/pages/*.tsx` (migrated pages)

---

## Acceptance Criteria

1. New shell uses `--ui-*` tokens consistently.
2. Onboarding and legacy surfaces do not visually regress.
3. No obvious class collision between new and existing styles.
4. Desktop layout remains stable at minimum Electron window size.
5. `pnpm --filter @repo/desktop type-check` passes.
6. `pnpm --filter @repo/desktop build` passes.

