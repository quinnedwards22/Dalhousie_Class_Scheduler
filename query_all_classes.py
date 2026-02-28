import argparse
import csv
import json
import re
import time
from pathlib import Path

import requests

# Config
BASE_URL = "https://self-service.dal.ca/BannerExtensibility"
TIMETABLE_PAGE = f"{BASE_URL}/customPage/page/dal.stuweb_academicTimetable"
API_URL = f"{BASE_URL}/internalPb/virtualDomains.dal_stuweb_academicTimetable"

DEFAULT_SUBJECTS_SOURCE = Path("all_classes_202620.json")
DEFAULT_TERMS = "202600;202610;202620;202630;"
DEFAULT_DISTRICTS = "100;200;300;400;"
DEFAULT_OUTPUT_PREFIX = "all_classes_2025_2026"
# 202600 (Medicine/Dentistry) includes subject codes not present in the 202620 seed file.
REQUIRED_SUBJECTS = {"DEHY", "DENT", "MEDI", "REGN"}

SEARCH_DATA_TEMPLATE = {
    "districts": DEFAULT_DISTRICTS,
    "max": "1000",
    "page_num": "1",
    "crse_numb": "",
    "page_size": "9999",
    "offset": "0",
}


def parse_args():
    parser = argparse.ArgumentParser(
        description=(
            "Query Dal timetable for all subject codes from an existing JSON file. "
            "By default this queries all 2025/2026 terms in one request per subject."
        )
    )
    parser.add_argument(
        "--subjects-source",
        default=str(DEFAULT_SUBJECTS_SOURCE),
        help="JSON file used to discover SUBJ_CODE values.",
    )
    parser.add_argument(
        "--terms",
        default=DEFAULT_TERMS,
        help="Semicolon-delimited term list ending with ';' (e.g. 202600;202610;202620;202630;).",
    )
    parser.add_argument(
        "--districts",
        default=DEFAULT_DISTRICTS,
        help="Semicolon-delimited districts ending with ';' (default: 100;200;300;400;).",
    )
    parser.add_argument(
        "--output-prefix",
        default=DEFAULT_OUTPUT_PREFIX,
        help="Output file prefix for <prefix>.json and <prefix>.csv.",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=0.25,
        help="Delay in seconds between API calls.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Optional subject limit for quick validation runs.",
    )
    parser.add_argument(
        "--log-empty",
        action="store_true",
        help="Log subjects that return zero rows.",
    )
    return parser.parse_args()


def ensure_semicolon_list(value):
    cleaned = "".join(value.split())
    if not cleaned:
        return ""
    if not cleaned.endswith(";"):
        cleaned += ";"
    return cleaned


def get_session_and_token():
    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/122.0.0.0 Safari/537.36"
            ),
        }
    )

    print("Establishing session...")
    page_resp = session.get(TIMETABLE_PAGE, timeout=30)
    if page_resp.status_code != 200:
        print(f"Failed to load timetable page: HTTP {page_resp.status_code}")
        return None, None

    token_match = re.search(r'synchronizerToken.*?content="(.*?)"', page_resp.text)
    if not token_match:
        print("Could not find synchronizer token in page.")
        return None, None

    sync_token = token_match.group(1)
    print(f"Session established. Token: {sync_token[:16]}...")
    return session, sync_token


def load_subject_codes(source_file):
    with source_file.open("r", encoding="utf-8") as f:
        data = json.load(f)

    subjects = {
        str((row.get("SUBJ_CODE") or row.get("subj_code") or "")).strip().upper()
        for row in data
    }
    subjects.discard("")
    subjects.update(REQUIRED_SUBJECTS)
    return sorted(subjects)


def query_subject(session, sync_token, subj_code, terms, districts):
    params = SEARCH_DATA_TEMPLATE.copy()
    params["subj_code"] = subj_code
    params["terms"] = terms
    params["districts"] = districts

    api_headers = {
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
        "X-Synchronizer-Token": sync_token,
        "Referer": TIMETABLE_PAGE,
    }

    for attempt in range(1, 4):
        try:
            response = session.get(API_URL, params=params, headers=api_headers, timeout=60)
            if response.status_code != 200:
                print(f"  HTTP {response.status_code} for {subj_code} (attempt {attempt}/3)")
            else:
                payload = response.json()
                if isinstance(payload, list):
                    return payload
                print(f"  Non-list payload for {subj_code} (attempt {attempt}/3)")
        except Exception as e:
            print(f"  Request error for {subj_code} (attempt {attempt}/3): {e}")
        time.sleep(attempt * 1.0)

    return []


def dedupe_rows(rows):
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


def write_outputs(rows, output_prefix):
    json_path = f"{output_prefix}.json"
    csv_path = f"{output_prefix}.csv"

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=2)

    fieldnames = sorted({k for row in rows for k in row.keys()})
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    return json_path, csv_path


def main():
    args = parse_args()
    source_file = Path(args.subjects_source)
    terms = ensure_semicolon_list(args.terms)
    districts = ensure_semicolon_list(args.districts)

    if not source_file.exists():
        print(f"Subjects source file not found: {source_file}")
        return
    if not terms:
        print("Invalid --terms value.")
        return
    if not districts:
        print("Invalid --districts value.")
        return

    subjects = load_subject_codes(source_file)
    if args.limit > 0:
        subjects = subjects[: args.limit]

    if not subjects:
        print("No subject codes found.")
        return

    print(f"Loaded {len(subjects)} subject codes from {source_file}")
    print(f"Terms: {terms}")
    print(f"Districts: {districts}")

    session, sync_token = get_session_and_token()
    if not session:
        return

    all_rows = []
    non_empty_subjects = 0
    for idx, subj in enumerate(subjects, start=1):
        print(f"[{idx}/{len(subjects)}] {subj}")
        rows = query_subject(session, sync_token, subj, terms, districts)
        if rows:
            non_empty_subjects += 1
            all_rows.extend(rows)
            print(f"  Found {len(rows)} rows.")
        elif args.log_empty:
            print("  No rows.")
        time.sleep(args.delay)

    if not all_rows:
        print("No data collected.")
        return

    all_rows = dedupe_rows(all_rows)
    json_path, csv_path = write_outputs(all_rows, args.output_prefix)

    print(f"\nSubjects with data: {non_empty_subjects}/{len(subjects)}")
    print(f"Total rows saved: {len(all_rows)}")
    print(f"JSON: {json_path}")
    print(f"CSV:  {csv_path}")


if __name__ == "__main__":
    main()
