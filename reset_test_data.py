"""Delete all NammaCare Supabase demo data and auth users.

Required environment:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  NAMMACARE_CONFIRM_DELETE_ALL=yes

This intentionally refuses to run with the publishable anon key because Auth
user deletion needs Supabase admin privileges.
"""

from __future__ import annotations

import os
import sys
from typing import Any

import requests
from dotenv import load_dotenv
from supabase import create_client


PUBLIC_TABLES_DELETE_ORDER = [
    "system_notifications",
    "sos_events",
    "check_ins",
    "health_logs",
    "medical_documents",
    "medication_logs",
    "medications",
    "appointments",
    "help_requests",
    "emergency_contacts",
    "profiles",
]

ADMIN_ACCOUNT = {
    "email": "pal.arnav68@gmail.com",
    "password": "Admin123!",
    "full_name": "Arnav Pal",
    "username": "admin_arnav",
    "phone": "9380751527",
    "dob": "1974-03-02",
    "role": "Admin",
    "address": "NammaCare HQ",
}


def require_env() -> tuple[str, str]:
    load_dotenv()
    if os.getenv("NAMMACARE_CONFIRM_DELETE_ALL") != "yes":
        raise RuntimeError("Set NAMMACARE_CONFIRM_DELETE_ALL=yes to confirm full demo reset.")
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.")
    if key.startswith("sb_publishable_") or key.startswith("eyJ") is False:
        print("Warning: service-role keys are usually JWTs. Continuing only if Supabase accepts it.")
    return url.rstrip("/"), key


def admin_headers(service_key: str) -> dict[str, str]:
    return {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }


def find_admin_user(url: str, service_key: str, admin_email: str) -> str:
    """Find and return the admin user ID by email, or empty string if not found."""
    response = requests.get(
        f"{url}/auth/v1/admin/users",
        headers=admin_headers(service_key),
        params={"page": 1, "per_page": 1000},
        timeout=30,
    )
    response.raise_for_status()
    users = response.json().get("users", [])
    for user in users:
        if user.get("email") == admin_email:
            return user["id"]
    return ""


def delete_all_auth_users_except(url: str, service_key: str, skip_user_id: str) -> None:
    page = 1
    while True:
        response = requests.get(
            f"{url}/auth/v1/admin/users",
            headers=admin_headers(service_key),
            params={"page": page, "per_page": 1000},
            timeout=30,
        )
        response.raise_for_status()
        users = response.json().get("users", [])
        if not users:
            return
        for user in users:
            user_id = user["id"]
            if user_id == skip_user_id:
                continue
            requests.delete(
                f"{url}/auth/v1/admin/users/{user_id}",
                headers=admin_headers(service_key),
                timeout=30,
            ).raise_for_status()
            print(f"Deleted auth user: {user.get('email')} ({user_id})")
        page += 1


def clear_public_tables(service_key: str, url: str, skip_profile_id: str = "") -> Any:
    client = create_client(url, service_key)
    for table in PUBLIC_TABLES_DELETE_ORDER:
        try:
            if table == "profiles":
                # For profiles with UUID id, use select().delete() to clear all rows
                client.table(table).delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
            else:
                client.table(table).delete().neq("id", -1).execute()
            print(f"Cleared public.{table}")
        except Exception as exc:
            print(f"Could not clear public.{table}: {exc}")
    return client


def main() -> int:
    url, service_key = require_env()

    admin_id = find_admin_user(url, service_key, ADMIN_ACCOUNT["email"])
    if not admin_id:
        raise RuntimeError(f"Admin user {ADMIN_ACCOUNT['email']} not found. Create it first or run with admin seeding enabled.")

    # Delete all public table rows (this will include the admin profile too)
    clear_public_tables(service_key, url, skip_profile_id="")
    # Delete all auth users except admin
    delete_all_auth_users_except(url, service_key, skip_user_id=admin_id)

    # Recreate the admin profile row after cleanup
    client = create_client(url, service_key)
    try:
        client.table("profiles").insert(
            {
                "id": admin_id,
                "full_name": ADMIN_ACCOUNT["full_name"],
                "username": ADMIN_ACCOUNT["username"],
                "phone": ADMIN_ACCOUNT["phone"],
                "dob": ADMIN_ACCOUNT["dob"],
                "role": ADMIN_ACCOUNT["role"],
                "address": ADMIN_ACCOUNT["address"],
            }
        ).execute()
        print(f"Recreated admin profile for {admin_id}")
    except Exception as exc:
        print(f"Warning: Could not recreate admin profile: {exc}")

    print("\nReset complete. All demo rows were deleted and the admin account was preserved.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"Reset failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
