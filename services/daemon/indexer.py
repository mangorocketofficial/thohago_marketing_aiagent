import mimetypes
import os
import time
from datetime import datetime, timezone
from typing import Optional

from supabase import Client

SUPPORTED_EXTENSIONS = {
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".gif",
    ".mp4",
    ".mov",
    ".avi",
    ".pdf",
    ".docx",
    ".hwp",
    ".pptx",
    ".xlsx",
}

MAX_ATTEMPTS = 3
RETRY_BASE_SECONDS = 0.35


def get_file_type(extension: str) -> str:
    if extension in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
        return "image"
    if extension in {".mp4", ".mov", ".avi"}:
        return "video"
    return "document"


def extract_activity_folder(file_path: str, watch_root: str) -> Optional[str]:
    rel = os.path.relpath(file_path, watch_root)
    if rel.startswith(".."):
        return None

    parts = rel.split(os.sep)
    if len(parts) != 2:
        return None

    return parts[0]


def _build_row(file_path: str, watch_root: str, org_id: str) -> dict:
    ext = os.path.splitext(file_path)[1].lower()
    stat = os.stat(file_path)
    activity_folder = extract_activity_folder(file_path, watch_root)
    mime_type, _ = mimetypes.guess_type(file_path)

    return {
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
                stat.st_mtime,
                tz=timezone.utc,
            ).isoformat(),
        },
    }


def index_file(file_path: str, watch_root: str, org_id: str, supabase: Client) -> None:
    ext = os.path.splitext(file_path)[1].lower()
    if ext not in SUPPORTED_EXTENSIONS:
        return

    activity_folder = extract_activity_folder(file_path, watch_root)
    if activity_folder is None:
        print(f"[SKIP] File not in activity subfolder (wrong depth): {file_path}")
        return

    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            row = _build_row(file_path, watch_root, org_id)
            supabase.table("local_files").upsert(
                row,
                on_conflict="org_id,file_path",
            ).execute()
            print(f"[INDEXED] {activity_folder}/{os.path.basename(file_path)}")
            return
        except FileNotFoundError:
            print(f"[SKIP] File disappeared before indexing: {file_path}")
            return
        except Exception as error:
            if attempt >= MAX_ATTEMPTS:
                print(f"[ERROR] Failed to index after retries: {file_path} ({error})")
                return

            sleep_for = RETRY_BASE_SECONDS * attempt
            print(
                f"[WARN] Indexing failed (attempt {attempt}/{MAX_ATTEMPTS}), retrying in "
                f"{sleep_for:.2f}s: {file_path} ({error})"
            )
            time.sleep(sleep_for)


def soft_delete_file(file_path: str, org_id: str, supabase: Client) -> None:
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            supabase.table("local_files").update({"status": "deleted"}).eq(
                "org_id",
                org_id,
            ).eq("file_path", file_path).execute()
            print(f"[DELETED] {os.path.basename(file_path)}")
            return
        except Exception as error:
            if attempt >= MAX_ATTEMPTS:
                print(f"[ERROR] Failed to soft-delete after retries: {file_path} ({error})")
                return

            sleep_for = RETRY_BASE_SECONDS * attempt
            print(
                f"[WARN] Soft-delete failed (attempt {attempt}/{MAX_ATTEMPTS}), retrying in "
                f"{sleep_for:.2f}s: {file_path} ({error})"
            )
            time.sleep(sleep_for)
