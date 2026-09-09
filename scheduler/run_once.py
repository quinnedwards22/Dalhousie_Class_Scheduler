"""Run the scrape + upload pipeline exactly once, then exit.

Used by the GitHub Actions cron. The FastAPI app in main.py keeps its own
APScheduler for local runs; this entrypoint reuses the same pipeline function
so there is only one definition of what a refresh does.
"""

import asyncio
import sys

from scheduler.main import run_pipeline, state


def main() -> int:
    try:
        asyncio.run(run_pipeline())
    except Exception as e:
        print(f"::error::Pipeline failed: {e}")
        return 1

    print(
        f"Rows: {state['last_run_rows']} classes, "
        f"{state.get('last_run_restrictions', 0)} restrictions "
        f"in {state['last_run_duration_s']}s."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
