import os

from config import get_config
from indexer import index_file
from supabase_client import get_supabase
from watcher import start_watcher


def initial_scan(watch_root: str, org_id: str, supabase) -> None:
    print("[SCAN] Running initial scan...")
    processed = 0

    for root, _, files in os.walk(watch_root):
        for file_name in files:
            full_path = os.path.join(root, file_name)
            index_file(full_path, watch_root, org_id, supabase)
            processed += 1

    print(f"[SCAN] Initial scan complete. {processed} files processed.")


def main() -> None:
    config = get_config()
    supabase = get_supabase(
        config["SUPABASE_URL"],
        config["SUPABASE_SERVICE_ROLE_KEY"],
    )

    print(f"[INFO] Org ID: {config['ORG_ID']}")
    print(f"[INFO] Watch path: {config['WATCH_PATH']}")

    initial_scan(config["WATCH_PATH"], config["ORG_ID"], supabase)
    start_watcher(config["WATCH_PATH"], config["ORG_ID"], supabase)


if __name__ == "__main__":
    main()
