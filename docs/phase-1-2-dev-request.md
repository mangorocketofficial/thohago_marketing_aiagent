# Phase 1-2 Development Request
## Marketing AI Agent Platform — Local File Watcher Daemon

> Status update (2026-02-28): Superseded by Electron pivot (`docs/architecture-pivot-electron.md`).  
> `services/daemon` and cloud `local_files` indexing are deprecated starting Phase 1-3.

---

## Overview

This document defines the full scope of **Phase 1-2**: the local file watcher daemon. The daemon runs as a background process on the user's machine, monitors a designated marketing folder, and indexes file metadata into Supabase. The folder structure itself serves as activity context for the AI agent in later phases.

**Depends on:** Phase 1-1 (Foundation Setup) — schema, RLS, seed data, and `packages/db` must be complete.

---

## Objectives

- [ ] Implement `setup.py` — one-time onboarding: create watch folder + write `.env`
- [ ] Implement `watcher.py` — recursive folder monitoring via `watchdog`
- [ ] Implement `indexer.py` — file metadata extraction + Supabase upsert
- [ ] Implement `supabase_client.py` — singleton Supabase connection using service role key
- [ ] Apply Supabase schema migration for Phase 1-2 additions to `local_files`
- [ ] Verify end-to-end: file dropped into folder → row appears in `local_files`

---

## 1. Folder Structure Convention

The watch root contains one level of **activity subfolders**. Each subfolder represents a marketing activity or campaign. Files sit inside activity subfolders.

```
WFK_Marketing/                     ← watch root (WATCH_PATH)
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

| Depth | Description | Handled |
|-------|-------------|---------|
| Root (`WFK_Marketing/`) | Watch root only | Not indexed |
| Depth 1 (`탄자니아교육봉사/`) | Activity folder | Folder name stored as `activity_folder` |
| Depth 2 (`현장사진01.jpg`) | Target files | Indexed into `local_files` |
| Depth 3+ | Nested subfolders | Ignored (log warning, skip) |

> Files dropped directly into the watch root (depth 1 files) are also ignored with a warning. All indexed files must be inside an activity subfolder.

---

## 2. Schema Migration

Add two columns to the existing `local_files` table.

**Migration file:** `supabase/migrations/20260227200000_phase_1_2_local_files.sql`

```sql
-- Add activity folder context
alter table local_files
  add column activity_folder text not null default '',
  add column status           text not null default 'active'
    check (status in ('active', 'deleted'));

-- Index for activity-scoped queries
create index local_files_activity_folder_idx
  on local_files (org_id, activity_folder);

-- Index for soft-delete filtering
create index local_files_status_idx
  on local_files (org_id, status);

-- Ensure conflict target exists for upsert
create unique index local_files_org_file_path_uniq
  on local_files (org_id, file_path);
```

### Updated `local_files` Schema (full)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `org_id` | uuid | FK → organizations, NOT NULL |
| `file_name` | text | filename only, NOT NULL |
| `file_path` | text | absolute local path, NOT NULL |
| `file_type` | text | `image` / `video` / `document` |
| `file_size` | bigint | bytes |
| `thumbnail_url` | text | null (deferred to later phase) |
| `activity_folder` | text | parent subfolder name, NOT NULL |
| `status` | text | `active` / `deleted`, default `active` |
| `metadata` | jsonb | extension, mime_type, modified_at, etc. |
| `indexed_at` | timestamptz | set on insert |

---

## 3. Updated TypeScript Types

Add to `packages/types/src/index.ts`:

```typescript
export type FileStatus = 'active' | 'deleted'

export type LocalFile = {
  id: string
  org_id: string
  file_name: string
  file_path: string
  file_type: FileType
  file_size: number | null
  thumbnail_url: string | null
  activity_folder: string          // ← new
  status: FileStatus               // ← new
  metadata: Record<string, unknown>
  indexed_at: string
}
```

---

## 4. Daemon File Structure

```
services/daemon/
├── main.py                ← entry point, assembles and starts everything
├── setup.py               ← one-time onboarding script
├── config.py              ← loads and validates .env
├── watcher.py             ← watchdog event handler
├── indexer.py             ← metadata extraction + Supabase upsert
├── supabase_client.py     ← Supabase singleton (service role)
├── requirements.txt
├── .env.example
└── .env                   ← git-ignored, written by setup.py
```

---

## 5. Implementation Details

### 5.1 `setup.py` — One-time Onboarding

Run once during user onboarding. Creates the watch folder and writes `.env`.

```python
"""
One-time onboarding setup.
Run: python setup.py
"""
import os

