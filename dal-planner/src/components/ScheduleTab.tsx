// ── ScheduleTab ────────────────────────────────────────────────
// Renders the visual weekly schedule for the active workspace.
//
// Responsibilities:
//   • Convert selected classes into Schedule-X calendar events
//   • Detect and separate async/TBA courses (no parseable time range)
//   • Auto-size the calendar's visible day range and time window
//   • Show a conflict banner when overlapping sections exist
//   • Render a card grid for async/TBA courses below the calendar
//
// All calendar state (eventsService, calendar instance) lives here so
// switching tabs doesn't disturb browse-tab filter state, and vice versa.

import { useState, useMemo, useEffect } from 'react'
import { ScheduleXCalendar, useCalendarApp } from '@schedule-x/react'
import { createViewWeek } from '@schedule-x/calendar'
import { createEventsServicePlugin } from '@schedule-x/events-service'
import '@schedule-x/theme-default/dist/calendar.css'
import { splitByBr, parseTimes, timeToMinutes, COLOR_PALETTE, DAY_CONFIG } from '../utils/classUtils'

// Temporal is injected as a global by the temporal-polyfill package
declare const Temporal: any

type ScheduleTabProps = {
  selectedClasses: any[]            // sections in the active workspace
  conflicts: Map<string, string[]>  // used to show the conflict banner
  totalCredits: number
  toggleClassSelection: (cls: any) => void
  setActiveTab: (tab: 'browse' | 'schedule') => void
}

