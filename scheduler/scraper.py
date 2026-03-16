import asyncio
import json
import re
from datetime import datetime, timezone
from pathlib import Path

import aiohttp

from scheduler.config import MAX_CONCURRENT, TERMS_OVERRIDE

BASE_URL = "https://self-service.dal.ca/BannerExtensibility"
TIMETABLE_PAGE = f"{BASE_URL}/customPage/page/dal.stuweb_academicTimetable"
CLASS_URL = f"{BASE_URL}/internalPb/virtualDomains.dal_stuweb_academicTimetable"
TERMS_URL = f"{BASE_URL}/internalPb/virtualDomains.dal_stuweb_academicTimetable_terms"
DISTRICTS_URL = f"{BASE_URL}/internalPb/virtualDomains.dal_stuweb_academicTimetable_districts"
SUBJECTS_URL = f"{BASE_URL}/internalPb/virtualDomains.dal_stuweb_academicTimetable_subjects"
RESTRICTIONS_URL = f"{BASE_URL}/internalPb/virtualDomains.dal_stuweb_academicTimetable_restrictions"

SEEDS_PATH = Path(__file__).parent.parent / "seeds.json"

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/122.0.0.0 Safari/537.36"
)

CLASS_PARAMS_BASE = {
    "max": "1000",
    "page_num": "1",
    "crse_numb": "",
    "page_size": "9999",
    "offset": "0",
}


# ---------------------------------------------------------------------------
# Seeds (small local metadata cache)
# ---------------------------------------------------------------------------

