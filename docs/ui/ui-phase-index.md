# UI Phase Progress Index

This index tracks the dedicated UI special phases (`UI-*`) that are independent from backend/data phase numbering.

| UI Phase | Title | Status | Completed On | Depends On | Report |
|---|---|---|---|---|---|
| UI-1 | Main Layout Shell Foundation | Done | 2026-03-03 | Current desktop baseline | [../progress/ui-1-completion.md](../progress/ui-1-completion.md) |
| UI-2 | Navigation Contract (Router-Ready) | Done | 2026-03-03 | UI-1 | [../progress/ui-2-completion.md](../progress/ui-2-completion.md) |
| UI-3 | Page Migration Batch A (Dashboard, Agent Chat, Settings) | Planned | - | UI-1, UI-2 | [UI-3-page-migration-batch-a-dev-request.md](./UI-3-page-migration-batch-a-dev-request.md) |
| UI-3.5 | Onboarding Extraction from App.tsx | Planned | - | UI-3 | [UI-3.5-onboarding-extraction-dev-request.md](./UI-3.5-onboarding-extraction-dev-request.md) |
| UI-4 | Page Skeleton Batch B (Brand Review, Content Create, Campaign, Analytics, Email) | Planned | - | UI-3.5 | [UI-4-page-skeleton-batch-b-dev-request.md](./UI-4-page-skeleton-batch-b-dev-request.md) |
| UI-5 | Context Panel Agent Widget Integration | Planned | - | UI-2, UI-3 | [UI-5-context-agent-widget-dev-request.md](./UI-5-context-agent-widget-dev-request.md) |
| UI-6 | Styling Tokens and Coexistence Cleanup | Planned | - | UI-1 to UI-5 | [UI-6-styling-tokens-and-coexistence-dev-request.md](./UI-6-styling-tokens-and-coexistence-dev-request.md) |
| UI-7 | Hardening, Regression Validation, and Release Gate | Planned | - | UI-1 to UI-6 | [UI-7-hardening-validation-dev-request.md](./UI-7-hardening-validation-dev-request.md) |
