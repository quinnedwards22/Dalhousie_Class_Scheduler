# DAL Planner

A course scheduling and planning tool for **Dalhousie University** students. Browse the course catalog, build conflict-free schedules, and manage multiple alternative plans — all in one place.

## What It Does

- Browse Dalhousie courses across all terms (Fall, Winter, Summer, Med/Dent)
- Search and filter by subject, type, day, location, instructor, and availability
- Select sections and visualize your weekly schedule in an interactive calendar
- Detect time conflicts and linked-section violations (labs must match lecture groups)
- Manage multiple plan workspaces (Plan A, Plan B, etc.)
- Track credit hour totals and seat availability in real time

## Tech Stack

- **React + TypeScript** (Vite)
- **Supabase** (PostgreSQL backend, course data)
- **Schedule-X** (calendar rendering, Temporal API)
- **LocalStorage** for workspace persistence

---

## Current Features

### Browse Tab
- Full-text search (course title, code, CRN)
- Term selector (multi-select: Fall / Winter / Summer / Med/Dent)
- Filters: subject, class type, day toggles (M/T/W/R/F), location, available seats, hide C/D sections
- Active-filter chip bar
- Grouped course list with expandable rows (notes, conflicts, sub-meetings)
- Enrollment progress bars (color-coded: green / amber / red)
- Waitlist badge
- Sticky mini-preview bar with selected classes and "View Schedule" CTA
- Pagination (10 / 20 / 50 / 100 rows per page)

### Schedule Tab
- Interactive weekly calendar (Schedule-X)
- Auto-sized time window (±60 min padding around earliest/latest class)
- 5-day or 7-day view (expands automatically for weekend courses)
- Color-coded events per course (8-color palette)
- Grey events for waitlisted sections
- Async/TBA course card grid below calendar
- Conflict banner
- Removable class chips with credit total

### Header / Workspaces
- Multi-workspace manager (create, switch, delete plans)
- Status badges: conflicts (red, pulsing), missing links (yellow), credit total (green)
- Tab navigation with selection count badge

---

## Feature Ideas & Roadmap

- [ ] **Clickable calendar events** — popover showing instructor, room, enrollment %, notes, and a "Remove" button
- [ ] **Instructor names on event tiles** — truncated name visible directly on calendar block
- [ ] **Async/TBA card improvements** — show instructor and location (data already available)
- [ ] **Credit budget indicator in Browse** — running tally as you select courses, not just in the header
- [ ] **Persist filter state** — remember search/filter settings across tab switches (sessionStorage)
- [ ] **Conflict "Resolve" button** — conflict banner lists affected sections with one-click removal

### Export & Sharing
- [ ] **Export to .ics** — import schedule into Google Calendar, Apple Calendar, Outlook
- [ ] **Print-friendly view** — clean print stylesheet + "Print Schedule" button
- [ ] **URL-encoded schedule sharing** — encode selected CRNs in URL hash so a link opens the same schedule
- [ ] **Export as image** — screenshot-style PNG of the weekly calendar
- [ ] **PDF export** — formatted multi-page document with course details

### Browse Tab Enhancements
- [ ] **Instructor filter** — search/filter by instructor name
- [ ] **Credit hour filter** — filter by number of credits (e.g., 3 cr only)
- [ ] **Save filter presets** — name and reuse filter combinations
- [ ] **Course comparison** — side-by-side view of two sections to compare times, instructors, seats
- [ ] **"Commonly taken with"** — show courses frequently paired with the current one
- [ ] **Pre-req warnings** — flag courses whose prerequisites you haven't added to your plan

### Schedule Tab Enhancements
- [ ] **Custom event colors** — let users override the auto-assigned color per course
- [ ] **Toggle course visibility** — hide/show a course on the calendar without removing it
- [ ] **Show/hide specific days** — collapse days with no classes
- [ ] **Alternate-week view** — simulate schedules for courses that meet every other week
- [ ] **Drag-and-drop section swap** — drag a calendar event to switch to another section of the same course
- [ ] **Time axis zoom** — zoom in/out on the calendar time grid

### Workspace & Planning
- [ ] **Side-by-side workspace comparison** — view Plan A and Plan B calendars at the same time
- [ ] **Undo/redo** — step back through selection history
- [ ] **Import/export workspace JSON** — backup and restore plans manually
- [ ] **Template workspaces** — pre-populated starting points for common degree paths
- [ ] **Workspace notes** — freeform text field per plan for personal annotations

### Academic Features
- [ ] **Credit load warnings** — alert if selected credits fall outside the recommended full-time range (typically 15–18)
- [ ] **Degree audit mode** — track completed courses and map remaining degree requirements
- [ ] **Pre-req/co-req visualization** — graph view of course dependencies
- [ ] **Course history** — mark courses as completed in past terms; exclude them from Browse results
- [ ] **GPA impact estimator** — rough projection based on course difficulty ratings

### UX & Accessibility
- [ ] **Mobile-responsive layout** — card-based Browse view for small screens
- [ ] **Dark mode** — system-preference-aware theme toggle
- [ ] **Keyboard shortcuts** — select/deselect courses, switch tabs, open details
- [ ] **Full ARIA accessibility** — screen reader support, focus management, keyboard navigation
- [ ] **Search debounce** — prevent filter re-runs on every keystroke
- [ ] **Error states** — user-facing messages for Supabase query failures
- [ ] **Onboarding tour** — guided walkthrough for first-time users
- [ ] **"What's new" changelog** — popup on first load after an update

### Data & Intelligence
- [ ] **RateMyProfessors integration** — show instructor ratings inline
- [ ] **Enrollment trend badge** — "filling fast" indicator based on remaining seats vs. capacity
- [ ] **Waitlist likelihood estimator** — probability of getting off the waitlist
- [ ] **AI schedule optimizer** — automatically suggest conflict-free schedules that meet user-defined constraints (days off, latest start time, etc.)
- [ ] **Seat availability notifications** — alert when a watched section opens up

---

## Development

```bash
cd dal-planner
npm install
npm run dev
```

Requires a `.env` file with:
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY=...
```
