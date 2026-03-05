# Scheduler Board UX Architecture Redesign

- Date: 2026-03-04
- Last Updated: 2026-03-05
- Status: Draft for implementation
- Scope: Replace Workspace 3-panel (Inbox | Chat | Session Rail) with Scheduler-centric architecture
- Depends on: Phase 5-4 completion, Session S1-S5 foundation

---

## 1) Problem Statement

The current Workspace model mixes two different jobs into one queue:

1. Campaign planning (iterative conversation)
2. Content approval (binary decision)

That causes two product problems:

- Campaign planning is conversational and multi-turn, but Inbox forces it into Approve/Reject.
- Inbox has no time axis, but marketing operations are calendar-driven.

Result: users plan in Chat, approve in Inbox, and still cannot answer "What is going out this week?"

---

## 2) Design Thesis

Three modes define user behavior:

| Mode | Trigger | Duration | Frequency | Primary Surface |
|---|---|---|---|---|
| Planning | "Let's plan next month" | 30-90 min | Monthly | Global Chat |
| Management | "What is due today?" | 5-20 min | Daily | Scheduler Board |
| Editing | Click content card | 5-25 min | Per item | Content Editor |

Management is the daily home. Planning is occasional. Editing is a drill-down from Management.

---

## 3) Core Architecture

### 3.1 Two surfaces

| Surface | Role |
|---|---|
| Scheduler Board / Content Editor | Main area (mode-switch in-place) |
| Global Chat Panel | Right-side panel, available on all pages |

Session rail behavior is absorbed into Global Chat (session switch, create, recommendation, recent list).

### 3.2 Global Chat panel width policy (updated)

Global Chat is no longer fixed at 320px.

- Default: 360px
- Min: 280px
- Max: 560px
- User-resizable via drag handle
- Width is persisted per device (localStorage)
- Double-click handle resets to default width

Collapsed state keeps only a right-edge toggle button.

### 3.3 Navigation model

Current:

```ts
"workspace" | "dashboard" | "brand-review" | "analytics" | "email-automation" | "settings"
```

Target:

```ts
"scheduler" | "dashboard" | "brand-review" | "analytics" | "email-automation" | "settings"
```

- `workspace` -> `scheduler`
- `scheduler` becomes default landing page
- Chat is not a page; it is a layout-level global panel

---

## 4) Scheduler Board Design

### 4.1 Purpose

Scheduler Board answers:

- What is scheduled this week/month?
- What needs approval now?
- What is generating right now?
- What already published?

### 4.2 View modes

- Week (default)
- Month
- List

### 4.3 Filters

- Campaign (including Ad-hoc)
- Channel
- Status

### 4.4 Card status lifecycle

Canonical slot lifecycle:

| Slot Status | Meaning |
|---|---|
| `scheduled` | Slot created, generation not started |
| `generating` | Generation in progress |
| `pending_approval` | Draft ready for review |
| `approved` | Approved, waiting publish time |
| `published` | Published |
| `skipped` | User intentionally skipped |
| `failed` | Generation/publish failed |

### 4.5 Ad-hoc content

Chat-created non-campaign content also enters Scheduler Board with same lifecycle.

### 4.6 `[+ Content]`

Always opens Global Chat (if collapsed, expands first) with contextual starter prompt.

---

## 5) Content Editor Design

### 5.1 Activation

Card click switches main area from board -> editor (in-place replacement).

### 5.2 Editing policy

Principle: "If a human can do it in ~10 seconds by typing, allow direct edit."

- Text: direct edit allowed
- Image/video structural change: via Chat regeneration

### 5.3 Navigation

Editor bottom bar supports Prev/Next by current board filter order.

### 5.4 Chat context-awareness

When editor is active, Chat auto-tags messages with focused `content_id/workflow_item_id`.

---

## 6) Global Chat Panel Design

### 6.1 Layout behavior

- Layout-level render (MainLayout)
- Available on all pages
- Session continuity across page navigation
- Collapsible + resizable

### 6.2 Session features absorbed from Session Rail

- Current session indicator
- Session switcher
- New session
- Recommended session
- Recent sessions
- Folder update prompts

### 6.3 Campaign planning flow

Campaign planning remains fully conversational in Chat and ends with explicit finalization.

Key rule:

- Campaign plan is not projected as Inbox action-card.
- Finalized plan writes campaign + schedule slots.

---

## 7) Data Model Changes (updated)

### 7.1 Campaign plan is not a workflow_item

`workflow_items` are reserved for content-level review workflow.

### 7.2 Option B selected (final)

**Decision fixed:** Use separate `schedule_slots` table.

Rationale:

