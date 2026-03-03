# UI-7 Development Request
## Hardening, Regression Validation, and Release Gate

---

## Goal

Run integration hardening for the full UI track and lock release readiness with explicit regression checks.

---

## Scope

### In Scope

- Regression pass for onboarding, chat, approvals, and settings behavior.
- Validate all page navigation and context panel modes.
- Validate i18n coverage and fallback behavior.
- Validate desktop runtime bridge interactions under the new layout architecture.
- Produce completion report and issue list for follow-up phases.

### Out of Scope

- Major new UI features.
- Onboarding extraction refactor.
- Router migration.

---

## Validation Matrix

1. App boot and session restore.
2. Onboarding flow still works end-to-end.
3. Sidebar navigation across all pages.
4. Context panel behavior:
   - expanded
   - collapsed
   - hidden by page policy
   - mini chat mode
5. Agent chat parity:
   - full page
   - mini widget
   - shared message continuity
6. Dashboard pending view remains read-only and supports `Open in Chat` handoff (no duplicate approve/reject action path).
7. Brand review data display.
8. Settings runtime data visibility.
9. Type-check and build.

---

## Deliverables

- `docs/progress/ui-7-completion.md` (or equivalent UI completion record)
- documented known gaps with severity and owner
- final acceptance sign-off summary

---

## Acceptance Criteria

1. No blocker regressions in onboarding and chat.
2. No critical navigation/panel state defects.
3. Build and type-check succeed.
4. Remaining issues are non-blocking and documented.
