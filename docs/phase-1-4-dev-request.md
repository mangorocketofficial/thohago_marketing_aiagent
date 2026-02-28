# Phase 1-4 Development Request
## Marketing AI Agent Platform — Electron File Watcher & Onboarding

---

## Overview

This document defines the scope of **Phase 1-4**: first-run onboarding, local file watching in Electron main process, IPC event bridge to renderer, and secure pipeline trigger emission.

Phase 1-4 replaces the deprecated Python daemon workflow from Phase 1-2 with an Electron-native runtime.

**Depends on:** Phase 1-3 (Electron Pivot) — `apps/desktop` scaffold must exist.

---

## Security and Data Principles (Critical)

1. Desktop app **must not** embed Supabase `service_role` key.
2. Desktop app writes pipeline triggers through a **server-side relay** (API/Edge Function), not direct privileged DB writes.
3. Trigger payload stores `relative_path` (watch root relative), not local absolute path.
4. `FileEntry` is desktop-runtime local type; only `PipelineTrigger` is shared cross-package type.

---

## Objectives

- [ ] Implement first-run onboarding flow: choose/create watch folder via native dialog
- [ ] Implement `chokidar` watcher in Electron main process (`apps/desktop/electron/*`)
- [ ] Implement in-memory file index (local runtime cache, no `local_files` table)
- [ ] Implement IPC bridge (main -> renderer events, renderer -> main commands)
- [ ] On live new/changed file: send trigger to secure relay endpoint for `pipeline_triggers`
- [ ] Implement async initial scan on startup (rebuild cache without blocking renderer)
- [ ] Implement duplicate-trigger protection using `source_event_id`/dedupe window

---

## 1. Folder Structure Convention

```
WFK_Marketing/                      <- watch root
├── 탄자니아교육봉사/
│   ├── 현장사진01.jpg
│   ├── 활동보고서.hwp
│   └── 하이라이트.mp4
├── 봉사단원모집/
│   ├── 포스터초안.png
│   └── 모집요강.pdf
└── 3월보고/
    ├── 통계자료.xlsx
    └── 사진모음.zip
```

### Depth Rules

| Depth | Description | Action |
|-------|-------------|--------|
| Root (`WFK_Marketing/`) | Watch root | Not indexed |
| Depth 1 (activity folder) | Activity unit | Captured as `activityFolder` |
| Depth 2 (files) | Target files | Indexed in memory, may emit trigger |
| Depth 3+ | Nested folders/files | Skip + warning |

---

## 2. Architecture (Phase 1-4)

```
Electron Main (apps/desktop/electron)
├── config-store.mjs         <- JSON config under app userData
├── watcher.mjs              <- chokidar + async scan
├── file-index.mjs           <- in-memory runtime cache
├── pipeline-trigger-relay.mjs <- secure relay HTTP client
└── main.mjs                 <- app lifecycle + IPC wiring

Electron Preload
└── preload.mjs              <- typed bridge + unsubscribe-based listeners

Electron Renderer (apps/desktop/src)
├── onboarding UI            <- first run folder setup
└── dashboard UI             <- watcher status + active files
```

---

## 3. Onboarding and Config Storage

On first launch, if no `watchPath` exists in local config, renderer shows onboarding before runtime start.

### Flow

```
App start
  -> getStatus (watchPath exists?)
  -> No: show onboarding
  -> choose/create folder via native dialog
  -> onboarding:complete
  -> persist config
  -> run initial scan
  -> start live watcher
```

### Config Storage Decision

Phase 1-4 uses local JSON config (`app.getPath('userData')`) instead of `electron-store`.

Reason:
- avoids immediate ESM packaging edge-cases from `electron-store` v8+
- keeps config layer simple while packaging is out of scope

Config keys:
- `watchPath`
- `orgId` (Phase 1-4 fixed seed org)

---

## 4. File Watcher Design

### 4.1 Supported Extensions

- Images: `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`
- Videos: `.mp4`, `.mov`, `.avi`
- Documents: `.pdf`, `.docx`, `.hwp`, `.pptx`, `.xlsx`

### 4.2 FileEntry (Desktop-local only)

`FileEntry` is **not** shared in `packages/types`. It remains in desktop runtime only.

Runtime fields:
- `filePath` (absolute, local only)
- `relativePath` (watch-root relative)
- `fileName`, `activityFolder`, `fileType`, `fileSize`, `extension`
- `detectedAt`, `modifiedAt`, `status`

### 4.3 Initial Scan and Live Events

