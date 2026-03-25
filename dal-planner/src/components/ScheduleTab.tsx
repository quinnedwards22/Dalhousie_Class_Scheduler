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

import { useState, useMemo, useEffect, useRef, useCallback, Component } from 'react'
import type { ReactNode, ErrorInfo } from 'react'
import { ScheduleXCalendar, useCalendarApp } from '@schedule-x/react'
import { createViewWeek } from '@schedule-x/calendar'
import { createEventsServicePlugin } from '@schedule-x/events-service'
import '@schedule-x/theme-default/dist/calendar.css'
import type { CourseSection } from '../types'
import { splitByBr, parseTimes, timeToMinutes, COLOR_PALETTE, DAY_CONFIG, getTermLabel, getTermShortName, firstNumericValue } from '../utils/classUtils'
import { exportICS, exportXLSX, exportPNG, exportPDF } from '../utils/exportUtils'
import { track } from '../utils/analytics'

// Temporal is injected as a global by the temporal-polyfill package
declare const Temporal: any

// ── CalendarErrorBoundary ─────────────────────────────────────
// Catches render-time errors thrown by Schedule-X or any child of
// the calendar block and displays them in-place instead of crashing
// the whole tab. Functional components can't use componentDidCatch,
// so this must remain a class component.

type EBState = { error: Error | null }

class CalendarErrorBoundary extends Component<{ children: ReactNode }, EBState> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): EBState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ScheduleTab] Calendar render error:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '1.5rem', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, margin: '1rem 0' }}>
          <strong style={{ color: '#b91c1c' }}>Calendar failed to render</strong>
          <pre style={{ marginTop: 8, fontSize: 12, color: '#7f1d1d', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack}
          </pre>
        </div>
      )
    }
    return this.props.children
  }
}

// Minimal clipboard icon for the CRN copy button
const CopyIcon = () => (
  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect x="5" y="1" width="10" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
    <rect x="1" y="4" width="10" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5" fill="white"/>
  </svg>
)

type ScheduleTabProps = {
  selectedClasses: CourseSection[]            // sections in the active workspace
  conflicts: Map<string, string[]>  // used to show the conflict banner
  duplicateCourses: Set<string>     // course+type keys where 2+ sections are selected
  missingLinks: Map<string, string[]>         // CRN-SEQ → unsatisfied link token strings
  totalCredits: number
  workspaceName: string
  toggleClassSelection: (cls: CourseSection) => void
  setActiveTab: (tab: 'browse' | 'schedule') => void
}