def run_setup():
    print("=== Marketing AI Agent — Setup ===\n")

    # 1. Ask for folder location
    default_path = os.path.expanduser("~/Documents/WFK_Marketing")
    raw = input(f"Marketing folder location [Enter for default: {default_path}]: ").strip()
    watch_path = raw if raw else default_path

    # 2. Create folder
    os.makedirs(watch_path, exist_ok=True)
    print(f"✅ Folder created: {watch_path}")

    # 3. Read existing .env if present
    env_path = os.path.join(os.path.dirname(__file__), ".env")
    existing_lines = []
    if os.path.exists(env_path):
        with open(env_path, "r") as f:
            existing_lines = [
                line for line in f.readlines()
                if not line.startswith("WATCH_PATH=")
            ]

    # 4. Write updated .env
    with open(env_path, "w") as f:
        f.writelines(existing_lines)
        f.write(f"WATCH_PATH={watch_path}\n")

    print("✅ WATCH_PATH written to .env")
    print("\nSetup complete.")
    print(f"Put your marketing project folders inside:\n  {watch_path}")
    print("\nExample structure:")
    print(f"  {watch_path}/탄자니아교육봉사/사진01.jpg")
    print(f"  {watch_path}/봉사단원모집/포스터.png")

if __name__ == "__main__":
    run_setup()
```

### 5.2 `config.py` — Environment Config

```python
import os
from dotenv import load_dotenv

load_dotenv()

def get_config() -> dict:
    required = [
        "SUPABASE_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
        "ORG_ID",
        "WATCH_PATH",
    ]
    config = {}
    missing = []

    for key in required:
        val = os.getenv(key)
        if not val:
            missing.append(key)
        config[key] = val

    if missing:
        raise EnvironmentError(
            f"Missing required environment variables: {', '.join(missing)}\n"
            "Run setup.py first if WATCH_PATH is missing."
        )

    if not os.path.isdir(config["WATCH_PATH"]):
        raise FileNotFoundError(
            f"WATCH_PATH does not exist: {config['WATCH_PATH']}\n"
            "Run setup.py to create the folder."
        )

    return config
```

### 5.3 `supabase_client.py` — Singleton Connection

```python
from supabase import create_client, Client

_client: Client | None = None

def get_supabase(url: str, service_role_key: str) -> Client:
    global _client
    if _client is None:
        _client = create_client(url, service_role_key)
    return _client
```

> Uses service role key to bypass RLS. The daemon is trusted because `ORG_ID` is locked to a single org via `.env`.

### 5.4 `indexer.py` — Metadata Extraction + Upsert

```python
import os
import mimetypes
from datetime import datetime, timezone
from supabase import Client

# Supported file extensions
SUPPORTED_EXTENSIONS = {
    # Images
    '.jpg', '.jpeg', '.png', '.webp', '.gif',
    # Videos
    '.mp4', '.mov', '.avi',
    # Documents
    '.pdf', '.docx', '.hwp', '.pptx', '.xlsx',
}

def get_file_type(extension: str) -> str:
    image_exts = {'.jpg', '.jpeg', '.png', '.webp', '.gif'}
    video_exts = {'.mp4', '.mov', '.avi'}
    if extension in image_exts:
        return 'image'
    if extension in video_exts:
        return 'video'
    return 'document'

def extract_activity_folder(file_path: str, watch_root: str) -> str | None:
    """
    Extract the activity subfolder name from an absolute file path.
    
    watch_root: /Users/user/Documents/WFK_Marketing
    file_path:  /Users/user/Documents/WFK_Marketing/탄자니아교육봉사/사진01.jpg
    returns:    "탄자니아교육봉사"
    
    Returns None if file is not exactly 2 levels deep.
    """
    rel = os.path.relpath(file_path, watch_root)
    parts = rel.split(os.sep)
    if len(parts) != 2:
        return None
    return parts[0]

