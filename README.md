# Dalhousie Class Scheduler

A course scheduling tool for Dalhousie University students. Browse the live class catalog, build conflict-free weekly schedules, and manage multiple plan workspaces — all powered by automatically refreshed timetable data.

## Repository Structure

```
.
├── dal-planner/        # React + TypeScript frontend (Vite)
└── scheduler/          # Python FastAPI backend (scraper + Supabase uploader)
```

---

## dal-planner — Frontend

A web app for browsing courses and building schedules.

**Features:**
- Search and filter courses by subject, type, day, location, instructor, and seat availability
- Select sections and visualize your weekly schedule in an interactive calendar
- Conflict detection and linked-section validation (labs must match lecture groups)
- Multiple plan workspaces (Plan A, Plan B, etc.)
- Credit hour tracking and seat availability in real time

**Tech stack:** React 19, TypeScript, Vite, Supabase (PostgreSQL), Schedule-X

### Setup

```bash
cd dal-planner
npm install
```

Create a `.env` file:

```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY=your_supabase_anon_key
```

```bash
npm run dev      # development server
npm run build    # production build
```

---

## scheduler — Backend

Scrapes Dalhousie's Banner timetable and uploads the data to Supabase. The refresh runs twice daily in GitHub Actions; the FastAPI app is for local development and manual triggering.

**Tech stack:** Python 3.12, FastAPI, APScheduler, aiohttp, Supabase

### Scheduled Refresh

`.github/workflows/refresh-timetable.yml` runs `python -m scheduler.run_once` at
06:00 and 18:00 UTC. A full run takes roughly 8-9 minutes.

Trigger one by hand from the Actions tab (**Refresh timetable data** -> **Run
workflow**), or locally with:

```bash
python -m scheduler.run_once
```

The workflow needs two repository secrets, `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY`. Runs are serialized: a refresh deletes a term's
rows before reinserting them, so overlapping runs could leave a term
half-populated.

The frontend shows the timestamp of the last successful run, read from the
`metadata` table's `last_updated` key. If that date is stale, check the Actions
tab before suspecting the scraper -- the scrape itself is usually fine.

### Environment Variables

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `TERMS` | *(optional)* Semicolon-separated term codes to scrape (e.g. `202520;202530`). Defaults to auto-discovery. |
| `MAX_CONCURRENT` | *(optional)* Max concurrent scraper requests (default: `5`) |

### Running Locally

```bash
cd scheduler
pip install -r requirements.txt
export SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...
uvicorn scheduler.main:app --reload
```

### Docker

```bash
docker build -t dal-scheduler .
docker run -e SUPABASE_URL=... -e SUPABASE_SERVICE_ROLE_KEY=... -p 8000:8000 dal-scheduler
```

### API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/api/status` | Pipeline state and next scheduled run |
| `POST` | `/api/trigger` | Manually trigger a scrape + upload |
