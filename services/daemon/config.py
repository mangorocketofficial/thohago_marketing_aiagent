import os
from pathlib import Path

from dotenv import load_dotenv

DAEMON_DIR = Path(__file__).resolve().parent


def get_config() -> dict[str, str]:
    load_dotenv(DAEMON_DIR / ".env")

    required = (
        "SUPABASE_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
        "ORG_ID",
        "WATCH_PATH",
    )
    config: dict[str, str] = {}
    missing: list[str] = []

    for key in required:
        value = (os.getenv(key) or "").strip()
        if not value:
            missing.append(key)
        config[key] = value

    if missing:
        joined = ", ".join(missing)
        raise EnvironmentError(f"Missing required environment variables: {joined}")

    watch_path = Path(config["WATCH_PATH"]).expanduser().resolve()
    if not watch_path.is_dir():
        raise FileNotFoundError(
            f"WATCH_PATH does not exist: {watch_path}. Run setup.py first."
        )

    config["WATCH_PATH"] = str(watch_path)
    return config
