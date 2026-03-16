from datetime import datetime, timezone

from supabase import create_client

from scheduler.config import SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL

BATCH_SIZE = 500
TABLE = "dalhousie_classes"
RESTRICTIONS_TABLE = "class_restrictions"
METADATA_TABLE = "metadata"


async def upload(rows: list[dict]) -> int:
    client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
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

    # Update the metadata table with the current UTC timestamp
    now = datetime.now(timezone.utc).isoformat()
    client.table(METADATA_TABLE).upsert({"key": "last_updated", "value": now}).execute()
    print(f"Upload complete. {len(normalized)} rows inserted. Metadata updated at {now}.")
    return len(normalized)


async def upload_restrictions(rows: list[dict]) -> int:
    if not rows:
        print("No restriction rows to upload.")
        return 0

    client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    term_codes = sorted({row["term_code"] for row in rows if row.get("term_code")})

    print(f"Uploading {len(rows)} restriction rows to Supabase ({RESTRICTIONS_TABLE})...")
    print(f"  Terms to refresh: {term_codes}")

    for term in term_codes:
        client.table(RESTRICTIONS_TABLE).delete().eq("term_code", term).execute()
        print(f"  Deleted existing restriction rows for term {term}")

    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i : i + BATCH_SIZE]
        client.table(RESTRICTIONS_TABLE).insert(batch).execute()
        print(f"  Inserted restriction rows {i}–{i + len(batch) - 1}")

    print(f"Restriction upload complete. {len(rows)} rows inserted.")
    return len(rows)