function ScheduleTab({
  selectedClasses,
  conflicts,
  totalCredits,
  toggleClassSelection,
  setActiveTab,
}: ScheduleTabProps) {

  // ── Calendar data derivation ─────────────────────────────────
  //
  // Runs whenever selectedClasses changes and produces:
  //   calendarEvents — Schedule-X event objects for all timed sections
  //   asyncClasses   — sections with no parseable time (online/TBA)
  //   minTime/maxTime — calendar viewport boundaries (padded ±60 min)
  //   hasWeekend     — whether to show Saturday/Sunday columns
  //   courseColorMap — maps "SUBJ-NUMB" to a "course-N" CSS class
  const { calendarEvents, asyncClasses, minTime, maxTime, hasWeekend, courseColorMap } = useMemo(() => {
    const evs: any[] = []
    const asyncCls: any[] = []
    let earliest = 480   // 8:00 AM default lower bound (minutes since midnight)
    let latest = 1020    // 17:00 default upper bound
    let weekend = false

    // Assign one color per unique course (SUBJ + NUMB); sections of the same
    // course share a color. Colors cycle through COLOR_PALETTE.
    const colorMap = new Map<string, string>()
    let colorIdx = 0
    selectedClasses.forEach(cls => {
      const courseKey = `${cls.SUBJ_CODE}-${cls.CRSE_NUMB}`
      if (!colorMap.has(courseKey)) {
        colorMap.set(courseKey, `course-${colorIdx % COLOR_PALETTE.length}`)
        colorIdx++
      }
    })

    selectedClasses.forEach(cls => {
      const timesArr = splitByBr(cls.TIMES)
      // A section is async/TBA if none of its time values contain a hyphen
      // (all valid "HHMM-HHMM" ranges have a hyphen)
      const validTimes = timesArr.filter((t: string) => t.includes('-'))
      if (validTimes.length === 0) {
        asyncCls.push(cls)
        return
      }

      // Parse each day column into arrays (indexed in parallel with timesArr)
      const mondaysArr = splitByBr(cls.MONDAYS)
      const tuesdaysArr = splitByBr(cls.TUESDAYS)
      const wednesdaysArr = splitByBr(cls.WEDNESDAYS)
      const thursdaysArr = splitByBr(cls.THURSDAYS)
      const fridaysArr = splitByBr(cls.FRIDAYS)
      const saturdaysArr = splitByBr(cls.SATURDAYS)
      const sundaysArr = splitByBr(cls.SUNDAYS)

      // Waitlisted sections use the grey "waitlist" calendar instead of
      // the course color so they're visually distinct.
      const wlistCnt = Number(cls.WLIST) || 0
      const isWaitlisted = Number(cls.SEATS) <= 0 && wlistCnt > 0
      const calendarId = isWaitlisted ? 'waitlist' : (colorMap.get(`${cls.SUBJ_CODE}-${cls.CRSE_NUMB}`) || 'course-0')

      // Iterate over each time slot (a section can have multiple meeting times)
      timesArr.forEach((timeStr: string, idx: number) => {
        const times = parseTimes(timeStr)
        if (!times) return
        const startMin = timeToMinutes(times.start)
        const endMin = timeToMinutes(times.end)

        // Expand the viewport bounds to encompass this meeting time
        earliest = Math.min(earliest, startMin)
        latest = Math.max(latest, endMin)

        // Match each day column array against the current time slot index
        const dayKeys = ['SUNDAYS', 'MONDAYS', 'TUESDAYS', 'WEDNESDAYS', 'THURSDAYS', 'FRIDAYS', 'SATURDAYS'] as const
        const dayArrs = [sundaysArr, mondaysArr, tuesdaysArr, wednesdaysArr, thursdaysArr, fridaysArr, saturdaysArr]
        dayKeys.forEach((dayKey, i) => {
          const config = DAY_CONFIG[dayKey]
          const dayVal = dayArrs[i][idx]
          if (dayVal && dayVal.trim() !== '') {
            if (dayKey === 'SATURDAYS' || dayKey === 'SUNDAYS') weekend = true
            // Anchor events to the fixed reference week in DAY_CONFIG
            const startStr = `${config.date}T${times.start}:00[UTC]`
            const endStr = `${config.date}T${times.end}:00[UTC]`
            evs.push({
              id: `${cls.CRN}-${cls.SEQ_NUMB}-${dayKey}-${idx}`,
              title: cls.SUBJ_CODE && cls.CRSE_NUMB
                ? `${cls.SUBJ_CODE} ${cls.CRSE_NUMB}${cls.CRSE_TITLE ? ' - ' + cls.CRSE_TITLE : ''}`
                : cls.CRSE_TITLE || `CRN ${cls.CRN}`,
              start: Temporal.ZonedDateTime.from(startStr),
              end: Temporal.ZonedDateTime.from(endStr),
              calendarId,
              isWaitlist: isWaitlisted,
            })
          }
        })
      })
    })

    // Add ±60 min padding around the earliest and latest meeting times,
    // clamped to midnight boundaries, then format as "HH:MM"
    const padE = Math.max(0, earliest - 60)
    const padL = Math.min(1440, latest + 60)
    const fmt = (m: number) => `${Math.floor(m / 60).toString().padStart(2, '0')}:${(m % 60).toString().padStart(2, '0')}`

    return {
      calendarEvents: evs,
      asyncClasses: asyncCls,
      minTime: fmt(padE),
      maxTime: fmt(padL),
      hasWeekend: weekend,
      courseColorMap: colorMap,
    }
  }, [selectedClasses])

  // ── Calendar setup ───────────────────────────────────────────
  //
  // eventsService is created once (lazy useState) so it persists across
  // selectedClasses changes without reinitialising the calendar instance.
  const [eventsService] = useState(() => createEventsServicePlugin())

  // useCalendarApp is a Schedule-X hook that creates the calendar configuration
  // object. dayBoundaries and weekOptions are derived from the event data above.
  // The calendars map registers a named color for each course slot plus "waitlist".
  const calendar = useCalendarApp({
    views: [createViewWeek()],
    dayBoundaries: { start: minTime, end: maxTime },
    weekOptions: { gridHeight: 800, nDays: hasWeekend ? 7 : 5 },
    events: [],  // initially empty — events are pushed via eventsService below
    plugins: [eventsService],
    // Start on Sunday if there are weekend classes, Monday otherwise
    selectedDate: Temporal.PlainDate.from(hasWeekend ? '2026-02-15' : '2026-02-16'),
    calendars: {
      // Register a named calendar entry for each color slot in the palette
      ...Object.fromEntries(
        COLOR_PALETTE.map((c, i) => [`course-${i}`, {
          colorName: `course-${i}`,
          lightColors: c,
          darkColors: c,
        }])
      ),
      // Grey calendar for waitlisted sections
      waitlist: {
        colorName: 'waitlist',
        lightColors: { main: '#9CA3AF', container: '#F3F4F6', onContainer: '#4B5563' },
        darkColors: { main: '#9CA3AF', container: '#F3F4F6', onContainer: '#4B5563' },
      },
    },
  })

  // Sync the derived event list into the live calendar whenever selections change
  useEffect(() => {
    eventsService.set(calendarEvents)
  }, [calendarEvents, eventsService])

  // ── Empty state ──────────────────────────────────────────────
  if (selectedClasses.length === 0) {
    return (
      <div className="tab-content schedule-tab">
        <div className="schedule-empty">
          <div className="empty-icon">📅</div>
          <div className="empty-title">No classes selected</div>
          <div className="empty-hint">Go to Browse Classes and check the boxes next to classes you want to take</div>
          <button className="empty-cta" onClick={() => setActiveTab('browse')}>← Browse Classes</button>
        </div>
      </div>
    )
  }

  return (
    <div className="tab-content schedule-tab">
      {/* Conflict banner — shown at the top so it's immediately visible */}
      {conflicts.size > 0 && (
        <div className="conflict-banner">
          Schedule conflict — {conflicts.size} class{conflicts.size > 1 ? 'es' : ''} have overlapping times
        </div>
      )}

      {/* Summary row + selected-class chips with remove buttons */}
      <div className="schedule-header">
        <div className="schedule-stats">
          <span className="stat-item">{selectedClasses.length} class{selectedClasses.length > 1 ? 'es' : ''}</span>
          <span className="stat-dot">·</span>
          <span className="stat-item">{totalCredits} credit hour{totalCredits !== 1 ? 's' : ''}</span>
        </div>
        <div className="schedule-chips">
          {selectedClasses.map(sc => (
            <span key={`${sc.CRN}-${sc.SEQ_NUMB}`} className="selected-chip">
              {sc.SUBJ_CODE && sc.CRSE_NUMB
                ? `${sc.SUBJ_CODE} ${sc.CRSE_NUMB}`
                : `CRN ${sc.CRN}`
              } · {sc.SEQ_NUMB}
              <button className="chip-remove" onClick={() => toggleClassSelection(sc)} aria-label="Remove">✕</button>
            </span>
          ))}
        </div>
      </div>

      {/* Schedule-X weekly calendar */}
      <div className="calendar-full">
        <ScheduleXCalendar calendarApp={calendar} />
      </div>

      {/* Async/TBA section — card grid below the calendar for courses with
          no fixed schedule (online-only or time not yet announced) */}
      {asyncClasses.length > 0 && (
        <div className="async-section">
          <h3 className="async-title">Asynchronous & TBA Courses</h3>
          <div className="async-grid">
            {asyncClasses.map(cls => (
              <div
                key={`${cls.CRN}-${cls.SEQ_NUMB}`}
                className={`async-card ${courseColorMap.get(`${cls.SUBJ_CODE}-${cls.CRSE_NUMB}`) || 'course-0'}`}
              >
                <div className="async-card-header">
                  <span className="async-code">{cls.SUBJ_CODE} {cls.CRSE_NUMB}</span>
                  <span className="async-sec">Sec {cls.SEQ_NUMB}</span>
                </div>
                <div className="async-title-text">{cls.CRSE_TITLE}</div>
                <div className="async-info">
                  <span>{cls.CREDIT_HRS} Cr Hrs</span>
                  <span>·</span>
                  <span>CRN {cls.CRN}</span>
                </div>
                {/* Show the raw TIMES value (e.g. "Online" or "TBA") or a fallback */}
                <div className="async-times">
                  {splitByBr(cls.TIMES).join(', ') || 'Online / TBA'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default ScheduleTab
