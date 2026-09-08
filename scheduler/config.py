import os
from pathlib import Path

from dotenv import load_dotenv

# Look for .env beside this file first, then at the repo root. In CI neither
# exists and the credentials come straight from the environment.
_HERE = Path(__file__).resolve().parent
for _candidate in (_HERE / ".env", _HERE.parent / ".env"):
    if _candidate.is_file():
        load_dotenv(_candidate, override=True)
        break

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
