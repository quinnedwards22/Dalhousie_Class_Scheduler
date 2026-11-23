"""Run the scrape + upload pipeline exactly once, then exit.

Used by the GitHub Actions cron. The FastAPI app in main.py keeps its own
APScheduler for local runs; this entrypoint reuses the same pipeline function
so there is only one definition of what a refresh does.

Each run reports `timetable_refresh_succeeded` or `timetable_refresh_failed` to
PostHog (when POSTHOG_PROJECT_API_KEY is set), so an alert can fire when no
successful refresh has landed recently.
"""

import asyncio
import sys

from scheduler.main import run_pipeline, state
from scheduler.telemetry import report


def main() -> int:
    try:
        asyncio.run(run_pipeline())
    except Exception as e:
        print(f"::error::Pipeline failed: {e}")
        report("timetable_refresh_failed", {
            "error": str(e)[:1000],
            "error_type": type(e).__name__,
            "duration_s": state["last_run_duration_s"],
            # Non-zero when classes uploaded but restrictions did not
            "rows": state["last_run_rows"],
        })
        return 1

    print(
        f"Rows: {state['last_run_rows']} classes, "
        f"{state['last_run_restrictions']} restrictions "
        f"in {state['last_run_duration_s']}s."
    )
    report("timetable_refresh_succeeded", {
        "rows": state["last_run_rows"],
        "restriction_rows": state["last_run_restrictions"],
        "rows_by_term": state["last_run_rows_by_term"],
        "term_count": len(state["last_run_rows_by_term"]),
        "duration_s": state["last_run_duration_s"],
    })
    return 0


if __name__ == "__main__":
    sys.exit(main())
