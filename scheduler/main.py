import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi import FastAPI

from scheduler.config import SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
from scheduler.scraper import scrape_all
from scheduler.uploader import upload, upload_restrictions

state: dict = {
    "running": False,
    "last_run_utc": None,
    "last_run_rows": 0,
    "last_run_restrictions": 0,
    "last_run_rows_by_term": {},
    "last_run_duration_s": 0.0,
    "last_error": None,
}

scheduler = AsyncIOScheduler(timezone="UTC")


async def run_pipeline() -> None:
    if state["running"]:
        print("Pipeline already running, skipping.")
        return

    state["running"] = True
    state["last_error"] = None
    start = datetime.now(timezone.utc)
    print(f"[{start.isoformat()}] Pipeline started.")

    try:
        rows, restriction_rows = await scrape_all()
        by_term: dict[str, int] = {}
        for row in rows:
            term = str(row.get("TERM_CODE") or "")
            if term:
                by_term[term] = by_term.get(term, 0) + 1
        state["last_run_rows_by_term"] = dict(sorted(by_term.items()))
        count = await upload(rows)
        state["last_run_rows"] = count
        if restriction_rows is None:
            # Classes are uploaded; keep the previous restrictions rather than
            # replacing them with a partial set, but still fail the run so the
            # problem is visible.
            raise RuntimeError("Restriction scrape incomplete; kept the previous restriction data.")
        state["last_run_restrictions"] = await upload_restrictions(restriction_rows)
    except Exception as e:
        state["last_error"] = str(e)
        print(f"Pipeline error: {e}")
        raise
    finally:
        end = datetime.now(timezone.utc)
        state["running"] = False
        state["last_run_utc"] = end.isoformat()
        state["last_run_duration_s"] = round((end - start).total_seconds(), 1)
        print(f"[{end.isoformat()}] Pipeline finished in {state['last_run_duration_s']}s.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler.add_job(run_pipeline, CronTrigger(hour="6,18", timezone="UTC"), id="timetable_update")
    scheduler.start()
    print("Scheduler started. Next run:", scheduler.get_job("timetable_update").next_run_time)
    yield
    scheduler.shutdown()
    print("Scheduler stopped.")


app = FastAPI(title="Dal Timetable Scheduler", lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/api/status")
async def status():
    job = scheduler.get_job("timetable_update")
    return {
        **state,
        "next_run_utc": str(job.next_run_time) if job else None,
    }


@app.get("/api/test-db")
async def test_db():
    from supabase import create_client
    try:
        client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
        result = client.table("metadata").select("*").limit(1).execute()
        return {"status": "ok", "data": result.data}
    except Exception as e:
        return {"status": "error", "error": str(e)}


@app.post("/api/trigger")
async def trigger():
    if state["running"]:
        return {"status": "already_running"}
    asyncio.create_task(run_pipeline())
    return {"status": "triggered"}
