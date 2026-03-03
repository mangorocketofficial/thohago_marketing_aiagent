# UI Program Development Request
## Ddohago Desktop UI Shell Refactor Program (UI-1 to UI-7)

---

## Overview

This document defines the dedicated **UI special phase track** using `UI-*` identifiers.

The purpose is to refactor the Electron renderer from the current monolithic `App.tsx` into a modular, maintainable three-panel application shell while protecting already validated onboarding behavior.

This UI track is intentionally separate from backend/data phases (`1-*`, `2-*`), and should be tracked independently.

---

## Why UI-* Exists

The current renderer has high coupling between onboarding, runtime bridge access, Supabase state, chat, approvals, and page rendering. Feature expansion without architectural separation will increase regression risk and delivery cost.

The UI track introduces structure in safe increments:

1. Keep onboarding stable first.
2. Build shell and navigation contracts.
3. Migrate page surfaces gradually.
4. Add cross-page chat and styling normalization.
5. Validate behavior parity and readiness for next feature waves.

---

## Program Guardrails

1. **Onboarding safety first**
   - Onboarding remains inside `App.tsx` during early UI phases.
   - No onboarding extraction until dedicated validation gates pass.

2. **Router-ready, router-free now**
   - No `react-router` adoption in this track.
   - Navigation API must be designed so a router adapter can replace internals later.

3. **CSS coexistence strategy**
   - New UI tokens use `--ui-*` variables only.
   - New components use `.ui-*` class namespace to avoid clashes with existing global styles.

4. **Dependency discipline**
   - No chart dependency assumptions.
   - Analytics skeleton uses plain placeholders unless chart package is explicitly introduced later.

5. **Incremental shipping**
   - Each UI phase has isolated acceptance criteria and rollback-friendly boundaries.

---

## Phase Sequence

| UI Phase | Title | Status | Report |
|---|---|---|---|
| UI-1 | Main Layout Shell Foundation | Done | [ui-1-completion.md](./progress/ui-1-completion.md) |
| UI-2 | Navigation Contract (Router-Ready) | Planned | [UI-2-navigation-contract-dev-request.md](./ui/UI-2-navigation-contract-dev-request.md) |
| UI-3 | Page Migration Batch A (Dashboard, Agent Chat, Settings) | Planned | [UI-3-page-migration-batch-a-dev-request.md](./ui/UI-3-page-migration-batch-a-dev-request.md) |
| UI-3.5 | Onboarding Extraction from App.tsx | Planned | [UI-3.5-onboarding-extraction-dev-request.md](./ui/UI-3.5-onboarding-extraction-dev-request.md) |
| UI-4 | Page Skeleton Batch B (Brand Review, Content Create, Campaign, Analytics, Email) | Planned | [UI-4-page-skeleton-batch-b-dev-request.md](./ui/UI-4-page-skeleton-batch-b-dev-request.md) |
| UI-5 | Context Panel Agent Widget Integration | Planned | [UI-5-context-agent-widget-dev-request.md](./ui/UI-5-context-agent-widget-dev-request.md) |
| UI-6 | Styling Tokens and Coexistence Cleanup | Planned | [UI-6-styling-tokens-and-coexistence-dev-request.md](./ui/UI-6-styling-tokens-and-coexistence-dev-request.md) |
| UI-7 | Hardening, Regression Validation, and Release Gate | Planned | [UI-7-hardening-validation-dev-request.md](./ui/UI-7-hardening-validation-dev-request.md) |

---

## Global Success Criteria

1. Onboarding flow remains operational and regression-free across all UI phases.
2. Dashboard mode is transformed into a modular shell with clear layout/page boundaries.
3. Chat behavior remains consistent between full page and mini widget entry points.
4. All newly added UI text is wired through existing i18n resources.
5. `pnpm type-check` and `pnpm build` pass at each delivery checkpoint.

---

*Document version: v2.1 (UI special phase track)*
*Created: 2026-03-03*