function ScheduleTab({
  selectedClasses,
  conflicts,
  duplicateCourses,
  missingLinks,
  totalCredits,
  workspaceName,
  toggleClassSelection,
  setActiveTab,
}: ScheduleTabProps) {

  // ── Copy-to-clipboard state ───────────────────────────────────
  const [copiedCrn, setCopiedCrn] = useState<string | null>(null)
  const [copiedAll, setCopiedAll] = useState(false)

  const copyAllCrns = useCallback(() => {
    const crns = selectedClasses.map(c => String(c.CRN)).join('\n')
    navigator.clipboard.writeText(crns).then(() => {
      track('crn_copied_all', { count: selectedClasses.length, source: 'schedule' })
      setCopiedAll(true)
      setTimeout(() => setCopiedAll(false), 1800)
    })
  }, [selectedClasses])

  const copySingleCrn = useCallback((crn: string) => {
    navigator.clipboard.writeText(crn).then(() => {
      track('crn_copied', { crn, source: 'schedule' })
      setCopiedCrn(crn)
      setTimeout(() => setCopiedCrn(null), 1800)
    })
  }, [])

  // ── Semester view filter ─────────────────────────────────────
  const [semesterView, setSemesterView] = useState<string>('')

  const uniqueTerms = useMemo(() =>
    [...new Set(selectedClasses.map(c => c.TERM_CODE).filter(Boolean))] as string[],
    [selectedClasses]
  )

  // When the set of available semesters changes, default to the first one
  useEffect(() => {
    setSemesterView(uniqueTerms[0] ?? '')
  }, [uniqueTerms.join(',')])

  // ── Export dropdown ──────────────────────────────────────────
  const [showExportMenu, setShowExportMenu] = useState(false)
  const exportMenuRef = useRef<HTMLDivElement>(null)
  const captureRef = useRef<HTMLDivElement>(null)

  // Close the dropdown when the user clicks outside it
  useEffect(() => {
    if (!showExportMenu) return
    function handleClick(e: MouseEvent) {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showExportMenu])

  // ── Calendar data derivation ─────────────────────────────────
  //
  // Runs whenever selectedClasses changes and produces:
  //   calendarEvents — Schedule-X event objects for all timed sections
  //   asyncClasses   — sections with no parseable time (online/TBA)
  //   minTime/maxTime — calendar viewport boundaries (padded ±60 min)
  //   hasWeekend     — whether to show Saturday/Sunday columns
  //   courseColorMap — maps "SUBJ-NUMB" to a "course-N" CSS class
  const { calendarEvents, asyncClasses, minTime, maxTime, hasWeekend, courseColorMap, buildError } = useMemo(() => {
    const defaultResult = {
      calendarEvents: [] as any[], // Event typing relies on ScheduleX internals
      asyncClasses: [] as CourseSection[],
      minTime: '07:00',
      maxTime: '18:00',
      hasWeekend: false,
      courseColorMap: new Map<string, string>(),
      buildError: null as Error | null,
    }
    try {

      const classesToRender = uniqueTerms.length <= 1 || !semesterView
        ? selectedClasses
        : selectedClasses.filter(c => c.TERM_CODE === semesterView)

      const evs: any[] = []
      const asyncCls: CourseSection[] = []
      let earliest = 480   // 8:00 AM default lower bound (minutes since midnight)
      let latest = 1020    // 17:00 default upper bound
      let weekend = false

      // Assign one color per unique course+component (SUBJ + NUMB + TYPE);
      const colorMap = new Map<string, string>()
      let colorIdx = 0
      classesToRender.forEach(cls => {
        const courseKey = `${cls.SUBJ_CODE}-${cls.CRSE_NUMB}-${cls.SCHD_TYPE || 'Lec'}`
        if (!colorMap.has(courseKey)) {
          colorMap.set(courseKey, `course-${colorIdx % COLOR_PALETTE.length}`)
          colorIdx++
        }
      })

      classesToRender.forEach(cls => {
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

        const locsArr = splitByBr(cls.LOCATIONS)

        // Waitlisted sections use the grey "waitlist" calendar instead of
        // the course color so they're visually distinct.
        const wlistCnt = firstNumericValue(cls.WLIST)
        const isWaitlisted = firstNumericValue(cls.SEATS) <= 0 && wlistCnt > 0
        const calendarId = isWaitlisted ? 'waitlist' : (colorMap.get(`${cls.SUBJ_CODE}-${cls.CRSE_NUMB}-${cls.SCHD_TYPE || 'Lec'}`) || 'course-0')

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
              // Schedule-X v4 requires Temporal.ZonedDateTime for timed events
              const startDt = Temporal.ZonedDateTime.from(`${config.date}T${times.start}:00[UTC]`)
              const endDt = Temporal.ZonedDateTime.from(`${config.date}T${times.end}:00[UTC]`)

              // Clean up the location string by removing HTML tags like <b>
              const rawLoc = locsArr[idx] || locsArr[0] || ''
              const cleanLoc = rawLoc.replace(/<[^>]*>/g, '').trim()

              evs.push({
                id: `${cls.CRN}-${cls.SEQ_NUMB}-${dayKey}-${idx}`,
                title: cls.SUBJ_CODE && cls.CRSE_NUMB
                  ? `${cls.SUBJ_CODE} ${cls.CRSE_NUMB} (${cls.SCHD_TYPE || 'Lec'})`
                  : cls.CRSE_TITLE || `CRN ${cls.CRN}`,
                start: startDt,
                end: endDt,
                location: cleanLoc,
                description: `${cls.CRSE_TITLE || ''}\nSection ${cls.SEQ_NUMB} | CRN ${cls.CRN}`,
                calendarId,
                _rawClass: cls, // store reference for custom rendering if needed later
              })
            }
          })
        })
      })

      // Schedule-X dayBoundaries only accept whole-hour strings ("HH:00").
      // Floor the start hour and ceil the end hour so the boundary always
      // covers the actual meeting times after the ±60 min padding.
      const startHour = Math.max(0, Math.floor((earliest - 60) / 60))
      const endHour = Math.min(24, Math.ceil((latest + 60) / 60))
      const toHH = (h: number) => h.toString().padStart(2, '0') + ':00'

      return {
        calendarEvents: evs,
        asyncClasses: asyncCls,
        minTime: toHH(startHour),
        maxTime: toHH(endHour),
        hasWeekend: weekend,
        courseColorMap: colorMap,
        buildError: null as Error | null,
      }
    } catch (err) {
      console.error('[ScheduleTab] Failed to build calendar events:', err)
      return { ...defaultResult, buildError: err instanceof Error ? err : new Error(String(err)) }
    }
  }, [selectedClasses, semesterView])

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

  return (
    <div className="tab-content schedule-tab">
      {/* Event-build error — shown if useMemo threw while converting classes to calendar events */}
      {buildError && (
        <div style={{ padding: '1.5rem', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, margin: '1rem 0' }}>
          <strong style={{ color: '#b91c1c' }}>Failed to build schedule events</strong>
          <pre style={{ marginTop: 8, fontSize: 12, color: '#7f1d1d', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {buildError.message}{'\n\n'}{buildError.stack}
          </pre>
        </div>
      )}

      {/* Summary row + selected-class chips with remove buttons */}
      <div className="schedule-header">
        <div className="schedule-stats-row">
          <div className="schedule-stats">
            <span className="stat-item">{selectedClasses.length} class{selectedClasses.length > 1 ? 'es' : ''}</span>
            <span className="stat-dot">·</span>
            <span className="stat-item">{totalCredits} credit hour{totalCredits !== 1 ? 's' : ''}</span>
          </div>
          <div className="export-menu-wrapper" ref={exportMenuRef}>
            <button
              className="export-btn"
              onClick={() => setShowExportMenu(v => !v)}
              aria-haspopup="true"
              aria-expanded={showExportMenu}
            >
              Export ▾
            </button>
            {showExportMenu && (
              <div className="export-dropdown" role="menu">
                <button role="menuitem" onClick={() => { track('schedule_exported', { format: 'ics', class_count: selectedClasses.length }); exportICS(selectedClasses, workspaceName); setShowExportMenu(false) }}>ICS Calendar</button>
                <button role="menuitem" onClick={() => { track('schedule_exported', { format: 'xlsx', class_count: selectedClasses.length }); exportXLSX(selectedClasses); setShowExportMenu(false) }}>Excel Spreadsheet</button>
                <button role="menuitem" onClick={() => { track('schedule_exported', { format: 'png', class_count: selectedClasses.length }); exportPNG(captureRef.current!); setShowExportMenu(false) }}>PNG Image</button>
                <button role="menuitem" onClick={() => { track('schedule_exported', { format: 'pdf', class_count: selectedClasses.length }); exportPDF(captureRef.current!, workspaceName); setShowExportMenu(false) }}>PDF Document</button>
              </div>
            )}
          </div>
        </div>
        <div className="selected-classes-panel">
          <div className="selected-panel-header">
            <div className="selected-panel-header-row">
              <span className="selected-panel-title">
                Selected Classes
                <span className="selected-panel-count">{selectedClasses.length}</span>
              </span>
              <button
                className={`copy-all-btn${copiedAll ? ' copied' : ''}`}
                onClick={copyAllCrns}
                title="Copy all CRNs to clipboard"
              >
                {copiedAll ? '✓ Copied!' : 'Copy All CRNs'}
              </button>
            </div>
            <span className="panel-hint-text">Click a row to copy its CRN</span>
          </div>
          <div className="selected-panel-table-wrapper">
            <table className="selected-panel-table">
              <thead>
                <tr>
                  <th>CRN</th>
                  <th>Course</th>
                  <th>Type</th>
                  {uniqueTerms.length > 1 && <th>Term</th>}
                  <th className="th-name">Course Name</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {selectedClasses.length === 0 && (
                  <tr>
                    <td colSpan={uniqueTerms.length > 1 ? 6 : 5} className="panel-empty-cell">No classes selected yet</td>
                  </tr>
                )}
                {selectedClasses.map(sc => (
                  <tr
                    key={`${sc.CRN}-${sc.SEQ_NUMB}`}
                    className={copiedCrn === String(sc.CRN) ? 'panel-row-copied' : 'panel-row-clickable'}
                    onClick={() => copySingleCrn(String(sc.CRN))}
                  >
                    <td>
                      <div className="crn-cell-inner">
                        <span className="crn-value">{sc.CRN}</span>
                        <button
                          className={`crn-copy-btn${copiedCrn === String(sc.CRN) ? ' copied' : ''}`}
                          onClick={(e) => { e.stopPropagation(); copySingleCrn(String(sc.CRN)) }}
                          title="Copy CRN"
                          aria-label="Copy CRN"
                        >
                          {copiedCrn === String(sc.CRN) ? '✓' : <CopyIcon />}
                        </button>
                      </div>
                    </td>
                    <td className="course-col">{sc.SUBJ_CODE} {sc.CRSE_NUMB}</td>
                    <td>{sc.SCHD_TYPE ? sc.SCHD_TYPE.toUpperCase() : '—'}</td>
                    {uniqueTerms.length > 1 && (
                      <td style={{ whiteSpace: 'nowrap', fontSize: 11, color: '#64748b' }}>
                        {getTermShortName(sc.TERM_CODE || '')}
                      </td>
                    )}
                    <td className="course-name-cell">
                      {sc.CRSE_TITLE}
                      {conflicts.has(`${sc.CRN}-${sc.SEQ_NUMB}`) && (
                        <span className="row-status-badge badge-conflict">conflict</span>
                      )}
                      {duplicateCourses.has(`${sc.SUBJ_CODE} ${sc.CRSE_NUMB} ${sc.SCHD_TYPE || 'Lec'}`) && (
                        <span className="row-status-badge badge-duplicate">duplicate</span>
                      )}
                      {missingLinks.has(`${sc.CRN}-${sc.SEQ_NUMB}`) && (
                        <span className="row-status-badge badge-missing-link">needs linked section</span>
                      )}
                    </td>
                    <td>
                      <button
                        className="panel-remove-btn"
                        onClick={(e) => { e.stopPropagation(); toggleClassSelection(sc) }}
                        aria-label={`Remove ${sc.SUBJ_CODE} ${sc.CRSE_NUMB}`}
                        title="Deselect class"
                      >✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Semester tabs — only shown when courses from 2+ semesters are selected */}
      {uniqueTerms.length > 1 && (
        <div className="semester-tabs">
          {uniqueTerms.map(term => (
            <button
              key={term}
              className={`semester-tab-btn${semesterView === term ? ' active' : ''}`}
              onClick={() => { track('semester_view_changed', { term }); setSemesterView(term) }}
            >
              {getTermLabel(term)}
            </button>
          ))}
        </div>
      )}

      {/* Capture target for PNG/PDF export — wraps calendar + async section */}
      <div ref={captureRef}>

        {selectedClasses.length === 0 ? (
          <div className="schedule-empty">
            <div className="empty-icon">📅</div>
            <div className="empty-title">No classes selected</div>
            <div className="empty-hint">Go to Browse Classes and check the boxes next to classes you want to take</div>
            <button className="empty-cta" onClick={() => { track('tab_changed', { tab: 'browse', source: 'empty_schedule' }); setActiveTab('browse') }}>← Browse Classes</button>
          </div>
        ) : (
          <CalendarErrorBoundary>
            <div className="calendar-full">
              <ScheduleXCalendar calendarApp={calendar} />
            </div>
          </CalendarErrorBoundary>
        )}

        {/* Async/TBA section — card grid below the calendar for courses with
          no fixed schedule (online-only or time not yet announced) */}
        {asyncClasses.length > 0 && (
          <div className="async-section">
            <h3 className="async-title">Asynchronous & TBA Courses</h3>
            <div className="async-grid">
              {asyncClasses.map(cls => (
                <div
                  key={`${cls.CRN}-${cls.SEQ_NUMB}`}
                  className={`async-card ${courseColorMap.get(`${cls.SUBJ_CODE}-${cls.CRSE_NUMB}-${cls.SCHD_TYPE || 'Lec'}`) || 'course-0'}`}
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
      </div>{/* end captureRef */}
    </div>
  )
}

export default ScheduleTab
