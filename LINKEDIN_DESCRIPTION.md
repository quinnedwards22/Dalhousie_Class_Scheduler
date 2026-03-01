# LinkedIn Project Description — DAL Planner

---

## Short Version (under 300 characters, for the LinkedIn "Description" field)

Full-stack course scheduling platform for Dalhousie University students. Built with React 19 + TypeScript frontend and a Python FastAPI backend that auto-scrapes the university timetable twice daily. Features conflict detection, linked-section validation, multi-plan workspaces, and schedule export (ICS/CSV/PDF/PNG).

---

## Full Post

**DAL Planner — Dalhousie University Course Scheduler**

Navigating Dalhousie's timetable felt like solving a puzzle with no picture on the box, so I built a tool to solve it.

**DAL Planner** is a full-stack web application that lets students browse the full course catalog, build conflict-free schedules, and manage multiple alternative plans — all in one place.

### What it does

- **Browse & filter** 1,000+ courses by subject, day, location, instructor, and seat availability across Fall, Winter, Summer, and Medical/Dental terms
- **Detect conflicts** in real-time as courses are added to a schedule, including complex patterns like courses meeting on alternating days
- **Validate linked sections** — automatically prevents selecting a Lab Group B with a Lecture Group A when they are not compatible
- **Interactive weekly calendar** powered by Schedule-X, with color-coded courses and auto-scaling time windows
- **Multiple workspaces** (Plan A, Plan B, Plan C…) stored in localStorage so plans survive page refreshes
- **Export schedules** to `.ics` (importable into Google Calendar / Apple Calendar), CSV, PNG, and PDF

### Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript 5, Vite 7, Schedule-X calendar |
| Backend | Python 3.12, FastAPI, aiohttp, APScheduler |
| Database | Supabase (PostgreSQL + PostgREST) |
| Export | html2canvas, jsPDF |
| Deployment | Vercel (frontend), Docker (backend) |

### Engineering highlights

- **Automated data pipeline** — APScheduler triggers an async web scraper against Dalhousie's Banner timetable system twice a day (06:00 & 18:00 UTC). It handles CSRF token extraction, concurrent requests with semaphore-controlled rate limiting, deduplication, and batched Supabase uploads — all with graceful error recovery.
- **Conflict detection algorithm** — O(n²) pairwise comparison pre-computes per-class time slots and checks day-of-week overlap, giving instant visual feedback on the calendar and in the course list.
- **Linked-section validation** — parses encoded constraint strings (e.g. `"B0, T0"`) into structured tokens and cross-checks selected sections to warn when a lab or tutorial is incompatible with the chosen lecture.
- **Pagination beyond the 1,000-row API limit** — sequential chunked requests transparently assemble large result sets that exceed Supabase's server-side row cap, with client-side pagination (10 / 20 / 50 / 100 rows per page) layered on top.
- **Workspace migration** — includes v1→v2 data migration logic that upgrades legacy localStorage data to the current schema without losing saved plans.

### What's next

The roadmap includes 30+ planned features: dark mode, drag-and-drop rescheduling, RateMyProfessors integration, AI-powered schedule optimization, degree audit tracking, seat-availability push notifications, and a shareable URL-encoded plan format.

---

*Built to scratch my own itch as a student — and to practice building something end-to-end that people actually use.*