def index_file(
    file_path: str,
    watch_root: str,
    org_id: str,
    supabase: Client,
) -> None:
    ext = os.path.splitext(file_path)[1].lower()

    if ext not in SUPPORTED_EXTENSIONS:
        return

    activity_folder = extract_activity_folder(file_path, watch_root)
    if activity_folder is None:
        print(f"[SKIP] File not in activity subfolder (wrong depth): {file_path}")
        return

    stat = os.stat(file_path)
    mime_type, _ = mimetypes.guess_type(file_path)

    row = {
        "org_id": org_id,
        "file_name": os.path.basename(file_path),
        "file_path": file_path,
        "file_type": get_file_type(ext),
        "file_size": stat.st_size,
        "thumbnail_url": None,
        "activity_folder": activity_folder,
        "status": "active",
        "metadata": {
            "extension": ext,
            "mime_type": mime_type,
            "modified_at": datetime.fromtimestamp(
                stat.st_mtime, tz=timezone.utc
            ).isoformat(),
        },
    }

    # Upsert: (org_id, file_path) is the unique key
    supabase.table("local_files").upsert(
        row,
        on_conflict="org_id,file_path"
    ).execute()

    print(f"[INDEXED] {activity_folder}/{os.path.basename(file_path)}")

def soft_delete_file(
    file_path: str,
    org_id: str,
    supabase: Client,
) -> None:
    supabase.table("local_files").update(
        {"status": "deleted"}
    ).eq("file_path", file_path).eq("org_id", org_id).execute()

    print(f"[DELETED] {os.path.basename(file_path)}")
```

### 5.5 `watcher.py` — Watchdog Event Handler

```python
import time
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
from indexer import index_file, soft_delete_file
from supabase import Client

class MarketingFolderHandler(FileSystemEventHandler):

    def __init__(self, watch_root: str, org_id: str, supabase: Client):
        self.watch_root = watch_root
        self.org_id = org_id
        self.supabase = supabase

    def on_created(self, event):
        if event.is_directory:
            return
        index_file(event.src_path, self.watch_root, self.org_id, self.supabase)

    def on_modified(self, event):
        if event.is_directory:
            return
        index_file(event.src_path, self.watch_root, self.org_id, self.supabase)

    def on_deleted(self, event):
        if event.is_directory:
            return
        soft_delete_file(event.src_path, self.org_id, self.supabase)

    def on_moved(self, event):
        if event.is_directory:
            return
        # Treat as delete old + create new
        soft_delete_file(event.src_path, self.org_id, self.supabase)
        index_file(event.dest_path, self.watch_root, self.org_id, self.supabase)


def start_watcher(watch_root: str, org_id: str, supabase: Client) -> None:
    handler = MarketingFolderHandler(watch_root, org_id, supabase)
    observer = Observer()
    observer.schedule(handler, watch_root, recursive=True)
    observer.start()
    print(f"[WATCHER] Monitoring: {watch_root}")
    print("[WATCHER] Press Ctrl+C to stop.\n")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()
```

### 5.6 `main.py` — Entry Point

```python
"""
Marketing AI Agent — Local File Watcher Daemon
Run: python main.py
"""
from config import get_config
from supabase_client import get_supabase
from indexer import index_file
from watcher import start_watcher
import os

def initial_scan(watch_root: str, org_id: str, supabase) -> None:
    """
    On startup, scan existing files and index any that are missing.
    Ensures files added while the daemon was offline are not missed.
    """
    print("[SCAN] Running initial scan...")
    count = 0
    for root, dirs, files in os.walk(watch_root):
        # Skip files directly in watch root (must be in activity subfolder)
        if root == watch_root:
            continue
        for file in files:
            full_path = os.path.join(root, file)
            index_file(full_path, watch_root, org_id, supabase)
            count += 1
    print(f"[SCAN] Initial scan complete. {count} files processed.\n")

