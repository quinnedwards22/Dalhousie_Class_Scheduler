import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi import FastAPI

from scheduler.scraper import scrape_all
from scheduler.uploader import upload, upload_restrictions

state: dict = {
    "running": False,
    "last_run_utc": None,
    "last_run_rows": 0,
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
        count = await upload(rows)
        restr_count = await upload_restrictions(restriction_rows)
        state["last_run_rows"] = count
        state["last_run_restrictions"] = restr_count
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


@app.post("/api/trigger")
async def trigger():
    if state["running"]:
        return {"status": "already_running"}
    asyncio.create_task(run_pipeline())
    return {"status": "triggered"}
