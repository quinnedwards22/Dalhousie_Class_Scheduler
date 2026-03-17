import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env", override=True)

import sys

try:
    SUPABASE_URL = os.environ["SUPABASE_URL"]
    SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise KeyError("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is empty")
except KeyError as e:
    print(f"ERROR: Missing environment variable {e}. Please ensure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in your environment.")
    sys.exit(1)

TERMS_OVERRIDE = os.environ.get("TERMS", "")  # empty = discover dynamically from API
MAX_CONCURRENT = int(os.environ.get("MAX_CONCURRENT", "5"))
