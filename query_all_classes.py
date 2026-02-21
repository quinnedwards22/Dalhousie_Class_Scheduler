import requests
import re
import json
import csv
import time

# --- Configuration ---
BASE_URL = "https://self-service.dal.ca/BannerExtensibility"
TIMETABLE_PAGE = f"{BASE_URL}/customPage/page/dal.stuweb_academicTimetable"
API_URL = f"{BASE_URL}/internalPb/virtualDomains.dal_stuweb_academicTimetable"

# Search parameters template
SEARCH_DATA_TEMPLATE = {
    "terms": "202620;",               # Term code (Summer 2026)
    "districts": "100;200;300;400;",  # Campus districts
    "max": "1000",
    "page_num": "1",
    "crse_numb": "",                  # Leave empty for all courses
    "page_size": "9999",
    "offset": "0",
}

def get_session_and_token():
    """Establish a session and get the synchronizer token."""
    session = requests.Session()
    session.headers.update({
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/122.0.0.0 Safari/537.36"
        ),
    })

    print("Establishing session...")
    page_resp = session.get(TIMETABLE_PAGE)
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

def query_subject(session, sync_token, subj_code):
    """Query courses for a specific subject code."""
    params = SEARCH_DATA_TEMPLATE.copy()
    params["subj_code"] = subj_code

    api_headers = {
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
        "X-Synchronizer-Token": sync_token,
        "Referer": TIMETABLE_PAGE,
    }

    try:
        response = session.get(API_URL, params=params, headers=api_headers)
        if response.status_code != 200:
            print(f"Server returned status {response.status_code} for {subj_code}")
            return []
        
        return response.json()
    except Exception as e:
        print(f"Error querying {subj_code}: {e}")
        return []

def main():
    # Load subjects
    try:
        with open('subjects_list.json', 'r') as f:
            subjects = json.load(f)
    except FileNotFoundError:
        print("subjects_list.json not found.")
        return

    session, sync_token = get_session_and_token()
    if not session:
        return

    all_data = []
    
    print(f"Starting query for {len(subjects)} subjects...")
    
    for i, subj in enumerate(subjects):
        print(f"[{i+1}/{len(subjects)}] Querying {subj}...")
        data = query_subject(session, sync_token, subj)
        if data:
            all_data.extend(data)
            print(f"  Found {len(data)} rows.")
        else:
            print(f"  No data found or error for {subj}.")
        
        # Polite delay
        time.sleep(0.5)

    if not all_data:
        print("No data collected.")
        return

    # Normalize keys to lowercase
    lowercase_data = []
    for row in all_data:
        lowercase_data.append({k.lower(): v for k, v in row.items()})
    all_data = lowercase_data

    # Save to CSV
    fieldnames = all_data[0].keys()
    output_file = 'all_classes_202620.csv'
    with open(output_file, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(all_data)
    
    print(f"\nDone! Saved {len(all_data)} rows to {output_file}")

    # Also save to JSON for backup/reference if needed
    with open('all_classes_202620.json', 'w', encoding='utf-8') as f:
        json.dump(all_data, f, ensure_ascii=False, indent=4)

if __name__ == "__main__":
    main()
