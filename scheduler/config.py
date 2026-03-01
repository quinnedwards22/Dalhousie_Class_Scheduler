import os

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
TERMS_OVERRIDE = os.environ.get("TERMS", "")  # empty = discover dynamically from API
MAX_CONCURRENT = int(os.environ.get("MAX_CONCURRENT", "5"))
