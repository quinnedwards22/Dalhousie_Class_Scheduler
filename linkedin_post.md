Dal registration is coming up, so I created a website to make course planning a little easier

With it, you can:

- track CRNs
- see a calendar of selected classes
- compare different schedule options
- address course conflicts
- export your schedule to Apple or Google Calendar

Try it here: https://lnkd.in/eX3QQMSM

---

For those curious about what's under the hood:

**Frontend:** React 19 + TypeScript, built with Vite and Schedule-X for the interactive weekly calendar view. All workspace/plan data is stored in localStorage — no account needed.

**Backend:** A Python/FastAPI service that scrapes Dalhousie's Banner timetable API twice a day (6AM and 6PM UTC), pulling in every course section, meeting time, and enrollment restriction. Runs in Docker and is deployed as a containerized service.

**Database:** Supabase (managed PostgreSQL). The scraper batches and upserts course data on each run; the frontend reads directly from Supabase using the public anon key — no backend needed for reads.

**Exports:** ICS files are generated with proper RRULE weekly recurrence so imported events show up correctly in Google Calendar and Apple Calendar for the full semester. Also supports XLSX and PDF/PNG exports.

**Conflict detection** is handled client-side — the app checks both time overlaps and linked-section rules (e.g. a lab must match its lecture's group number) in real time as you add classes.

**Multi-plan workspaces** let you build and compare multiple schedule options side-by-side — useful when a section fills up or you're weighing different course combos.

Analytics via PostHog (cookieless) to understand how people actually use the tool.

The whole thing is open source if you want to poke around: https://lnkd.in/eX3QQMSM
