import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

import sys

try:
    SUPABASE_URL = os.environ["SUPABASE_URL"]
    SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
except KeyError as e:
    print(f"ERROR: Missing environment variable {e}. Please ensure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in your environment.")
    sys.exit(1)

TERMS_OVERRIDE = os.environ.get("TERMS", "")  # empty = discover dynamically from API
MAX_CONCURRENT = int(os.environ.get("MAX_CONCURRENT", "5"))