def main():
    print("=== Marketing AI Agent Daemon ===\n")

    config = get_config()

    supabase = get_supabase(
        config["SUPABASE_URL"],
        config["SUPABASE_SERVICE_ROLE_KEY"],
    )

    print(f"[INFO] Org ID: {config['ORG_ID']}")
    print(f"[INFO] Watch path: {config['WATCH_PATH']}\n")

    # Scan existing files on startup
    initial_scan(config["WATCH_PATH"], config["ORG_ID"], supabase)

    # Start continuous watcher
    start_watcher(config["WATCH_PATH"], config["ORG_ID"], supabase)

if __name__ == "__main__":
    main()
```

---

## 6. Requirements

**`requirements.txt`**

```
watchdog==4.0.1
supabase==2.4.0
python-dotenv==1.0.1
```

**`.env.example`**

```bash
# Supabase (use service role key — bypasses RLS)
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# Organization (fixed to one org per daemon install)
ORG_ID=a1b2c3d4-0000-0000-0000-000000000001

# Watch path (written automatically by setup.py)
WATCH_PATH=
```

---

## 7. Supported File Types

| Category | Extensions |
|----------|-----------|
| Image | `.jpg` `.jpeg` `.png` `.webp` `.gif` |
| Video | `.mp4` `.mov` `.avi` |
| Document | `.pdf` `.docx` `.hwp` `.pptx` `.xlsx` |

All other extensions are silently ignored.

---

## 8. Soft Delete vs Hard Delete

When a file is deleted locally, the daemon calls `soft_delete_file()` which sets `status = 'deleted'` rather than removing the row.

**Reason:** The AI agent in later phases may have already referenced the file to generate content drafts. Hard deletion would break those references. Soft delete preserves history while filtering deleted files from active queries.

Active file query pattern (to be used by all consumers):

```sql
select * from local_files
where org_id = $1
  and status = 'active'
order by indexed_at desc;
```

---

## 9. Initial Scan on Startup

On every startup, `main.py` runs a full scan of the watch folder before starting the live watcher. This catches any files that were added or modified while the daemon was not running (e.g., overnight, after reboot).

The `upsert` on `file_path` ensures no duplicates are created.

---

## 10. Acceptance Criteria

Phase 1-2 is complete when all of the following are verified:

- [ ] `python setup.py` creates the watch folder and writes `WATCH_PATH` to `.env`
- [ ] `python main.py` starts without errors using seed org credentials
- [ ] Initial scan runs on startup and indexes all pre-existing files in the watch folder
- [ ] Dropping a new image into an activity subfolder → row appears in `local_files` within 2 seconds
- [ ] Modifying a file → existing row is updated (`upsert` confirmed)
- [ ] Deleting a file → row `status` changes to `deleted` (not removed)
- [ ] Moving a file → old path soft-deleted, new path indexed
- [ ] File placed directly in watch root (not in subfolder) → skipped with log warning
- [ ] File with unsupported extension → silently ignored
- [ ] File nested 3+ levels deep → skipped with log warning
- [ ] `activity_folder` column correctly reflects the parent subfolder name
- [ ] Schema migration applies cleanly on top of Phase 1-1

---

## 11. Out of Scope for Phase 1-2

- Thumbnail generation (deferred)
- AI analysis of file content (Phase 1-3)
- Web dashboard display of indexed files
- Auto-start on system boot / `.exe` packaging (later phase)
- Telegram notifications on new file detection

---

## Notes for Developer

- The daemon uses `SUPABASE_SERVICE_ROLE_KEY` (not anon key) because it runs outside of a user session and needs to write to `local_files` without RLS blocking. This is safe because the daemon is locked to a single `ORG_ID` in `.env`.
- Upsert conflict target must be `(org_id, file_path)`. Ensure this is guaranteed by a unique index/constraint (added in the Phase 1-2 migration above).
- Korean folder/file names must be handled correctly. Ensure the Python environment uses UTF-8 encoding (`PYTHONIOENCODING=utf-8` if needed on Windows).
- The `on_modified` event fires multiple times for a single save on some OS/editors. This is safe because `upsert` is idempotent.

---

*Document version: v1.0*
*Phase: 1-2 Local File Watcher Daemon*
*Depends on: Phase 1-1 (Foundation Setup)*
*Created: 2026-02-27*
