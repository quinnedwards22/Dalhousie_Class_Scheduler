import React, { useEffect, useState, useCallback, useMemo } from 'react'
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

  // Group filtered classes by course (SUBJ_CODE + CRSE_NUMB)
  const groupedClasses = useMemo(() => {
    const groups: { key: string; code: string; title: string; termInfo: string; sections: any[] }[] = []
    const map = new Map<string, number>()
    filteredClasses.forEach(cls => {
      const key = `${cls.SUBJ_CODE || ''}-${cls.CRSE_NUMB || ''}`
      if (!map.has(key)) {
        map.set(key, groups.length)
        const ptrm = cls.PTRM_CODE ? `(${cls.PTRM_CODE})` : ''
        const term = cls.TERM_CODE ? `(${cls.TERM_CODE})` : ''
        const dates = cls.START_DATE && cls.END_DATE ? `${cls.START_DATE} - ${cls.END_DATE}` : ''
        const termLabel = `${term} WINTER ${ptrm}: ${dates}`
        groups.push({
          key,
          code: `${cls.SUBJ_CODE || ''} ${cls.CRSE_NUMB || ''}`,
          title: cls.CRSE_TITLE || '',
          termInfo: dates ? termLabel : '',
          sections: [],
        })
      }
      groups[map.get(key)!].sections.push(cls)
    })
    return groups
  }, [filteredClasses])



  // Format days into compact string
  const formatDays = (cls: any) => {
    const parts: string[] = []
    if (cls.MONDAYS?.trim()) parts.push('M')
    if (cls.TUESDAYS?.trim()) parts.push('T')
    if (cls.WEDNESDAYS?.trim()) parts.push('W')
    if (cls.THURSDAYS?.trim()) parts.push('R')
    if (cls.FRIDAYS?.trim()) parts.push('F')
    return parts.join('') || ''
  }

  // Row class based on schedule type (Lec vs Lab/Tut)
  const rowTypeClass = (schdType: string) => {
    if (!schdType) return ''
    const t = schdType.trim().toLowerCase()
    if (t === 'lec') return 'row-lec'
    if (t === 'lab' || t === 'tut') return 'row-lab'
    return ''
  }

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
          SUBJ_CODE, CRSE_NUMB, NOTE_ROW, CRN, SEQ_NUMB, SCHD_TYPE,
          CREDIT_HRS, LINK_CONN, 
          MONDAYS, TUESDAYS, WEDNESDAYS, THURSDAYS, FRIDAYS, CRSE_TITLE,
          TIMES, LOCATIONS, MAX_ENRL, ENRL, SEATS, WLIST, 
          PERC_FULL, XLIST_MAX, XLIST_CUR, INSTRUCTORS, 
          TUITION_CODE, BILL_HRS, NOTE_BOTTOM,
          TERM_CODE, PTRM_CODE, START_DATE, END_DATE
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

  // Dynamic color for %Full column
  const percFullClass = (pf: string | null | undefined) => {
    if (!pf) return ''
    const n = parseFloat(pf)
    if (isNaN(n)) return ''
    if (n >= 95) return 'pf-critical'
    if (n >= 80) return 'pf-high'
    if (n >= 50) return 'pf-mid'
    return 'pf-low'
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
                    <th className="th-note"></th>
                    <th className="th-select"></th>
                    <th>CRN</th>
                    <th>Sec</th>
                    <th>Type</th>
                    <th>Cr<br />Hrs</th>
                    <th>Link</th>
                    <th className="th-day">M</th>
                    <th className="th-day">T</th>
                    <th className="th-day">W</th>
                    <th className="th-day">R</th>
                    <th className="th-day">F</th>
                    <th>Times</th>
                    <th>Location</th>
                    <th>Max</th>
                    <th>Cur</th>
                    <th>Avail</th>
                    <th>%Full</th>
                    <th>Instructor</th>
                    <th>Cr<br />Hrs</th>
                  </tr>
                </thead>
                <tbody>
                  {groupedClasses.map(group => (
                    <>
                      {/* Course header row */}
                      <tr key={group.key} className="course-header">
                        <td colSpan={20}>
                          <div className="course-header-inner">
                            <span>
                              <span className="course-code">{highlightMatch(group.code)}</span>
                              <span className="course-title">{highlightMatch(group.title)}</span>
                            </span>
                            {group.termInfo && <span className="course-term">{group.termInfo}</span>}
                          </div>
                        </td>
                      </tr>
                      {/* Section rows */}
                      {group.sections.map((cls, idx) => {
                        const isSelected = selectedClasses.some(c => c.CRN === cls.CRN && c.SEQ_NUMB === cls.SEQ_NUMB)
                        const noteVal = (cls.NOTE_ROW || '').trim()
                        const noteBottom = (cls.NOTE_BOTTOM || '').trim()
                        return (
                          <React.Fragment key={`${group.key}-${idx}`}>
                            <tr
                              className={[
                                isSelected ? 'row-selected' : '',
                                rowTypeClass(cls.SCHD_TYPE),
                              ].filter(Boolean).join(' ')}
                            >
                              <td className="cell-note">{noteVal}</td>
                              <td className="cell-select">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleClassSelection(cls)}
                                />
                              </td>
                              <td>{highlightMatch(String(cls.CRN ?? ''))}</td>
                              <td>{cls.SEQ_NUMB}</td>
                              <td>{cls.SCHD_TYPE || 'Lec'}</td>
                              <td>{cls.CREDIT_HRS}</td>
                              <td>{cls.LINK_CONN}</td>
                              <td className={cls.MONDAYS?.trim() ? 'day-active' : 'day-empty'}>{cls.MONDAYS}</td>
                              <td className={cls.TUESDAYS?.trim() ? 'day-active' : 'day-empty'}>{cls.TUESDAYS}</td>
                              <td className={cls.WEDNESDAYS?.trim() ? 'day-active' : 'day-empty'}>{cls.WEDNESDAYS}</td>
                              <td className={cls.THURSDAYS?.trim() ? 'day-active' : 'day-empty'}>{cls.THURSDAYS}</td>
                              <td className={cls.FRIDAYS?.trim() ? 'day-active' : 'day-empty'}>{cls.FRIDAYS}</td>
                              <td className="cell-times">{cls.TIMES}</td>
                              <td className="cell-location">{cls.LOCATIONS}</td>
                              <td>{cls.MAX_ENRL}</td>
                              <td>{cls.ENRL}</td>
                              <td className={seatsClass(cls.SEATS)}>{cls.SEATS}</td>
                              <td className={percFullClass(cls.PERC_FULL)}>{cls.PERC_FULL}</td>
                              <td className="cell-instructor">{cls.INSTRUCTORS}</td>
                              <td>{cls.BILL_HRS}</td>
                            </tr>
                            {noteBottom && (
                              <tr className="row-note">
                                <td className="cell-note cell-note-label">NOTE</td>
                                <td colSpan={19} className="cell-note-text">{noteBottom}</td>
                              </tr>
                            )}
                          </React.Fragment>
                        )
                      })}
                    </>
                  ))}
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
            <div className="calendar-wrapp  er">
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
    </div >
  )
}

export default App