def load_seeds() -> dict:
    if SEEDS_PATH.exists():
        with SEEDS_PATH.open("r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_seeds(terms: list[str], districts: list[str], subjects: list[str]) -> None:
    data = {
        "updated": datetime.now(timezone.utc).isoformat(),
        "terms": terms,
        "districts": districts,
        "subjects": subjects,
    }
    with SEEDS_PATH.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    print(f"Saved seeds.json ({len(subjects)} subjects, {len(terms)} terms).")


# ---------------------------------------------------------------------------
# Session + CSRF token
# ---------------------------------------------------------------------------

async def get_token(session: aiohttp.ClientSession) -> str | None:
    print("Establishing session and fetching CSRF token...")
    async with session.get(TIMETABLE_PAGE, timeout=aiohttp.ClientTimeout(total=30)) as resp:
        if resp.status != 200:
            print(f"Failed to load timetable page: HTTP {resp.status}")
            return None
        text = await resp.text()

    match = re.search(r'synchronizerToken.*?content="(.*?)"', text)
    if not match:
        print("Could not find synchronizer token in page.")
        return None

    token = match.group(1)
    print(f"Token acquired: {token[:16]}...")
    return token


# ---------------------------------------------------------------------------
# Metadata discovery endpoints
# ---------------------------------------------------------------------------

async def _fetch_codes(
    session: aiohttp.ClientSession,
    token: str,
    url: str,
    params: dict,
    label: str,
) -> list[str]:
    headers = {
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
        "X-Synchronizer-Token": token,
        "Referer": TIMETABLE_PAGE,
    }
    async with session.get(url, params=params, headers=headers, timeout=aiohttp.ClientTimeout(total=30)) as resp:
        if resp.status != 200:
            raise RuntimeError(f"HTTP {resp.status} fetching {label}")
        payload = await resp.json(content_type=None)
    if not isinstance(payload, list):
        raise RuntimeError(f"Unexpected payload type for {label}: {type(payload)}")
    codes = [str(row["CODE"]).strip() for row in payload if row.get("CODE")]
    print(f"  {label}: {codes}")
    return codes


async def fetch_terms(session: aiohttp.ClientSession, token: str) -> list[str]:
    print("Fetching terms from API...")
    return await _fetch_codes(
        session, token, TERMS_URL,
        {"in_progress": "N", "offset": "0", "max": "100"},
        "terms",
    )


async def fetch_districts(session: aiohttp.ClientSession, token: str) -> list[str]:
    print("Fetching districts from API...")
    return await _fetch_codes(
        session, token, DISTRICTS_URL,
        {"offset": "0", "max": "100"},
        "districts",
    )


async def fetch_subjects(
    session: aiohttp.ClientSession,
    token: str,
    terms: str,
    districts: str,
) -> list[str]:
    print(f"Fetching subjects for terms {terms}...")
    return await _fetch_codes(
        session, token, SUBJECTS_URL,
        {"terms": terms, "districts": districts, "offset": "0", "max": "9999"},
        "subjects",
    )


# ---------------------------------------------------------------------------
# Class data queries
# ---------------------------------------------------------------------------

def ensure_semicolon_list(value: str) -> str:
    cleaned = "".join(value.split())
    if not cleaned:
        return ""
    return cleaned if cleaned.endswith(";") else cleaned + ";"


def dedupe_rows(rows: list[dict]) -> list[dict]:
    deduped = []
    seen = set()
    for row in rows:
        key = (
            row.get("TERM_CODE"),
            row.get("SUBJ_CODE"),
            row.get("CRSE_NUMB"),
            row.get("CRN"),
            row.get("SEQ_NUMB"),
            row.get("SCHD_CODE"),
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(row)
    return deduped


async def query_subject(
    session: aiohttp.ClientSession,
    token: str,
    subj_code: str,
    terms: str,
    districts: str,
    sem: asyncio.Semaphore,
) -> list[dict]:
    params = {
        **CLASS_PARAMS_BASE,
        "subj_code": subj_code,
        "terms": terms,
        "districts": districts,
    }
    headers = {
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
        "X-Synchronizer-Token": token,
        "Referer": TIMETABLE_PAGE,
    }

    async with sem:
        for attempt in range(1, 4):
            try:
                async with session.get(
                    CLASS_URL,
                    params=params,
                    headers=headers,
                    timeout=aiohttp.ClientTimeout(total=60),
                ) as resp:
                    if resp.status != 200:
                        print(f"  HTTP {resp.status} for {subj_code} (attempt {attempt}/3)")
                    else:
                        payload = await resp.json(content_type=None)
                        if isinstance(payload, list):
                            return payload
                        print(f"  Non-list payload for {subj_code} (attempt {attempt}/3)")
            except Exception as e:
                print(f"  Error for {subj_code} (attempt {attempt}/3): {e}")
            await asyncio.sleep(attempt * 1.0)

    return []


# ---------------------------------------------------------------------------
# Restriction queries
# ---------------------------------------------------------------------------


async def query_restrictions(
    session: aiohttp.ClientSession,
    token: str,
    term_code: str,
    crn: str,
    restr_ind: str,
    sem: asyncio.Semaphore,
) -> list[dict]:
    """Query restrictions for a single CRN. Returns raw API rows or []."""
    params = {
        "term_code": term_code,
        "crn": crn,
        "restr_ind": restr_ind,
        "offset": "0",
        "max": "100",
    }
    headers = {
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
        "X-Synchronizer-Token": token,
        "Referer": TIMETABLE_PAGE,
    }

    async with sem:
        for attempt in range(1, 4):
            try:
                async with session.get(
                    RESTRICTIONS_URL,
                    params=params,
                    headers=headers,
                    timeout=aiohttp.ClientTimeout(total=30),
                ) as resp:
                    if resp.status != 200:
                        if attempt == 3:
                            return []
                    else:
                        payload = await resp.json(content_type=None)
                        if isinstance(payload, list):
                            return payload
            except Exception:
                pass
            await asyncio.sleep(attempt * 0.5)

    return []


async def scrape_restrictions(
    session: aiohttp.ClientSession,
    token: str,
    class_rows: list[dict],
    sem: asyncio.Semaphore,
) -> list[dict]:
    """Scrape restrictions for all unique CRNs found in class_rows."""
    # Extract unique (term_code, crn) pairs
    unique_crns = sorted(
        {(row.get("TERM_CODE", ""), row.get("CRN", "")) for row in class_rows}
    )
    unique_crns = [(t, c) for t, c in unique_crns if t and c]

    print(f"Scraping restrictions for {len(unique_crns)} unique CRNs...")

    # Build tasks: two per CRN (Include + Exclude)
    tasks = []
    task_meta = []
    for term_code, crn in unique_crns:
        for ind in ("I", "E"):
            tasks.append(query_restrictions(session, token, term_code, crn, ind, sem))
            task_meta.append((term_code, crn, ind))

    results = await asyncio.gather(*tasks)

    # Flatten into restriction rows
    restriction_rows: list[dict] = []
    for (term_code, crn, ind), rows in zip(task_meta, results):
        for row in rows:
            restriction_rows.append({
                "term_code": term_code,
                "crn": crn,
                "restr_ind": ind,
                "restr_type": row.get("RESTR_TYPE", ""),
                "restr_descr": row.get("RESTR_DESCR_LIST", ""),
            })

    print(
        f"Restriction scrape complete. {len(restriction_rows)} restriction rows "
        f"found across {len(unique_crns)} CRNs."
    )
    return restriction_rows


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

async def scrape_all() -> tuple[list[dict], list[dict]]:
    connector = aiohttp.TCPConnector(limit=MAX_CONCURRENT)
    headers = {"User-Agent": USER_AGENT}

    async with aiohttp.ClientSession(connector=connector, headers=headers) as session:
        token = await get_token(session)
        if not token:
            raise RuntimeError("Could not acquire CSRF token from Banner.")

        # --- Discover metadata ---
        try:
            if TERMS_OVERRIDE:
                terms = [t.strip() for t in TERMS_OVERRIDE.split(";") if t.strip()]
                print(f"Using TERMS override: {terms}")
            else:
                terms = await fetch_terms(session, token)

            districts = await fetch_districts(session, token)

            terms_str = ensure_semicolon_list(";".join(terms))
            districts_str = ensure_semicolon_list(";".join(districts))

            subjects = await fetch_subjects(session, token, terms_str, districts_str)

        except Exception as e:
            print(f"Metadata fetch failed ({e}), falling back to seeds.json.")
            seeds = load_seeds()
            if not seeds:
                raise RuntimeError("Metadata fetch failed and no seeds.json fallback exists.")
            terms = seeds["terms"]
            districts = seeds["districts"]
            subjects = seeds["subjects"]
            terms_str = ensure_semicolon_list(";".join(terms))
            districts_str = ensure_semicolon_list(";".join(districts))

        # Update seeds file with freshly discovered metadata
        save_seeds(terms, districts, subjects)

        print(f"Scraping {len(subjects)} subjects across terms: {terms_str}")

        # --- Concurrent class data queries ---
        sem = asyncio.Semaphore(MAX_CONCURRENT)
        tasks = [
            query_subject(session, token, subj, terms_str, districts_str, sem)
            for subj in subjects
        ]
        results = await asyncio.gather(*tasks)

    all_rows: list[dict] = []
    non_empty = 0
    for subj, rows in zip(subjects, results):
        if rows:
            non_empty += 1
            all_rows.extend(rows)
            print(f"  {subj}: {len(rows)} rows")

    all_rows = dedupe_rows(all_rows)
    print(
        f"Scrape complete. {non_empty}/{len(subjects)} subjects with data. "
        f"{len(all_rows)} total rows (deduped)."
    )

    # Scrape restrictions using the same session and token
    async with aiohttp.ClientSession(connector=aiohttp.TCPConnector(limit=MAX_CONCURRENT), headers=headers) as restr_session:
        restr_token = await get_token(restr_session)
        if not restr_token:
            print("Could not acquire token for restrictions, skipping.")
            return all_rows, []
        restr_sem = asyncio.Semaphore(MAX_CONCURRENT)
        restriction_rows = await scrape_restrictions(restr_session, restr_token, all_rows, restr_sem)

    return all_rows, restriction_rows