- A slot can exist before generated content.
- Scheduling and editorial lifecycle can evolve independently.
- Better fit for scheduler engine idempotency and retries.

Conceptual schema:

```sql
create table schedule_slots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  campaign_id uuid null references campaigns(id),
  workflow_item_id uuid null references workflow_items(id),
  content_id uuid null references contents(id),
  channel text not null,
  content_type text not null,
  scheduled_date date not null,
  scheduled_time timestamptz null,
  slot_status text not null default 'scheduled',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

### 7.3 Campaign plan audit/version store (new)

Add dedicated storage for campaign-plan history and diff:

- `campaign_plan_versions`
- Stores draft/final versions, reason, chain artifacts, author/session linkage

Purpose:

- audit trail
- side-by-side version compare
- safe transition after removing campaign plan workflow_item

---

## 8) Status Model Mapping (new)

To prevent UI/backend drift, status mapping is explicit:

| Slot Status (`schedule_slots.slot_status`) | Workflow (`workflow_items.status`) | Content (`contents.status`) | UI Badge |
|---|---|---|---|
| `scheduled` | null | null | Scheduled |
| `generating` | null | `draft` or null | Generating |
| `pending_approval` | `proposed` | `pending_approval` | Review |
| `approved` | `approved` | `approved` | Approved |
| `published` | `approved` | `published` | Published |
| `skipped` | `rejected` or null | `rejected` or null | Skipped |
| `failed` | null | null or `rejected` | Failed |

Transition rules:

- `scheduled -> generating -> pending_approval -> approved -> published`
- `scheduled|generating|pending_approval -> skipped`
- Any non-terminal status -> `failed`
- Terminal: `published`, `skipped`

---

## 9) Scheduler Engine Design (updated)

### 9.1 Responsibilities

1. Trigger generation by schedule/lead-time
2. Trigger publish at publish-time
3. Detect missed slots and notify

### 9.2 Concurrency and idempotency requirements (new)

Scheduler engine must be safe in multi-instance runtime:

- Lease + lock acquisition (`FOR UPDATE SKIP LOCKED` equivalent)
- Idempotency key per job intent (`job_type + slot_id + logical_version`)
- At-most-once side effects for generation/publish
- Retry with bounded attempts and backoff
- Lease timeout recovery for crashed workers

Recommended worker metadata:

- `lease_owner`
- `lease_expires_at`
- `attempt_count`
- `last_error`

Implementation options:

- MVP: polling worker (5 min interval)
- Recommended: pg_cron + edge function trigger
- Future: dedicated queue runtime (BullMQ/Temporal)

---

## 10) Migration Strategy (updated)

### 10.1 Keep

- Existing content workflow state machine
- Session orchestration base
- Chat timeline/history

### 10.2 Remove / replace

- Workspace 3-panel page
- Inbox panel as daily home
- Session rail panel
- Campaign action-card projection

### 10.3 Add

- Scheduler page
- Board + editor mode switch
- Global chat panel
- `schedule_slots`
- `campaign_plan_versions`
- Scheduler engine foundation

---

## 11) Phase Order (critical update)

### Why order changed

If Inbox is removed before chat-only campaign finalization is fully ready, campaign-plan approval path can break.

### New sequence

1. **S-5A (must run first)**: Campaign finalization safety layer
- Chat-only finalization production path enabled
- Campaign action-card dependency removed behind feature flag
- `campaign_plan_versions` audit storage added
- No-gap compatibility verified

2. **S-1**: Scheduler shell + nav rename + global chat shell
3. **S-2**: Scheduler data integration
4. **S-3**: Text content editor
5. **S-4**: Image/video editor
6. **S-5B**: Planning UX refinement
7. **S-6**: Scheduler engine automation

---

## 12) Risk Assessment

| Risk | Severity | Mitigation |
|---|---|---|
| UI surface replacement regressions | High | Ship S-1 shell early behind flag |
| Scheduler engine race conditions | High | Mandatory lease+idempotency design |
| Status drift across tables/UI | Medium | Canonical mapping table + transition contract |
| Dual mutation path (direct edit vs AI) | Medium | Version history + explicit action separation |
| Migration gap during Inbox removal | High | Reordered sequence: S-5A before S-1 |

---

## 13) Success Criteria

1. Daily review can be completed from Scheduler without page hopping.
2. Campaign planning remains fully chat-native.
3. Ad-hoc content follows same scheduler lifecycle.
4. Chat is accessible from all pages and keeps session continuity.
5. Chat panel width is user-resizable and persisted.
6. Campaign plan history is auditable and diffable.
7. Scheduler engine is idempotent under concurrent workers.
