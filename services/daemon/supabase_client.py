from typing import Optional

from supabase import Client, create_client

_client: Optional[Client] = None


def get_supabase(url: str, service_role_key: str) -> Client:
    global _client

    if _client is None:
        _client = create_client(url, service_role_key)

    return _client
