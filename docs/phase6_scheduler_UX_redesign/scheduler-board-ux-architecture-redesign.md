# Scheduler Board — UX Architecture Redesign

- Date: 2026-03-04
- Status: Draft for review
- Scope: Replace Workspace 3-panel (Inbox | Chat | Session Rail) with Scheduler-centric architecture
- Depends on: Phase 5-4 completion, Session S1–S4 foundation

---

## 1) Problem Statement

The current Workspace design treats **campaign plans** as approval-queue items alongside content drafts. This is architecturally wrong for two reasons:

1. **Campaign planning is a collaborative dialogue, not an approval decision.** Users build campaign strategies iteratively with the AI through conversation — interview, draft, debate, refine, finalize. Routing the plan into an Inbox card with Approve/Reject buttons breaks the conversational flow and forces a false binary on what is inherently a gradual consensus process.

2. **The Inbox has no time axis.** Real marketing operations are calendar-driven. "What needs my attention today?" is the daily question, not "what is pending in a queue?". A flat list of workflow items sorted by creation time gives no sense of schedule, urgency, or campaign rhythm.

The result: users experience cognitive fragmentation — planning happens in Chat, decisions are demanded in Inbox, and there is no surface that answers "what is my marketing calendar doing this week?"

---

## 2) Design Thesis

Three user modes define all interaction with the product:

| Mode | Trigger | Duration | Frequency | Primary surface |
|------|---------|----------|-----------|-----------------|
| **Planning** | "Let's build next month's campaign" | 30–60 min deep conversation | 1–2× per month | Chat (full session) |
| **Management** | "What's happening today?" | 5–10 min scan | Daily or every other day | Scheduler Board |
| **Editing** | Click a content card on the board | 5–15 min per item | Per content item | Content Editor (replaces board in-place) |

The workflow loop:

```
Planning ──(campaign finalized)──→ Management ──(content click)──→ Editing
  (Chat)                          (Scheduler)                    (Editor)
                                      ↑                             │
                                      └───(save/approve, return)────┘
```

**Management mode is the daily home.** Planning is occasional; Editing is a drill-down from Management. The Scheduler Board is the default landing page.

---

## 3) Core Architecture

### 3.1) Two surfaces, not three

| Surface | Role | Persistence |
|---------|------|-------------|
| **Scheduler Board / Content Editor** | Main area. Shows calendar board by default; switches to editor when a content item is selected. | Left/center of screen |
| **Global Chat** | Right-side collapsible panel. Available on every page. Handles both campaign planning and content-level AI modification requests. | Right side, global |

The current Workspace 3-panel (Inbox | Chat | Session Rail) is replaced entirely. Session Rail functionality (session switching, session creation) is absorbed into the Chat panel's header/footer.

### 3.2) Layout

```
┌──────────────────────────────────────┬──────────────────┐
│                                      │                  │
│         Main Area                    │   Global Chat    │
│         (Scheduler Board             │   (collapsible)  │
│          OR Content Editor)          │                  │
│                                      │   ~320px wide    │
│         flex: fills remaining        │   or collapsed   │
│                                      │                  │
└──────────────────────────────────────┴──────────────────┘
```

Chat collapsed state: Main Area expands to full width. A toggle button remains visible on the right edge.

### 3.3) Page-level navigation changes

Current `PageId` union:

```
"workspace" | "dashboard" | "brand-review" | "analytics" | "email-automation" | "settings"
```

Proposed change:

```
"scheduler" | "dashboard" | "brand-review" | "analytics" | "email-automation" | "settings"
```

- `"workspace"` → renamed to `"scheduler"` (semantically accurate).
- `"scheduler"` is the default landing page (`INITIAL_NAVIGATION_STATE.activePage`).
- Chat is **not a page**. It is a global panel rendered by `MainLayout` outside the page slot, visible on all pages.

### 3.4) Global Chat panel scope

The Chat panel is rendered at the `MainLayout` level, not inside any specific page component. This means:

- Chat is accessible while viewing the Scheduler Board, Brand Review, Analytics, or any other page.
- Chat session state persists across page navigation — switching from Scheduler to Brand Review does not reset or hide the conversation.
- The Chat panel has its own session switcher (absorbed from the current Session Rail).