- Initial scan is async (`fs.promises`) and rebuilds in-memory cache.
- Initial scan does **not** emit pipeline triggers.
- Live watcher handles `add/change/unlink` with:
  - depth/extension validation
  - in-memory upsert/soft-delete
  - IPC event emission
  - trigger relay write for live upserts only

### 4.4 Duplicate Trigger Control

Use event dedupe window + `source_event_id`:
- dedupe key includes org + relativePath + file size + modified timestamp + event type
- short in-memory dedupe window suppresses noisy duplicate writes

---

## 5. Pipeline Trigger Schema

**Migration:** `supabase/migrations/20260228100000_phase_1_4_pipeline_triggers.sql`

```sql
create table if not exists public.pipeline_triggers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  relative_path text not null,
  file_name text not null,
  activity_folder text not null,
  file_type text not null check (file_type in ('image', 'video', 'document')),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'done', 'failed')),
  source_event_id text,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_pipeline_triggers_org_source_event_id
  on public.pipeline_triggers (org_id, source_event_id)
  where source_event_id is not null;

create index if not exists idx_pipeline_triggers_org_status_created_at
  on public.pipeline_triggers (org_id, status, created_at);

alter table public.pipeline_triggers enable row level security;
alter table public.pipeline_triggers force row level security;
```

---

## 6. Trigger Emission Strategy

Desktop runtime sends HTTP request to a secure relay endpoint (server/edge):

- Env: `PIPELINE_TRIGGER_ENDPOINT`
- Optional header: `x-trigger-token` from `PIPELINE_TRIGGER_TOKEN`
- Payload includes:
  - `org_id`
  - `relative_path`
  - `file_name`
  - `activity_folder`
  - `file_type`
  - `source_event_id`

No local absolute path is sent to Supabase.

---

## 7. IPC Contract

### Main -> Renderer

- `file:indexed` -> renderer-safe file payload
- `file:deleted` -> `{ relativePath, fileName }`
- `file:scan-complete` -> `{ count }`
- `watcher:status-changed` -> watcher status snapshot
- `app:show-onboarding` -> onboarding display trigger

### Renderer -> Main

- `watcher:get-status`
- `watcher:get-files`
- `watcher:open-folder`
- `onboarding:choose-folder`
- `onboarding:create-folder`
- `onboarding:complete`

### Listener Cleanup Requirement

Preload `on*` APIs must return `unsubscribe` function and renderer must call it in `useEffect` cleanup.

---

## 8. Shared Types Update

In `packages/types`, only add shared DB type:
- `PipelineTriggerStatus`
- `PipelineTrigger`

Do **not** move desktop-local `FileEntry` into shared package.

---

## 9. Dependencies

Desktop dependencies:
- `chokidar@^3.6.0`

Version note:
- v3 is pinned for stability in current runtime.
- v4 migration is separate future task (breaking change review required).

---

## 10. Acceptance Criteria

- [ ] First-run with no `watchPath` shows onboarding
- [ ] Folder choose/create works via native dialog and persists config
- [ ] Existing `watchPath` triggers async initial scan and in-memory cache rebuild
- [ ] New file in activity folder emits `file:indexed` within 2s after write stabilization
- [ ] Delete file emits `file:deleted` and marks runtime entry deleted
- [ ] Root-level file skipped with warning
- [ ] Nested depth 3+ skipped with warning
- [ ] Unsupported extension ignored
- [ ] Live upsert emits secure relay trigger request
- [ ] Initial scan emits **no** trigger requests
- [ ] Trigger payload stores `relative_path` (no absolute path in DB payload)
- [ ] Duplicate trigger suppression works (dedupe window/source_event_id)
- [ ] No service-role key usage in desktop runtime code
- [ ] `pnpm type-check` passes
- [ ] `pnpm build` passes
- [ ] Migration applies cleanly after Phase 1-3

---

## 11. Out of Scope

- AI pipeline consumer/processor runtime (Phase 1-5)
- ffmpeg/image generation pipeline implementation
- Telegram feature integration
- auto-start on OS boot
- desktop packaging/signing/auto-update

---

## Notes for Developer

- Production key management:
  - desktop must not store privileged DB keys in plaintext
  - if relay auth token is used, move to secure storage (`safeStorage`) before production
- Korean paths must be validated on Windows/macOS during watcher E2E
- Keep file-path semantics explicit:
  - local runtime: absolute path allowed
  - cloud payload: relative path only

---

*Document version: v1.1*
*Phase: 1-4 Electron File Watcher & Onboarding*
*Depends on: Phase 1-3 (Electron Pivot)*
*Updated: 2026-02-28*
