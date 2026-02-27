import time

from supabase import Client
from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

from indexer import index_file, soft_delete_file


class MarketingFolderHandler(FileSystemEventHandler):
    def __init__(self, watch_root: str, org_id: str, supabase: Client):
        super().__init__()
        self.watch_root = watch_root
        self.org_id = org_id
        self.supabase = supabase

    def on_created(self, event) -> None:
        if event.is_directory:
            return
        index_file(event.src_path, self.watch_root, self.org_id, self.supabase)

    def on_modified(self, event) -> None:
        if event.is_directory:
            return
        index_file(event.src_path, self.watch_root, self.org_id, self.supabase)

    def on_deleted(self, event) -> None:
        if event.is_directory:
            return
        soft_delete_file(event.src_path, self.org_id, self.supabase)

    def on_moved(self, event) -> None:
        if event.is_directory:
            return

        # Move is handled as delete old + index new.
        soft_delete_file(event.src_path, self.org_id, self.supabase)
        index_file(event.dest_path, self.watch_root, self.org_id, self.supabase)


def start_watcher(watch_root: str, org_id: str, supabase: Client) -> None:
    handler = MarketingFolderHandler(watch_root, org_id, supabase)
    observer = Observer()
    observer.schedule(handler, watch_root, recursive=True)
    observer.start()
    print(f"[WATCHER] Monitoring: {watch_root}")
    print("[WATCHER] Press Ctrl+C to stop.")

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()

    observer.join()