When a user selects a content item on the Scheduler Board and enters the Content Editor, the Chat panel gains **content context awareness**: it knows which content item the user is editing, so AI modification requests ("make the tone warmer") are automatically scoped to that item.

---

## 4) Scheduler Board — Detailed Design

### 4.1) Purpose

The Scheduler Board is the daily operational home. It answers:

- What content is scheduled this week/month?
- What needs my approval before it goes out?
- What is the AI currently generating?
- What has already been published?

### 4.2) Visual structure

```
┌─────────────────────────────────────────────────────────────┐
│  Scheduler Board                                            │
│                                                             │
│  ┌─ View controls ────────────────────────────────────────┐ │
│  │ [Week ▾]  [◀ Mar 3–9 ▶]  [Filter: All ▾]  [+ Content] │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌─────┬─────┬─────┬─────┬─────┬─────┬─────┐             │
│  │ Mon │ Tue │ Wed │ Thu │ Fri │ Sat │ Sun │             │
│  │ 3/3 │ 3/4 │ 3/5 │ 3/6 │ 3/7 │ 3/8 │ 3/9 │             │
│  ├─────┼─────┼─────┼─────┼─────┼─────┼─────┤             │
│  │     │     │     │     │     │     │     │             │
│  │ IG  │     │Blog │     │ IG  │     │     │             │
│  │ 📝  │     │ 📝  │     │ 📸  │     │     │             │
│  │ ✅  │     │ 🟡  │     │ ⏳  │     │     │             │
│  │     │     │     │     │     │     │     │             │
│  └─────┴─────┴─────┴─────┴─────┴─────┴─────┘             │
│                                                             │
│  Campaign: 3월 봄맞이 캠페인                                  │
│  ──────────────────────────────                             │
│  ┌─────┬─────┬─────┬─────┬─────┬─────┬─────┐             │
│  │ Mon │ Tue │ Wed │ Thu │ Fri │ Sat │ Sun │             │
│  │3/10 │3/11 │3/12 │3/13 │3/14 │3/15 │3/16 │             │
│  ├─────┼─────┼─────┼─────┼─────┼─────┼─────┤             │
│  │     │ IG  │ YT  │Blog │     │     │     │             │
│  │     │ 📝  │ 🎬  │ 📝  │     │     │     │             │
│  │     │ 📋  │ 📋  │ 📋  │     │     │     │             │
│  └─────┴─────┴─────┴─────┴─────┴─────┴─────┘             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 4.3) Content card states

Each card on the board represents a single scheduled content item (one `workflow_item`). Cards display:

- Channel icon (Instagram, Blog, YouTube, etc.)
- Content type indicator (text, image, video/shorts)
- Status badge

Status lifecycle:

| Status | Badge | Meaning |
|--------|-------|---------|
| `scheduled` | 📋 Scheduled | Slot exists in plan; content generation not yet triggered |
| `generating` | ⏳ Generating | AI is currently producing the content |
| `pending_approval` | 🟡 Review | Content is ready for user review/approval |
| `approved` | ✅ Approved | User approved; awaiting publish time |
| `published` | 🟢 Published | Content has been posted to the channel |
| `skipped` | ⬜ Skipped | User chose to skip this slot |
| `failed` | 🔴 Failed | Generation or publish error |

### 4.4) View modes

- **Week view** (default): 7-column grid, one row per week. Best for daily management.
- **Month view**: Compact calendar overview. Best for planning visibility.
- **List view**: Flat chronological list with richer metadata per row. Best for bulk review.

### 4.5) Filters

- By campaign (dropdown of active campaigns + "Ad-hoc / No campaign")
- By channel (Instagram, Naver Blog, YouTube, etc.)
- By status (Pending review, Scheduled, All)

### 4.6) Ad-hoc (non-campaign) content

When a user creates content via Chat without a campaign context ("just make me an Instagram post about our event"), the resulting content appears on the Scheduler Board as:

- Scheduled for "today" (or a user-specified date)
- Campaign label: "Ad-hoc" or no campaign tag
- Same card states and editorial workflow as campaign content

This ensures **all publishable content flows through the same board**, regardless of origin. The Scheduler Board is the single source of truth for "what is going out and when."

### 4.7) `[+ Content]` button

A shortcut that opens the Chat panel (if collapsed) with a pre-filled prompt context:

- If clicked from a specific date column: "Create content for [date]"
- If clicked from the general toolbar: opens Chat for a new ad-hoc content request

This button does **not** open a form or modal. Content creation always happens through Chat.

---

## 5) Content Editor — Detailed Design

### 5.1) Activation

Clicking a content card on the Scheduler Board (with status `pending_approval`, `approved`, or `published`) transitions the Main Area from Scheduler Board to Content Editor. This is an **in-place replacement**, not a new page or overlay.

A "← Back to Schedule" link at the top returns to the board. The board scroll position and view state are preserved.

### 5.2) Layout

```
Content Editor (Scheduler Board replaced in-place):

