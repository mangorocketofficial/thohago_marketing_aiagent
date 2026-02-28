# Phase 1-5 Development Request (Split)
## Marketing AI Agent Platform - Full Flow Skeleton v1.1

---

## Overview

The original Phase 1-5 scope was split into two phases to reduce delivery risk and make validation clearer.

- **Phase 1-5a (Backend Foundation):** `apps/api`, DB schema updates, relay integration, and resumable orchestrator state machine.
- **Phase 1-5b (Frontend Integration):** Electron chat UI, approval queue UI, Realtime subscription, and IPC wiring to backend resume endpoints.

The full user journey remains the same, but implementation is now staged:

1. Backend flow becomes runnable and testable without UI dependency.
2. UI/Realtime is added on top of a stable backend contract.

---

## Global Decisions (Applied to 1-5a and 1-5b)

1. **Single AI vendor for Phase 1-5:** Anthropic Claude only.
2. **No LangGraph in Phase 1-5:** use a TypeScript manual state machine with persisted session state.
3. **Server-side orchestration only:** AI logic remains in `apps/api`, not in Electron.
4. **Schema consistency:** `pipeline_triggers` insert uses `relative_path` (not `file_path`).
5. **One active session per org (Phase 1-5 scope):** additional triggers are queued.

---

## Phase Documents

- [Phase 1-5a Development Request](./phase-1-5a-dev-request.md)
- [Phase 1-5b Development Request](./phase-1-5b-dev-request.md)

---

## Delivery Order

1. Complete 1-5a acceptance criteria.
2. Then implement 1-5b against 1-5a API/session contracts.

---

## Out of Scope (Unchanged)

- RAG / org brand context (Phase 2)
- Real social media publish APIs (Phase 1-7+)
- Image/video generation runtime
- Telegram integration
- Scheduling/cron
- Multi-campaign parallel orchestration beyond queueing policy

---

*Document version: v1.1*
*Phase: 1-5 Split Index (1-5a / 1-5b)*
*Depends on: Phase 1-4 (Electron Watcher & Onboarding)*
*Updated: 2026-02-28*
