from supabase import create_client

from scheduler.config import SUPABASE_SERVICE_KEY, SUPABASE_URL

BATCH_SIZE = 500
TABLE = "dalhousie_classes"


async def upload(rows: list[dict]) -> int:
    client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    normalized = [{k.lower(): v for k, v in row.items()} for row in rows]

    # Derive term codes from the actual data — only delete what we're replacing
    term_codes = sorted({row["term_code"] for row in normalized if row.get("term_code")})

    print(f"Uploading {len(normalized)} rows to Supabase ({TABLE})...")
    print(f"  Terms to refresh: {term_codes}")

    for term in term_codes:
        client.table(TABLE).delete().eq("term_code", term).execute()
        print(f"  Deleted existing rows for term {term}")

    for i in range(0, len(normalized), BATCH_SIZE):
        batch = normalized[i : i + BATCH_SIZE]
        client.table(TABLE).insert(batch).execute()
        print(f"  Inserted rows {i}–{i + len(batch) - 1}")

    print(f"Upload complete. {len(normalized)} rows inserted.")
    return len(normalized)