┌────────────────────────────────────────────────────────────┐
│  ← Back to Schedule          3/5 (Wed) · Naver Blog       │
│                               Campaign: 3월 봄맞이          │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                                                      │  │
│  │                Content Preview                       │  │
│  │           (type-specific renderer)                   │  │
│  │                                                      │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                                                      │  │
│  │             Direct Edit Area                         │  │
│  │        (type-specific, see §5.3)                     │  │
│  │                                                      │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  Metadata: Channel · Type · Forbidden check status         │
│  Version: v3 (current) | v2 | v1                          │
│                                                            │
│  [← Prev content]   [Approve]  [Regenerate]  [Skip]  [Reschedule]  [Next content →]  │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### 5.3) Editing boundaries by content type

The guiding principle: **"If a human can do it in 10 seconds by typing, allow direct edit. Beyond that, route through Chat."**

#### Text content (Instagram caption, Naver blog post, Facebook post)

| Capability | Surface | Rationale |
|------------|---------|-----------|
| Edit text directly | Editor textarea / rich-text field | Typo fixes, minor rewording — instant, no AI needed |
| Add/remove hashtags | Editor tag input | Mechanical action, no AI judgment needed |
| Insert emoji, line breaks | Editor | Formatting choice |
| Change overall tone/style | Chat | Requires AI regeneration; direct edit would be a full rewrite |
| Restructure or rewrite from scratch | Chat | AI does this faster and more consistently |

The Editor provides a **plain textarea for short content (captions)** and a **markdown editor for long content (blog posts)**. In the Chat-collapsed state with long content, the Editor switches to a side-by-side layout: preview on the left, edit on the right.

```
Chat-collapsed blog editing:

┌───────────────────────────────────────────────────────────────────┐
│  ← Back to Schedule                        3/5 Blog             │
├──────────────────────────────┬────────────────────────────────────┤
│                              │                                    │
│   Rendered Preview           │   Markdown Editor                  │
│   (read-only)                │   (live editing)                   │
│                              │                                    │
│                              │                                    │
│                              │                                    │
└──────────────────────────────┴────────────────────────────────────┘
│  [← Prev]   [Approve]  [Regenerate]  [Skip]  [Reschedule]  [Next →]  │
└───────────────────────────────────────────────────────────────────┘
```

#### Image content

| Capability | Surface | Rationale |
|------------|---------|-----------|
| Edit accompanying caption | Editor textarea | Same as text content |
| View image at full resolution | Editor (click to zoom) | Judgment requires seeing detail |
| Regenerate image with different prompt | Chat | AI generation required |
| Modify style/composition/color | Chat | AI generation required |

Users **cannot directly edit images**. The Editor shows the image preview and the generation prompt. To change the image, the user describes what they want in Chat.

#### Video / Shorts content

| Capability | Surface | Rationale |
|------------|---------|-----------|
| Edit subtitle/script text | Editor textarea (timecoded) | Quick text fixes |
| Select BGM from presets | Editor dropdown | Mechanical selection |
| Preview video playback | Editor (embedded player) | Requires full-size viewport |
| Reorder scenes | Chat | Structural change, AI re-renders |
| Regenerate specific segment | Chat | AI generation required |
| Full re-generation | Chat | AI generation required |

The Editor provides a **script editor with timecodes** alongside a thumbnail preview. Full video playback is available in an expanded view.

### 5.4) Content navigation

