"""Supabase client bootstrap for the backend.

This module loads configuration from `.env`, validates the required
Supabase environment variables, and exposes a ready-to-import client
instance named `supabase`.
"""

from __future__ import annotations

import os

from dotenv import load_dotenv
from supabase import Client, create_client


load_dotenv()


def _get_required_env_var(name: str) -> str:
	value = os.getenv(name)
	if not value:
		raise ValueError(
			f"Missing required environment variable: {name}. "
			f"Add {name} to your .env file before starting the backend."
		)
	return value


SUPABASE_URL = _get_required_env_var("SUPABASE_URL")
SUPABASE_KEY = _get_required_env_var("SUPABASE_SERVICE_ROLE_KEY")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

