import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
TERMS_OVERRIDE = os.environ.get("TERMS", "")  # empty = discover dynamically from API
MAX_CONCURRENT = int(os.environ.get("MAX_CONCURRENT", "5"))