The bottom action bar includes `← Prev content` and `Next content →` buttons. These navigate between content items that match the current board filter (e.g., "pending review" items only). This allows batch-reviewing without returning to the board between each item.

Navigation order follows the board's chronological order.

### 5.5) AI modification via Chat

The Editor does **not** have its own embedded chat input. Instead, when the Editor is active, the global Chat panel gains **content context awareness**:

- The Chat panel header shows: "Editing: 3/5 Naver Blog — 3월 봄맞이"
- Any message the user sends is automatically tagged with `content_id` context
- AI responses that modify the content trigger an automatic refresh of the Editor preview
- The user can clear the content context link in Chat to return to general conversation

This avoids duplicating chat functionality while keeping AI modification seamless.

---

## 6) Global Chat Panel — Detailed Design

### 6.1) Position and behavior

- Rendered at `MainLayout` level, outside page-specific components.
- Right-aligned, 320px default width.
- Collapsible: toggle button on right edge. Collapsed state shows only the toggle.
- Available on all pages (Scheduler, Dashboard, Brand Review, Analytics, Settings).
- Chat state persists across page navigation.

### 6.2) Internal structure

```
┌─────────────────────┐
│  Chat Panel          │
├─────────────────────┤
│  [Session: 3월 캠페인 ▾]  │  ← Session switcher (absorbed from Session Rail)
│  [+ New session]     │
├─────────────────────┤
│                     │
│  Context banner:    │
│  "Editing: 3/5 Blog"│  ← Only shown when Content Editor is active
│  [✕ Clear context]  │
│                     │
│  ┌─────────────────┐│
│  │ Conversation    ││
│  │ timeline        ││
│  │ (scrollable)    ││
│  │                 ││
│  └─────────────────┘│
│                     │
│  ┌─────────────────┐│
│  │ Message input   ││
│  │ [Send]          ││
│  └─────────────────┘│
│                     │
│  Session list (▾)   │  ← Expandable, shows recent sessions
└─────────────────────┘
```

### 6.3) Session management

Current Session Rail features are absorbed:

| Feature | New location |
|---------|-------------|
| Current session indicator | Chat panel header (session name + status) |
| Session switcher | Dropdown in Chat panel header |
| New session creation | Button in Chat panel header |
| Recommended session | Banner inside Chat panel (dismissible) |
| Recent session list | Expandable section at Chat panel bottom |
| Folder update notifications | Banner inside Chat panel |

### 6.4) Content context awareness

When the Content Editor is active:

1. Chat panel shows a **context banner** identifying the content being edited.
2. User messages are sent with `uiContext.focusContentId` and `uiContext.focusWorkflowItemId`.
3. The orchestrator skill router uses this context to scope AI responses to the specific content item.
4. Content modifications by AI trigger a realtime update to the Editor preview via existing Supabase subscription.
5. User can click "✕ Clear context" to detach from the content and use Chat for general conversation.

When no content is being edited, Chat operates in its normal mode (campaign planning, ad-hoc requests, general questions).

### 6.5) Campaign planning flow in Chat

The planning flow happens entirely within a Chat session:

```
User: "Let's plan the April campaign"
AI: "Great. Let me ask a few questions to scope this out..."
    → AI asks structured questions (goals, budget, channels, duration)
    → User answers via text or structured choice widgets

AI: "Here's a draft plan based on your input:"
    → AI presents structured plan summary as a rich chat message
    → (NOT an Inbox card — just a well-formatted message with sections)

User: "Change week 2 theme to Earth Day focus"
AI: → Revised plan presented

User: "Looks good, let's finalize this"
AI: "Plan confirmed. I've registered 16 content slots across 4 weeks."
    → Backend: campaign created, schedule slots populated
    → Scheduler Board now shows the new campaign's content slots
```

The key difference from the current architecture: **the plan never becomes a workflow_item**. It stays in the chat session as a conversational artifact. Only the individual **content slots** generated from the finalized plan become workflow_items on the Scheduler Board.

---

## 7) Data Model Changes

### 7.1) Campaign plan is no longer a workflow_item

Current state: `campaign_plan` is created as a `workflow_item` with `type='campaign_plan'` and enters the approval queue.

New state: Campaign plans are **session artifacts** only. The `campaigns` table stores the finalized plan. No `workflow_item` is created for the plan itself.

