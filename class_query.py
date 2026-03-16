import requests
import re
import json
import csv

# --- Configuration ---
BASE_URL = "https://self-service.dal.ca/BannerExtensibility"
TIMETABLE_PAGE = f"{BASE_URL}/customPage/page/dal.stuweb_academicTimetable"
API_URL = f"{BASE_URL}/internalPb/virtualDomains.dal_stuweb_academicTimetable"

# Mapping IDs from the working URL (key_id, value_id)
PARAMS_MAP = {
    "max": ("Mjg=", "NzQ="),
    "page_num": ("MzM=", "OTA="),
    "subj_code": ("NDM=", "NzI="),
    "offset": ("NDg=", "OTE="),
    "terms": ("NTY=", "OTQ="),
    "page_size": ("Nzg=", "MzE="),
    "districts": ("ODg=", "NjY="),
    "crse_numb": ("OTQ=", "NjQ=")
}

# Search parameters
search_data = {
    "terms": "202630;202700;202720;202710;",  # Open terms: Summer 25/26, Medicine/Dentistry 26/27, Winter 26/27, Fall 26/27
    "subj_code": "CSCI",              # Subject code
    "districts": "100;200;300;400;",  # Campus districts
    "max": "1000",
    "page_num": "1",
    "crse_numb": "",                  # Leave empty for all courses, or e.g. "1105"
    "page_size": "9999",
    "offset": "0",
}


def query_timetable(params: dict) -> list[dict] | None:
    """
    Query the Dalhousie Academic Timetable API.

    Steps:
      1. Load the timetable page to get a session cookie + synchronizer token.
      2. Use the token in the X-Synchronizer-Token header for the API call.
      3. Send a plain GET request with query params (no base64 encoding needed).
    """
    session = requests.Session()
    session.headers.update({
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/122.0.0.0 Safari/537.36"
        ),
    })

    # Step 1: Load page to get session + synchronizer token
    print("Establishing session...")
    page_resp = session.get(TIMETABLE_PAGE)
    if page_resp.status_code != 200:
        print(f"Failed to load timetable page: HTTP {page_resp.status_code}")
        return None

    token_match = re.search(r'synchronizerToken.*?content="(.*?)"', page_resp.text)
    if not token_match:
        print("Could not find synchronizer token in page.")
        return None

    sync_token = token_match.group(1)
    print(f"Session established. Token: {sync_token[:16]}...")

    # Step 2: Make the API request with the sync token
    api_headers = {
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
        "X-Synchronizer-Token": sync_token,
        "Referer": TIMETABLE_PAGE,
    }

    print(f"Requesting {params['subj_code']} courses for term {params['terms'].rstrip(';')}...")
    response = session.get(API_URL, params=params, headers=api_headers)

    if response.status_code != 200:
        print(f"Server returned status {response.status_code}")
        print(response.text[:500])
        return None

    try:
        data = response.json()

        with open('data.json', 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=4)

        # Also write CSV
        if data:
            fieldnames = data[0].keys()
            with open('data.csv', 'w', newline='', encoding='utf-8') as f:
                writer = csv.DictWriter(f, fieldnames=fieldnames)
                writer.writeheader()
                writer.writerows(data)
            print(f"Saved {len(data)} rows to data.json and data.csv")

    except Exception as e:
        print(f"Failed to parse JSON: {e}")
        print(response.text[:500])
        return None

    return data


def print_courses(courses: list[dict]):
    """Pretty-print course results."""
    if not courses:
        print("No courses found.")
        return

    print(f"\nFound {len(courses)} course sections:\n")
    print(f"{'CRN':<8} {'Course':<12} {'Sec':<5} {'Title':<40} {'Days':<8} {'Time':<15} {'Instructor'}")
    print("-" * 110)

    for c in courses:
        crn = c.get("CRN", "")
        course = f"{c.get('SUBJ_CODE', '')}{c.get('CRSE_NUMB', '')}"
        section = c.get("SEQ_NUMB", "")
        title = c.get("CRSE_TITLE", "")[:38]
        days = c.get("DAY_CODE", "") or ""
        begin = c.get("BEGIN_TIME", "") or ""
        end = c.get("END_TIME", "") or ""
        time_str = f"{begin}-{end}" if begin else "TBA"
        instructor = c.get("INSTR_NAME", "") or "TBA"

        print(f"{crn:<8} {course:<12} {section:<5} {title:<40} {days:<8} {time_str:<15} {instructor}")


if __name__ == "__main__":
    results = query_timetable(search_data)

    if results is None:
        print("Query failed.")
    else:
        print_courses(results)