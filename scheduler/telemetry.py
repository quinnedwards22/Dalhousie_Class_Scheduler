"""Report refresh outcomes to PostHog so a broken or stalled refresh is visible.

Optional: when POSTHOG_PROJECT_API_KEY is unset (e.g. local runs) every call is
a no-op. Telemetry failures are logged and swallowed; they must never fail a
refresh that otherwise succeeded.
"""

import os

DISTINCT_ID = "timetable-refresh-job"


def report(event: str, properties: dict) -> None:
    api_key = os.environ.get("POSTHOG_PROJECT_API_KEY", "").strip()
    if not api_key:
        return
    try:
        from posthog import Posthog

        client = Posthog(
            api_key,
            host=os.environ.get("POSTHOG_HOST", "").strip() or "https://us.i.posthog.com",
            sync_mode=True,
        )
        client.capture(
            event,
            distinct_id=DISTINCT_ID,
            properties={
                **properties,
                # Server-side job, not a person: keep it out of person analytics.
                "$process_person_profile": False,
                "github_run_id": os.environ.get("GITHUB_RUN_ID"),
                "github_run_url": _run_url(),
                "trigger": os.environ.get("GITHUB_EVENT_NAME", "local"),
            },
        )
        client.shutdown()
    except Exception as e:  # noqa: BLE001 - telemetry must never break the job
        print(f"Telemetry failed ({event}): {e}")


def _run_url() -> str | None:
    server = os.environ.get("GITHUB_SERVER_URL")
    repo = os.environ.get("GITHUB_REPOSITORY")
    run_id = os.environ.get("GITHUB_RUN_ID")
    if server and repo and run_id:
        return f"{server}/{repo}/actions/runs/{run_id}"
    return None