The `workflow_items` table is exclusively used for **individual content items** that have a scheduled publish date.

### 7.2) New: `scheduled_slots` concept

When a campaign plan is finalized, the system creates scheduled content slots:

```sql
-- Conceptual schema extension (not final migration SQL)
-- Each slot = one content piece in the calendar

-- Option A: Extend workflow_items with scheduling fields
ALTER TABLE workflow_items ADD COLUMN scheduled_date date;
ALTER TABLE workflow_items ADD COLUMN scheduled_time timestamptz;
ALTER TABLE workflow_items ADD COLUMN channel text;
ALTER TABLE workflow_items ADD COLUMN campaign_id uuid REFERENCES campaigns(id);

-- Option B: Separate schedule_slots table that links to workflow_items
CREATE TABLE schedule_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  campaign_id uuid REFERENCES campaigns(id),  -- nullable for ad-hoc content
  workflow_item_id uuid REFERENCES workflow_items(id),  -- nullable until content is generated
  channel text NOT NULL,
  content_type text NOT NULL,  -- 'text', 'image', 'video'
  scheduled_date date NOT NULL,
  scheduled_time timestamptz,
  status text NOT NULL DEFAULT 'scheduled',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

Decision between Option A and Option B is deferred to implementation planning. Option B provides cleaner separation (a slot can exist before any content is generated) but adds a join. Option A is simpler but overloads `workflow_items`.

### 7.3) Scheduler engine (new backend concern)

A new backend component is needed: the **Scheduler Engine**. Its responsibilities:

1. **Time-based trigger**: When a slot's scheduled date/time arrives (or a configurable lead time before), trigger content generation for that slot.
2. **Auto-publish**: When an approved content item reaches its scheduled publish time, execute the publish action.
3. **Missed schedule handling**: If the scheduled time passes without generation or approval, mark the slot and notify the user.

Implementation options:

- **Polling-based** (MVP): A periodic job (e.g., every 5 minutes) scans for slots that need action.
- **Supabase Edge Function + pg_cron** (recommended): Database-level cron triggers that call the API to initiate content generation.
- **External scheduler** (future): Dedicated job queue (BullMQ, Temporal) for production-grade scheduling.

For the initial implementation, a polling-based approach within the existing API server is sufficient.

---

## 8) Migration Path from Current Architecture

### 8.1) What stays

| Component | Status | Notes |
|-----------|--------|-------|
| `workflow_items` + `workflow_events` | **Kept** | Scope narrowed to content items only |
| `workflow/service.ts` (state machine) | **Kept** | Same approve/reject/revision transitions |
| Orchestrator session + step machine | **Kept** | Campaign planning sessions remain conversational |
| `chat_messages` table | **Kept** | Chat history unchanged |
| Content generation AI chain | **Kept** | Same content draft generation logic |
| 4-step campaign plan chain | **Kept** | Used at plan finalization to produce structured plan + schedule |
| Idempotency / version control | **Kept** | Applied to content workflow_items |
| `ChatContext` provider | **Modified** | Decoupled from page, becomes global |

### 8.2) What changes

| Component | Change | Reason |
|-----------|--------|--------|
| `Workspace.tsx` (3-panel) | **Replaced** by `SchedulerPage.tsx` | New layout model |
| `InboxPanel.tsx` | **Deleted** | Inbox concept replaced by Scheduler Board |
| `SessionRailPanel.tsx` | **Deleted** | Absorbed into Global Chat panel |
| `WorkspaceChatPanel.tsx` | **Replaced** by `GlobalChatPanel.tsx` | Chat becomes layout-level, not page-level |
| Navigation types | `"workspace"` → `"scheduler"` | Semantic rename |
| `FULL_WIDTH_PAGES` | `["scheduler", "settings"]` | Scheduler uses full width (with Chat as overlay) |
| Campaign action-card projection | **Removed** | Campaign plans no longer projected as action cards |
| `campaign_plan` workflow_item creation | **Removed** | Plans are session artifacts, not workflow items |

### 8.3) What is new

| Component | Purpose |
|-----------|---------|
| `SchedulerPage.tsx` | Main page: Scheduler Board + Content Editor (mode switch) |
| `SchedulerBoard.tsx` | Calendar/timeline board component |
| `ContentEditor.tsx` | In-place content editing component (type-dispatched) |
| `TextContentEditor.tsx` | Text content (caption, blog) editing subcomponent |
| `ImageContentEditor.tsx` | Image content preview + prompt editing subcomponent |
| `VideoContentEditor.tsx` | Video/shorts preview + script editing subcomponent |
| `GlobalChatPanel.tsx` | Layout-level chat panel with session management |
| `SchedulerEngine` (backend) | Time-based content generation trigger + auto-publish |
| `schedule_slots` or extended `workflow_items` | Calendar-aware content scheduling data |

---

## 9) Implementation Phases

### Phase S-1: Scheduler Board Shell + Navigation Restructure

**Goal**: Replace Workspace with Scheduler page, render basic calendar grid with mock data.

Scope:
- Navigation rename: `"workspace"` → `"scheduler"`.
- `SchedulerPage.tsx` with week-view calendar grid (static/mock data).
- Delete `InboxPanel.tsx`, `SessionRailPanel.tsx`, `WorkspaceChatPanel.tsx`.
- `GlobalChatPanel.tsx` stub at `MainLayout` level (reuses `ChatContext`).
- Session switcher moved into Chat panel header.
- CSS grid layout for Scheduler Board.

Backend: No changes.

### Phase S-2: Scheduler Data Integration

**Goal**: Connect Scheduler Board to real workflow_items + schedule data.

Scope:
- Backend API: `GET /orgs/:orgId/scheduled-content` — returns content items with schedule metadata, grouped by date.
- Frontend: `SchedulerBoard.tsx` fetches and renders real data.
- Content card component with status badges, channel icons.
- View mode switching (week/month/list).
- Filter controls (campaign, channel, status).

Backend: New API endpoint. Possible schema extension for scheduling fields.

### Phase S-3: Content Editor (Text)

**Goal**: Implement in-place Content Editor for text content types.

Scope:
- Board card click → Editor mode transition (in-place replacement).
- `TextContentEditor.tsx`: textarea for captions, markdown editor for blog posts.
- Direct text editing + save.
- Content navigation (← Prev / Next →).
- Approve / Regenerate / Skip / Reschedule actions.
- Chat panel content context awareness (context banner, `focusContentId` in messages).

Backend: Content update API (direct text edit path, bypassing AI regeneration).

### Phase S-4: Content Editor (Image + Video)

**Goal**: Extend Content Editor for non-text content types.

Scope:
- `ImageContentEditor.tsx`: image preview, caption editing, generation prompt display.
- `VideoContentEditor.tsx`: thumbnail, timecoded script editor, BGM selector, embedded player.
- Chat-driven regeneration flow for images and video.

Backend: Image/video regeneration API integration.

### Phase S-5: Campaign Planning Flow Redesign

**Goal**: Restructure campaign plan creation to be a chat-only conversational flow that produces schedule slots.

Scope:
- Remove `campaign_plan` workflow_item creation from orchestrator.
- Campaign plan finalization → schedule slot population (backend).
- Chat-based structured interview flow (AI asks scoping questions).
- Rich plan summary messages in chat (not action cards).
- "Plan confirmed" → slots appear on Scheduler Board.

Backend: Schedule slot creation from campaign plan. Campaign skill refactor.

### Phase S-6: Scheduler Engine (Time-Based Triggers)

**Goal**: Automate content generation and publishing based on schedule.

Scope:
- Polling job or cron-based trigger for upcoming schedule slots.
- Auto-generation trigger: slot reaches lead time → create content draft.
- Auto-publish trigger: approved content reaches publish time → execute publish.
- Missed schedule detection and user notification.
- User preference: auto-approve toggle (opt-in after trust is built).

Backend: Scheduler engine implementation.

---

## 10) Key Design Decisions

### 10.1) Why mode-switching instead of split panels?

On a typical 1920×1080 desktop screen, usable app area is approximately 1600×900px after chrome. Splitting this vertically (scheduler top, editor bottom) gives each surface ~450px height — insufficient for either a useful calendar or a comfortable editor.

Mode-switching gives the editor the full ~900px height, which is critical for:
- Blog post markdown editing (needs vertical scroll space)
- Image preview at meaningful resolution
- Video playback with script alongside

The tradeoff (losing scheduler visibility during editing) is acceptable because users do not need to see the calendar while editing a specific content item. The "← Back to Schedule" link and Prev/Next navigation eliminate the friction of this transition.

### 10.2) Why Global Chat instead of per-editor mini-chat?

Fragmenting chat into per-content mini-conversations creates:
- Context isolation (AI loses campaign-level context when scoped to one content item)
- Session management confusion (which chat has my conversation about the blog post?)
- Duplicate UI surface maintenance

A single global Chat with content context awareness provides:
- Full conversation history in one place
- Campaign-level and content-level discussions in the same session
- Simpler architecture (one ChatContext, one session switcher)

### 10.3) Why allow direct text editing at all?

Pure Chat-mediated editing (every change goes through AI) has three failure modes:
- **Latency tax**: Fixing a typo takes 5–15 seconds instead of 1 second.
- **Token waste**: Regenerating an entire post to change one word.
- **Precision failure**: AI might "fix" the typo but also alter other parts of the text.

Direct editing for simple text changes respects the user's time and intelligence. The boundary (direct edit for quick fixes, Chat for structural changes) maps to how human editors naturally work with drafts.

### 10.4) How ad-hoc content enters the board

Ad-hoc (non-campaign) content created via Chat is assigned:
- `campaign_id`: null (or a default "ad-hoc" bucket)
- `scheduled_date`: today (default) or user-specified
- `status`: `pending_approval` (if generated successfully)

It appears on the Scheduler Board alongside campaign content, distinguished by a visual label ("Ad-hoc" tag or no campaign badge). This ensures the board is the **single source of truth for all outgoing content**.

### 10.5) Campaign plan as session artifact, not workflow_item

This is the most significant architectural shift. Implications:

- The `ensureCampaignWorkflowItemForState` path is removed or bypassed for campaign plans.
- The `emitCampaignActionCardProjection` function is no longer called.
- Campaign plan data remains in `campaigns` table (plan, plan_document, plan_chain_data).
- Campaign skill's `await_campaign_approval` step is replaced by a conversational finalization flow.
- The session step machine for campaign planning becomes: `await_user_input` → (multi-turn conversation) → `plan_finalized` → `done`.

---

## 11) Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Scheduler Board is a fundamentally new UI surface with no existing code to build on | High | Phase S-1 delivers shell with mock data first; validate layout before connecting real data |
| Calendar rendering at different zoom levels is complex (week/month/list) | Medium | Start with week view only in S-1/S-2; add month and list in follow-up |
| Scheduler Engine (time-based triggers) is a new backend pattern not yet in the codebase | High | Defer to Phase S-6; use manual trigger via Chat for S-1 through S-5 |
| Content Editor needs three separate type-specific renderers | Medium | Build text first (S-3); image and video are additive (S-4) |
| Global Chat panel at MainLayout level requires ChatContext restructuring | Medium | ChatContext is already global; main change is rendering location, not state ownership |
| Migration from current Workspace breaks existing page structure | Low | Current Workspace (S5a) is recent; no external dependencies on its URL/route structure |
| Direct text editing creates two mutation paths (user edit vs. AI regeneration) for the same content | Medium | Clear save-vs-regenerate action separation; version history tracks both paths |

---

## 12) Success Criteria

1. **Daily management in under 5 minutes**: A user with 5 pending-approval items can review and approve all of them without leaving the Scheduler page.
2. **Campaign planning stays in Chat**: A complete campaign plan can be created, debated, revised, and finalized within a single Chat session without navigating to any other surface.
3. **Ad-hoc content uses the same flow**: Creating a one-off Instagram post via Chat results in the content appearing on the Scheduler Board for approval, using the same editorial workflow as campaign content.
4. **Chat is always accessible**: On any page, the user can open Chat, send a message, and receive a response without page navigation.
5. **Direct edits are instant**: Changing a typo in a caption and saving takes under 2 seconds with no AI round-trip.
6. **Scheduled content generates automatically**: When Phase S-6 is complete, content for upcoming schedule slots is generated without user initiation, appearing on the board for review.
