import { useEffect, useState, useCallback, useMemo } from 'react'
import './App.css'
import { supabase } from './utils/supabase'
import { ScheduleXCalendar, useCalendarApp } from '@schedule-x/react'
import { createViewWeek, createViewMonthGrid } from '@schedule-x/calendar'
import { createEventsServicePlugin } from '@schedule-x/events-service'
import '@schedule-x/theme-default/dist/calendar.css'

function App() {
  const [classes, setClasses] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedClasses, setSelectedClasses] = useState<any[]>([])
  const [searchQuery, setSearchQuery] = useState('')

  const filteredClasses = useMemo(() => {
    if (!searchQuery.trim()) return classes
    const q = searchQuery.toLowerCase().trim()
    return classes.filter(cls => {
      const title = (cls.CRSE_TITLE || '').toLowerCase()
      const code = `${cls.SUBJ_CODE || ''} ${cls.CRSE_NUMB || ''}`.toLowerCase()
      const crn = String(cls.CRN || '').toLowerCase()
      return title.includes(q) || code.includes(q) || crn.includes(q)
    })
  }, [classes, searchQuery])

  const highlightMatch = (text: string) => {
    if (!searchQuery.trim() || !text) return text
    const q = searchQuery.trim()
    const regex = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
    const parts = text.split(regex)
    if (parts.length === 1) return text
    return (
      <>
        {parts.map((part, i) =>
          regex.test(part) ? <mark key={i} className="search-highlight">{part}</mark> : part
        )}
      </>
    )
  }

  const toggleClassSelection = useCallback((cls: any) => {
    setSelectedClasses((prev) => {
      const isSelected = prev.some(c => c.CRN === cls.CRN && c.SEQ_NUMB === cls.SEQ_NUMB)
      if (isSelected) {
        return prev.filter(c => !(c.CRN === cls.CRN && c.SEQ_NUMB === cls.SEQ_NUMB))
      }
      return [...prev, cls]
    })
  }, [])

  const [eventsService] = useState(() => createEventsServicePlugin())

  // Map day columns to a date in the current week (Mon Feb 16 – Fri Feb 20, 2026)
  const DAY_CONFIG = {
    MONDAYS: { letter: 'M', date: '2026-02-16' },
    TUESDAYS: { letter: 'T', date: '2026-02-17' },
    WEDNESDAYS: { letter: 'W', date: '2026-02-18' },
    THURSDAYS: { letter: 'R', date: '2026-02-19' },
    FRIDAYS: { letter: 'F', date: '2026-02-20' },
  } as const

  // Parse "HHMM-HHMM" (e.g. "1305-1425") into start/end time strings for Temporal
  const parseTimes = (timeStr: string) => {
    if (!timeStr || !timeStr.includes('-')) return null
    const [startRaw, endRaw] = timeStr.split('-')
    if (!startRaw || !endRaw || startRaw.length !== 4 || endRaw.length !== 4) return null
    const startTime = `${startRaw.substring(0, 2)}:${startRaw.substring(2, 4)}`
    const endTime = `${endRaw.substring(0, 2)}:${endRaw.substring(2, 4)}`
    return { start: startTime, end: endTime }
  }

  const calendar = useCalendarApp({
    views: [
      createViewWeek(),
    ],
    dayBoundaries: {
      start: '07:00',
      end: '21:00',
    },
    weekOptions: {
      gridHeight: 700,
      nDays: 5,
      eventWidth: 95,
      eventOverlap: true,
    },
    events: [],
    plugins: [eventsService],
    selectedDate: Temporal.PlainDate.from('2026-02-20'),
  })

  useEffect(() => {
    const events: any[] = []

    selectedClasses.forEach(cls => {
      const times = parseTimes(cls.TIMES)
      if (!times) return

      const dayKeys = ['MONDAYS', 'TUESDAYS', 'WEDNESDAYS', 'THURSDAYS', 'FRIDAYS'] as const
      dayKeys.forEach(dayKey => {
        const config = DAY_CONFIG[dayKey]
        // Data uses the day letter (M, T, W, R, F) when the class meets that day
        if (cls[dayKey] && cls[dayKey].trim() !== '') {
          const startStr = `${config.date}T${times.start}:00[UTC]`
          const endStr = `${config.date}T${times.end}:00[UTC]`
          events.push({
            id: `${cls.CRN}-${cls.SEQ_NUMB}-${dayKey}`,
            title: cls.SUBJ_CODE && cls.CRSE_NUMB
              ? `${cls.SUBJ_CODE} ${cls.CRSE_NUMB}${cls.CRSE_TITLE ? ' - ' + cls.CRSE_TITLE : ''}`
              : cls.CRSE_TITLE || `CRN ${cls.CRN}`,
            start: Temporal.ZonedDateTime.from(startStr),
            end: Temporal.ZonedDateTime.from(endStr),
          })
        }
      })
    })

    console.log(`Setting ${events.length} events from ${selectedClasses.length} selected classes`)
    eventsService.set(events)
  }, [selectedClasses, eventsService])

  useEffect(() => {
    async function getClasses() {
      const { data: CLASSES, error } = await supabase
        .from('CLASSES')
        .select(`
          SUBJ_CODE, CRSE_NUMB, NOTE_ROW, CRN, SEQ_NUMB, CREDIT_HRS, LINK_CONN, 
          MONDAYS, TUESDAYS, WEDNESDAYS, THURSDAYS, FRIDAYS, CRSE_TITLE,
          TIMES, LOCATIONS, MAX_ENRL, ENRL, SEATS, WLIST, 
          PERC_FULL, XLIST_MAX, XLIST_CUR, INSTRUCTORS, 
          TUITION_CODE, BILL_HRS
        `)



      if (error) {
        console.error('Error fetching classes:', error)
      } else if (CLASSES && CLASSES.length > 0) {
        setClasses(CLASSES)
      }
      setLoading(false)
    }

    getClasses()
  }, [])

  const seatsClass = (seats: number | string | null | undefined) => {
    if (seats == null || seats === '') return ''
    const n = Number(seats)
    if (n > 0) return 'seats-positive'
    if (n <= 0) return 'seats-zero'
    return ''
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>DAL Planner</h1>
        <span className="dal-badge">2025–26</span>
      </header>

      <div className="app-body">
        {/* ── Left panel: search + class table ── */}
        <div className="left-panel">
          <div className="search-container">
            <div className="search-input-wrapper">
              <svg className="search-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                id="class-search"
                type="text"
                className="search-input"
                placeholder="Search by course name, code, or CRN..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  className="search-clear"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear search"
                >
                  ✕
                </button>
              )}
            </div>
            {searchQuery && (
              <span className="search-result-count">
                {filteredClasses.length} {filteredClasses.length === 1 ? 'result' : 'results'}
              </span>
            )}
          </div>

          {loading ? (
            <p className="loading-text">Loading classes…</p>
          ) : classes.length === 0 ? (
            <p className="loading-text">No classes found.</p>
          ) : (
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th rowSpan={2}>Select</th>
                    <th rowSpan={2}>Notes</th>
                    <th rowSpan={2}>CRN</th>
                    <th rowSpan={2}>Section</th>
                    <th rowSpan={2}>Cr<br />Hrs</th>
                    <th rowSpan={2}>Link</th>
                    <th colSpan={5}>Days</th>
                    <th rowSpan={2}>Course Title</th>
                    <th rowSpan={2}>Times</th>
                    <th rowSpan={2}>Location(s)</th>
                    <th colSpan={5}>Enrolment Info</th>
                    <th colSpan={2}>XList Info</th>
                    <th rowSpan={2}>Instructor(s)</th>
                    <th colSpan={2}>Tuition</th>
                  </tr>
                  <tr>
                    <th className="sub-th">Mo</th>
                    <th className="sub-th">Tu</th>
                    <th className="sub-th">We</th>
                    <th className="sub-th">Th</th>
                    <th className="sub-th">Fr</th>

                    <th className="sub-th">Max</th>
                    <th className="sub-th">Cur</th>
                    <th className="sub-th">Avail</th>
                    <th className="sub-th">WtLst</th>
                    <th className="sub-th">%Full</th>

                    <th className="sub-th">Max</th>
                    <th className="sub-th">Cur</th>

                    <th className="sub-th">Code</th>
                    <th className="sub-th">BHrs</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredClasses.map((cls, idx) => {
                    const isSelected = selectedClasses.some(c => c.CRN === cls.CRN && c.SEQ_NUMB === cls.SEQ_NUMB)
                    return (
                      <tr key={idx} className={isSelected ? 'row-selected' : ''}>
                        <td>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleClassSelection(cls)}
                          />
                        </td>
                        <td>{cls.NOTE_ROW}</td>
                        <td>{highlightMatch(String(cls.CRN ?? ''))}</td>
                        <td>{cls.SEQ_NUMB}</td>
                        <td>{cls.CREDIT_HRS}</td>
                        <td>{cls.LINK_CONN}</td>
                        <td>{cls.MONDAYS}</td>
                        <td>{cls.TUESDAYS}</td>
                        <td>{cls.WEDNESDAYS}</td>
                        <td>{cls.THURSDAYS}</td>
                        <td>{cls.FRIDAYS}</td>
                        <td className="cell-title">{highlightMatch(cls.CRSE_TITLE ?? '')}</td>
                        <td>{cls.TIMES}</td>
                        <td className="cell-location">{cls.LOCATIONS}</td>
                        <td>{cls.MAX_ENRL}</td>
                        <td>{cls.ENRL}</td>
                        <td className={seatsClass(cls.SEATS)}>{cls.SEATS}</td>
                        <td>{cls.WLIST}</td>
                        <td>{cls.PERC_FULL}</td>
                        <td>{cls.XLIST_MAX}</td>
                        <td>{cls.XLIST_CUR}</td>
                        <td>{cls.INSTRUCTORS}</td>
                        <td>{cls.TUITION_CODE}</td>
                        <td>{cls.BILL_HRS}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Right panel: selected classes + calendar ── */}
        <div className="right-panel">
          <div className="right-panel-sticky">
            {selectedClasses.length > 0 && (
              <div className="selected-bar">
                <strong>Selected ({selectedClasses.length}):</strong>
                <div className="selected-chips">
                  {selectedClasses.map((sc, i) => (
                    <span key={i} className="selected-chip">
                      {sc.SUBJ_CODE && sc.CRSE_NUMB
                        ? `${sc.SUBJ_CODE} ${sc.CRSE_NUMB}`
                        : `CRN ${sc.CRN}`
                      } · {sc.SEQ_NUMB}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="right-panel-label">Your Schedule</div>
            <div className="calendar-wrapper">
              <ScheduleXCalendar calendarApp={calendar} />
            </div>

            {selectedClasses.length === 0 && (
              <div className="calendar-empty-state">
                <div className="empty-icon">📅</div>
                Select classes from the table to build your schedule
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
