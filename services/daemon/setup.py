from pathlib import Path

from dotenv import dotenv_values

DAEMON_DIR = Path(__file__).resolve().parent
ENV_PATH = DAEMON_DIR / ".env"
DEFAULT_WATCH_PATH = Path.home() / "Documents" / "WFK_Marketing"


def write_env_var(lines: list[str], key: str, value: str) -> list[str]:
    prefix = f"{key}="
    next_lines = [line for line in lines if not line.startswith(prefix)]
    next_lines.append(f"{prefix}{value}")
    return next_lines


def run_setup() -> None:
    print("=== Marketing AI Agent - Daemon Setup ===")
    user_input = input(
        f"Marketing folder location [Enter for default: {DEFAULT_WATCH_PATH}]: "
    ).strip()
    watch_path = Path(user_input).expanduser() if user_input else DEFAULT_WATCH_PATH
    watch_path = watch_path.resolve()
    watch_path.mkdir(parents=True, exist_ok=True)

    existing = dotenv_values(ENV_PATH) if ENV_PATH.exists() else {}
    existing_lines = [
        f"{k}={v}"
        for k, v in existing.items()
        if k and v is not None and k != "WATCH_PATH"
    ]
    updated_lines = write_env_var(existing_lines, "WATCH_PATH", str(watch_path))
    ENV_PATH.write_text("\n".join(updated_lines) + "\n", encoding="utf-8")

    print(f"[OK] WATCH_PATH set to: {watch_path}")
    print("[OK] Updated daemon .env")


if __name__ == "__main__":
    run_setup()
