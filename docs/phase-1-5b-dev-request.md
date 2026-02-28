# Phase 1-5b Development Request
## Marketing AI Agent Platform - Frontend Integration (v1.1)

---

## Overview

This document defines Phase **1-5b**: Electron frontend integration on top of 1-5a backend contracts.

Goal: deliver chat interaction, approval actions, and Realtime-driven UI updates for the full flow.

**Depends on:** Phase 1-5a completion.

---

## Scope

- Chat UI in Electron renderer
- Campaign approval card in chat flow
- Approval queue page for `pending_approval` contents
- Supabase Realtime subscription for `chat_messages`
- IPC contract expansion from renderer to main process
- Main process forwarding of user actions to `apps/api` resume endpoint

No new orchestration logic is added in 1-5b.

---

## Objectives

- [ ] Add renderer chat components (message list, input, send action)
- [ ] Add approval queue UI components and list rendering
- [ ] Add renderer hooks for Realtime `chat_messages` subscription
- [ ] Add IPC channels for send/approve/reject actions
- [ ] Add main-process handlers that call 1-5a API routes
- [ ] Keep renderer free of service-role credentials

---

## 1. UI Architecture

### Pages / panels

- Chat panel:
  - assistant/user timeline
  - input + send
  - campaign approval card when applicable
- Approval queue panel:
  - list of `contents.status = 'pending_approval'`
  - approve/reject buttons per item

### Data sources

- Realtime stream:
  - `public.chat_messages` (insert events)
- Query fetches:
  - active session/campaign summary
  - pending approval contents

---

## 2. IPC Contract (1-5b)

### Renderer -> Main

- `chat:send-message` -> `{ session_id, content }`
- `chat:approve-campaign` -> `{ session_id, campaign_id }`
- `chat:approve-content` -> `{ session_id, content_id }`
- `chat:reject` -> `{ session_id, type, id, reason? }`

### Main -> Renderer

- `chat:action-result` -> `{ action, ok, session_id }`
- `chat:action-error` -> `{ action, message, session_id }`

Main process calls `apps/api` resume endpoint and returns acknowledgement to renderer.

---

## 3. Resume Trigger Sequence

### User message flow

1. Renderer invokes `chat:send-message`.
2. Main validates payload and forwards to `POST /sessions/:sessionId/resume` with event `user_message`.
3. API resumes session and writes DB changes.
4. Orchestrator inserts assistant responses into `chat_messages`.
5. Renderer receives inserts via Realtime and updates UI.

### Approval flow

1. Renderer invokes `chat:approve-campaign` or `chat:approve-content`.
2. Main forwards to resume endpoint with event `campaign_approved` or `content_approved`.
3. API applies transition, updates DB, and writes chat feedback.
4. Renderer updates from query refresh + Realtime events.

---

## 4. Realtime and Auth Note

Phase 1-5b requires an authenticated Supabase user session in desktop runtime to satisfy RLS for Realtime and table reads.

Minimum requirement for this phase:

- define and document a local desktop auth bootstrap path for development,
- do not bypass RLS with service-role keys in renderer.

Production login UX remains out of scope.

---

## 5. UI States and Error Handling

- show pending state while IPC action is in flight
- disable duplicate approve clicks during pending state
- show inline error for API/IPC failures
- preserve message ordering by `created_at`
- unsubscribe Realtime listeners on component unmount

---

## 6. Shared Types

Ensure renderer uses shared types from `packages/types` for:

- `ChatMessage`
- `Campaign`
- `Content`
- `OrchestratorSession`

If new unions are needed for UI action events, add them to `packages/types`.

---

## 7. Acceptance Criteria (1-5b)

- [ ] Chat UI renders historical + new `chat_messages` for current org.
- [ ] New assistant messages appear via Realtime without polling.
- [ ] Sending user message triggers session resume and updates chat timeline.
- [ ] Campaign approval card action updates campaign status to `approved`.
- [ ] Approval queue lists `pending_approval` contents.
- [ ] Approving content triggers publish step and sets content to `published`.
- [ ] Rejection path shows user-visible feedback and session status update.
- [ ] All chat/approval user actions flow through IPC main-process bridge.
- [ ] `pnpm type-check` passes.
- [ ] `pnpm build` passes.

---

## 8. Out of Scope (1-5b)

- New backend state transitions
- Multi-session management UI
- Content edit workflow
- Telegram UI/channel sync
- Real social publish APIs

---

*Document version: v1.1*
*Phase: 1-5b Frontend Integration*
*Depends on: Phase 1-5a (Backend Flow Skeleton)*
*Updated: 2026-02-28*
