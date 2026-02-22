import React, { useEffect, useState, useCallback, useMemo } from 'react'
import './App.css'
import { supabase } from './utils/supabase'
import { ScheduleXCalendar, useCalendarApp } from '@schedule-x/react'
import { createViewWeek } from '@schedule-x/calendar'
import { createEventsServicePlugin } from '@schedule-x/events-service'
import '@schedule-x/theme-default/dist/calendar.css'

// ── Pure helpers ─────────────────────────────────────────────

const splitByBr = (str: string | undefined | null): string[] => {
  if (!str) return []
  return str.split('<br>').map(s => s.trim())
}

const parseTimes = (timeStr: string) => {
  if (!timeStr || !timeStr.includes('-')) return null
  const [startRaw, endRaw] = timeStr.split('-')
  if (!startRaw || !endRaw || startRaw.length !== 4 || endRaw.length !== 4) return null
  return {
    start: `${startRaw.substring(0, 2)}:${startRaw.substring(2, 4)}`,
    end: `${endRaw.substring(0, 2)}:${endRaw.substring(2, 4)}`,
  }
}

const timeToMinutes = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

const rowTypeClass = (schdType: string) => {
  if (!schdType) return ''
  const t = schdType.trim().toLowerCase()
  if (t === 'lec') return 'row-lec'
  if (t === 'lab' || t === 'tut') return 'row-lab'
  return ''
}

/**
 * Parses a LINK_CONN string like "B0, T0" into structured tokens.
 * Each token represents one required companion type + group number.
 */
const parseLinkTokens = (linkStr: string | null | undefined): { prefix: string; num: string }[] => {
  if (!linkStr) return []
  return linkStr.split(',').map(s => s.trim()).filter(Boolean).map(s => ({
    prefix: s.charAt(0),   // e.g. 'B' — the SCHD_CODE of the required companion
    num: s.substring(1),   // e.g. '0' — the group number that must match
  }))
}

/**
 * Returns the group number for a section (all tokens in a LINK_CONN share the same number).
 * e.g. "L0, T0" → "0"
 */
const getLinkGroupNum = (linkStr: string | null | undefined): string | null => {
  const tokens = parseLinkTokens(linkStr)
  return tokens.length > 0 ? tokens[0].num : null
}

const COLOR_PALETTE = [
  { main: '#1565c0', container: '#dbeafe', onContainer: '#0d47a1' },
  { main: '#2e7d32', container: '#dcfce7', onContainer: '#166534' },
  { main: '#e65100', container: '#ffedd5', onContainer: '#9a3412' },
  { main: '#7b1fa2', container: '#f3e8ff', onContainer: '#581c87' },
  { main: '#c62828', container: '#fee2e2', onContainer: '#991b1b' },
  { main: '#00838f', container: '#cffafe', onContainer: '#155e75' },
  { main: '#ef6c00', container: '#fff3e0', onContainer: '#e65100' },
  { main: '#ad1457', container: '#fce7f3', onContainer: '#9d174d' },
]

const DAY_CONFIG = {
  SUNDAYS: { letter: 'U', date: '2026-02-15' },
  MONDAYS: { letter: 'M', date: '2026-02-16' },
  TUESDAYS: { letter: 'T', date: '2026-02-17' },
  WEDNESDAYS: { letter: 'W', date: '2026-02-18' },
  THURSDAYS: { letter: 'R', date: '2026-02-19' },
  FRIDAYS: { letter: 'F', date: '2026-02-20' },
  SATURDAYS: { letter: 'S', date: '2026-02-21' },
} as const

const DAY_LETTER_TO_KEY: Record<string, string> = {
  U: 'SUNDAYS', M: 'MONDAYS', T: 'TUESDAYS', W: 'WEDNESDAYS', R: 'THURSDAYS', F: 'FRIDAYS', S: 'SATURDAYS',
}


// ── Component ────────────────────────────────────────────────

type Workspace = { id: string; name: string; classes: any[] }
type AppState = { activeWorkspaceId: string; workspaces: Workspace[] }

const defaultState: AppState = {
  activeWorkspaceId: '1',
  workspaces: [{ id: '1', name: 'Plan A', classes: [] }]
}

function App() {
  const [classes, setClasses] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'browse' | 'schedule'>('browse')
  const [appState, setAppState] = useState<AppState>(() => {
    try {
      const storedV2 = localStorage.getItem('dal-planner-workspaces')
      if (storedV2) return JSON.parse(storedV2)

      const storedV1 = localStorage.getItem('dal-planner-selected')
      if (storedV1) {
        return {
          activeWorkspaceId: '1',
          workspaces: [{ id: '1', name: 'Plan A', classes: JSON.parse(storedV1) }]
        }
      }
    } catch (_e) { }
    return defaultState
  })

  const activeWorkspace = useMemo(() => appState.workspaces.find(w => w.id === appState.activeWorkspaceId) || appState.workspaces[0], [appState])
  const selectedClasses = activeWorkspace.classes

  const setSelectedClasses = useCallback((updater: any[] | ((prev: any[]) => any[])) => {
    setAppState(prev => {
      const active = prev.workspaces.find(w => w.id === prev.activeWorkspaceId) || prev.workspaces[0]
      const nextClasses = typeof updater === 'function' ? updater(active.classes) : updater
      return {
        ...prev,
        workspaces: prev.workspaces.map(w => w.id === prev.activeWorkspaceId ? { ...w, classes: nextClasses } : w)
      }
    })
  }, [])

  // Persist selections
  useEffect(() => {
    localStorage.setItem('dal-planner-workspaces', JSON.stringify(appState))
  }, [appState])

  // Workspace helpers
  const createWorkspace = () => {
    setAppState(prev => {
      const newId = String(Date.now())
      const newName = `Plan ${String.fromCharCode(65 + prev.workspaces.length)}`
      return {
        activeWorkspaceId: newId,
        workspaces: [...prev.workspaces, { id: newId, name: newName, classes: [] }]
      }
    })
  }

  const switchWorkspace = (id: string) => setAppState(prev => ({ ...prev, activeWorkspaceId: id }))

  const deleteWorkspace = (id: string) => {
    setAppState(prev => {
      if (prev.workspaces.length <= 1) return prev
      const nextWorkspaces = prev.workspaces.filter(w => w.id !== id)
      const nextId = prev.activeWorkspaceId === id ? nextWorkspaces[0].id : prev.activeWorkspaceId
      return { activeWorkspaceId: nextId, workspaces: nextWorkspaces }
    })
  }

  const [searchQuery, setSearchQuery] = useState('')

  const [envError, setEnvError] = useState(false)

  useEffect(() => {
    // If Supabase url is missing, the client fails to init or queries crash with no clear UI message
    if (!import.meta.env.VITE_SUPABASE_URL) {
      setEnvError(true)
      setLoading(false)
    }
  }, [])

  // Filter state
  const [subjectFilter, setSubjectFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [dayFilter, setDayFilter] = useState<Set<string>>(new Set())
  const [seatsAvailFilter, setSeatsAvailFilter] = useState(false)
  const [hideCDFilter, setHideCDFilter] = useState(false)

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1)
  const [rowsPerPage, setRowsPerPage] = useState(20)

  useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery, subjectFilter, typeFilter, dayFilter, seatsAvailFilter, hideCDFilter])

  // ── Derived data ──────────────────────────────────────────

  const uniqueSubjects = useMemo(() => {
    const subjects = new Set(classes.map(c => c.SUBJ_CODE).filter(Boolean))
    return Array.from(subjects).sort()
  }, [classes])

  const filteredClasses = useMemo(() => {
    return classes.filter(cls => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const title = (cls.CRSE_TITLE || '').toLowerCase()
        const code = `${cls.SUBJ_CODE || ''} ${cls.CRSE_NUMB || ''}`.toLowerCase()
        const crn = String(cls.CRN || '').toLowerCase()
        if (!title.includes(q) && !code.includes(q) && !crn.includes(q)) return false
      }
      if (subjectFilter && cls.SUBJ_CODE !== subjectFilter) return false
      if (typeFilter && (cls.SCHD_TYPE || '').toLowerCase() !== typeFilter.toLowerCase()) return false
      if (dayFilter.size > 0) {
        const meetsAnyDay = Array.from(dayFilter).some(d => {
          const key = DAY_LETTER_TO_KEY[d]
          if (!key) return false
          const vals = splitByBr(cls[key])
          return vals.some((v: string) => v.trim() !== '')
        })
        if (!meetsAnyDay) return false
      }
      if (seatsAvailFilter) {
        const seats = Number(cls.SEATS)
        if (isNaN(seats) || seats <= 0) return false
      }
      if (hideCDFilter && (cls.TIMES || '').trim().toUpperCase() === 'C/D') {
        return false
      }
      return true
    })
  }, [classes, searchQuery, subjectFilter, typeFilter, dayFilter, seatsAvailFilter, hideCDFilter])

  const paginatedClasses = useMemo(() => {
    const startIdx = (currentPage - 1) * rowsPerPage
    return filteredClasses.slice(startIdx, startIdx + rowsPerPage)
  }, [filteredClasses, currentPage, rowsPerPage])

  const groupedClasses = useMemo(() => {
    const groups: { key: string; code: string; title: string; termInfo: string; equiv: string; sections: any[] }[] = []
    const map = new Map<string, number>()
    paginatedClasses.forEach(cls => {
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
          equiv: cls.CRSE_EQUIV || '',
          sections: [],
        })
      }
      groups[map.get(key)!].sections.push(cls)
    })
    return groups
  }, [paginatedClasses])

  // ── Conflict detection ────────────────────────────────────

  const conflicts = useMemo(() => {
    const conflictMap = new Map<string, string[]>()
    const dayKeys = ['SUNDAYS', 'MONDAYS', 'TUESDAYS', 'WEDNESDAYS', 'THURSDAYS', 'FRIDAYS', 'SATURDAYS']
    const classSlots = selectedClasses.map(cls => {
      const timesArr = splitByBr(cls.TIMES)
      const slots: { day: string; start: number; end: number }[] = []
      timesArr.forEach((timeStr: string, idx: number) => {
        const times = parseTimes(timeStr)
        if (!times) return
        const startMin = timeToMinutes(times.start)
        const endMin = timeToMinutes(times.end)
        dayKeys.forEach(dayKey => {
          const dayVals = splitByBr(cls[dayKey])
          if (dayVals[idx]?.trim()) {
            slots.push({ day: dayKey, start: startMin, end: endMin })
          }
        })
      })
      return { cls, slots, id: `${cls.CRN}-${cls.SEQ_NUMB}` }
    })
    for (let i = 0; i < classSlots.length; i++) {
      for (let j = i + 1; j < classSlots.length; j++) {
        const a = classSlots[i]
        const b = classSlots[j]
        for (const slotA of a.slots) {
          for (const slotB of b.slots) {
            if (slotA.day === slotB.day && slotA.start < slotB.end && slotB.start < slotA.end) {
              const aName = a.cls.SUBJ_CODE ? `${a.cls.SUBJ_CODE} ${a.cls.CRSE_NUMB} ${a.cls.SCHD_TYPE || ''}`.trim() : `CRN ${a.cls.CRN}`
              const bName = b.cls.SUBJ_CODE ? `${b.cls.SUBJ_CODE} ${b.cls.CRSE_NUMB} ${b.cls.SCHD_TYPE || ''}`.trim() : `CRN ${b.cls.CRN}`

              if (!conflictMap.has(a.id)) conflictMap.set(a.id, [])
              if (!conflictMap.get(a.id)!.includes(bName)) conflictMap.get(a.id)!.push(bName)

              if (!conflictMap.has(b.id)) conflictMap.set(b.id, [])
              if (!conflictMap.get(b.id)!.includes(aName)) conflictMap.get(b.id)!.push(aName)
            }
          }
        }
      }
    }
    return conflictMap
  }, [selectedClasses])

  // ── Incompatible Link Connection ──────────────────────────

  // ── Incompatible Link Detection ───────────────────────────
  //
  // A section is incompatible if a currently-selected section has a link
  // requirement for that section's type (SCHD_CODE), but with a different
  // group number. e.g. if you selected a Lec with LINK_CONN='B0', then
  // labs with group number '1' are incompatible.
  //
  const incompatibleLinks = useMemo(() => {
    const invalid = new Set<string>()

    // Build a map of what companion group numbers are required, per course per SCHD_CODE type
    // e.g. { 'CSCI-4176': { 'B': Set{'0'} } }
    const requirements = new Map<string, Map<string, Set<string>>>()

    selectedClasses.forEach(cls => {
      const tokens = parseLinkTokens(cls.LINK_CONN)
      if (tokens.length === 0) return
      const courseKey = `${cls.SUBJ_CODE}-${cls.CRSE_NUMB}`
      tokens.forEach(({ prefix, num }) => {
        if (!requirements.has(courseKey)) requirements.set(courseKey, new Map())
        const byType = requirements.get(courseKey)!
        if (!byType.has(prefix)) byType.set(prefix, new Set())
        byType.get(prefix)!.add(num)
      })
    })

    // Mark sections that don't match the required group number for their type
    classes.forEach(cls => {
      if (!cls.LINK_CONN || !cls.SCHD_CODE) return
      // Don't mark already-selected sections as incompatible
      if (selectedClasses.some(s => s.CRN === cls.CRN && s.SEQ_NUMB === cls.SEQ_NUMB)) return

      const courseKey = `${cls.SUBJ_CODE}-${cls.CRSE_NUMB}`
      const courseReqs = requirements.get(courseKey)
      if (!courseReqs) return

      const requiredNums = courseReqs.get(cls.SCHD_CODE)
      if (!requiredNums || requiredNums.size === 0) return

      const myGroupNum = getLinkGroupNum(cls.LINK_CONN)
      if (myGroupNum !== null && !requiredNums.has(myGroupNum)) {
        invalid.add(`${cls.CRN}-${cls.SEQ_NUMB}`)
      }
    })

    return invalid
  }, [selectedClasses, classes])

  // ── Missing Link Detection ────────────────────────────────
  //
  // A selected section has a missing link if it requires a companion
  // (per its LINK_CONN tokens) that isn't in the selected set.
  //
  // Rule: token {prefix, num} is satisfied if another selected section
  // in the same course has SCHD_CODE === prefix AND the same group number.
  //
  const missingLinks = useMemo(() => {
    const missing = new Map<string, string[]>() // classId → list of unsatisfied token strings

    // Index selected classes by course for fast lookup
    const selectedByCourse = new Map<string, any[]>()
    selectedClasses.forEach(cls => {
      const key = `${cls.SUBJ_CODE}-${cls.CRSE_NUMB}`
      if (!selectedByCourse.has(key)) selectedByCourse.set(key, [])
      selectedByCourse.get(key)!.push(cls)
    })

    selectedClasses.forEach(cls => {
      const tokens = parseLinkTokens(cls.LINK_CONN)
      if (tokens.length === 0) return

      const courseKey = `${cls.SUBJ_CODE}-${cls.CRSE_NUMB}`
      const companions = (selectedByCourse.get(courseKey) || []).filter(
        other => !(other.CRN === cls.CRN && other.SEQ_NUMB === cls.SEQ_NUMB)
      )

      const unsatisfied: string[] = []
      tokens.forEach(({ prefix, num }) => {
        const satisfied = companions.some(other => {
          if (other.SCHD_CODE !== prefix) return false
          return getLinkGroupNum(other.LINK_CONN) === num
        })
        if (!satisfied) unsatisfied.push(`${prefix}${num}`)
      })

      if (unsatisfied.length > 0) {
        missing.set(`${cls.CRN}-${cls.SEQ_NUMB}`, unsatisfied)
      }
    })

    return missing
  }, [selectedClasses])

  const totalCredits = useMemo(() => {
    return selectedClasses.reduce((sum, cls) => sum + (Number(cls.CREDIT_HRS) || 0), 0)
  }, [selectedClasses])



  // ── Callbacks ─────────────────────────────────────────────

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

  const toggleDayFilter = useCallback((day: string) => {
    setDayFilter(prev => {
      const next = new Set(prev)
      next.has(day) ? next.delete(day) : next.add(day)
      return next
    })
  }, [])

  const clearFilters = useCallback(() => {
    setSubjectFilter('')
    setTypeFilter('')
    setDayFilter(new Set())
    setSeatsAvailFilter(false)
    setHideCDFilter(false)
  }, [])

  const hasActiveFilters = subjectFilter || typeFilter || dayFilter.size > 0 || seatsAvailFilter || hideCDFilter

  const activeFilterLabels = useMemo(() => {
    const labels: string[] = []
    if (subjectFilter) labels.push(subjectFilter)
    if (typeFilter) labels.push(typeFilter.toUpperCase())
    if (dayFilter.size > 0) labels.push(Array.from(dayFilter).join(''))
    if (seatsAvailFilter) labels.push('Available')
    if (hideCDFilter) labels.push('No C/D')
    return labels
  }, [subjectFilter, typeFilter, dayFilter, seatsAvailFilter, hideCDFilter])

  // ── Calendar state data ───────────────────────────────────

  const { calendarEvents, asyncClasses, minTime, maxTime, hasWeekend, courseColorMap } = useMemo(() => {
    const evs: any[] = []
    const asyncCls: any[] = []
    let earliest = 480 // 8:00 AM in mins
    let latest = 1020 // 17:00 in mins
    let weekend = false

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
      const validTimes = timesArr.filter(t => t.includes('-'))
      if (validTimes.length === 0) {
        asyncCls.push(cls)
        return
      }

      const mondaysArr = splitByBr(cls.MONDAYS)
      const tuesdaysArr = splitByBr(cls.TUESDAYS)
      const wednesdaysArr = splitByBr(cls.WEDNESDAYS)
      const thursdaysArr = splitByBr(cls.THURSDAYS)
      const fridaysArr = splitByBr(cls.FRIDAYS)
      const saturdaysArr = splitByBr(cls.SATURDAYS)
      const sundaysArr = splitByBr(cls.SUNDAYS)

      const wlistCnt = Number(cls.WLIST) || 0;
      const isWaitlisted = Number(cls.SEATS) <= 0 && wlistCnt > 0;
      const calendarId = isWaitlisted ? 'waitlist' : (colorMap.get(`${cls.SUBJ_CODE}-${cls.CRSE_NUMB}`) || 'course-0')

      timesArr.forEach((timeStr: string, idx: number) => {
        const times = parseTimes(timeStr)
        if (!times) return
        const startMin = timeToMinutes(times.start)
        const endMin = timeToMinutes(times.end)
        earliest = Math.min(earliest, startMin)
        latest = Math.max(latest, endMin)

        const dayKeys = ['SUNDAYS', 'MONDAYS', 'TUESDAYS', 'WEDNESDAYS', 'THURSDAYS', 'FRIDAYS', 'SATURDAYS'] as const
        const dayArrs = [sundaysArr, mondaysArr, tuesdaysArr, wednesdaysArr, thursdaysArr, fridaysArr, saturdaysArr]
        dayKeys.forEach((dayKey, i) => {
          const config = DAY_CONFIG[dayKey]
          const dayVal = dayArrs[i][idx]
          if (dayVal && dayVal.trim() !== '') {
            if (dayKey === 'SATURDAYS' || dayKey === 'SUNDAYS') weekend = true
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
              isWaitlist: isWaitlisted
            })
          }
        })
      })
    })

    const padE = Math.max(0, earliest - 60)
    const padL = Math.min(1440, latest + 60)
    const fmt = (m: number) => `${Math.floor(m / 60).toString().padStart(2, '0')}:${(m % 60).toString().padStart(2, '0')}`

    return { calendarEvents: evs, asyncClasses: asyncCls, minTime: fmt(padE), maxTime: fmt(padL), hasWeekend: weekend, courseColorMap: colorMap }
  }, [selectedClasses])

  // ── Calendar App Setup ────────────────────────────────────

  const [eventsService] = useState(() => createEventsServicePlugin())

  const calendar = useCalendarApp({
    views: [createViewWeek()],
    dayBoundaries: { start: minTime, end: maxTime },
    weekOptions: { gridHeight: 800, nDays: hasWeekend ? 7 : 5 },
    events: [],
    plugins: [eventsService],
    selectedDate: Temporal.PlainDate.from(hasWeekend ? '2026-02-15' : '2026-02-16'),
    calendars: {
      ...Object.fromEntries(
        COLOR_PALETTE.map((c, i) => [`course-${i}`, {
          colorName: `course-${i}`,
          lightColors: c,
          darkColors: c,
        }])
      ),
      waitlist: {
        colorName: 'waitlist',
        lightColors: { main: '#9CA3AF', container: '#F3F4F6', onContainer: '#4B5563' },
        darkColors: { main: '#9CA3AF', container: '#F3F4F6', onContainer: '#4B5563' }
      }
    },
  })

  useEffect(() => {
    eventsService.set(calendarEvents)
  }, [calendarEvents, eventsService])

  // ── Fetch data ────────────────────────────────────────────

  useEffect(() => {
    async function getClasses() {
      const { data: CLASSES, error } = await supabase
        .from('dalhousie_classes')
        .select(`
          subj_code, crse_numb, note_row, crn, seq_numb, schd_type, schd_code,
          credit_hrs, link_conn, 
          mondays, tuesdays, wednesdays, thursdays, fridays, saturdays, sundays, crse_title,
          times, locations, max_enrl, enrl, seats, wlist,
          perc_full, xlist_max, xlist_cur, instructors, 
          tuition_code, bill_hrs, note_bottom, crse_equiv,
          term_code, ptrm_code, start_date, end_date
        `)

      if (error) {
        console.error('Error fetching classes:', error)
      } else if (CLASSES && CLASSES.length > 0) {
        const upperClasses = CLASSES.map((c: any) => {
          const upperC: any = {}
          for (const key in c) {
            upperC[key.toUpperCase()] = c[key]
          }
          return upperC
        })
        setClasses(upperClasses)
        setSelectedClasses(prev => {
          if (prev.length === 0) return prev
          const crnSet = new Set(upperClasses.map((c: any) => `${c.CRN}-${c.SEQ_NUMB}`))
          const valid = prev.filter((c: any) => crnSet.has(`${c.CRN}-${c.SEQ_NUMB}`))
          return valid.length === prev.length ? prev : valid
        })
      }
      setLoading(false)
    }
    getClasses()
  }, [])



  // ── Render ────────────────────────────────────────────────

  return (
    <div className="app-container">
      {/* ── Header ── */}
      <header className="app-header">
        <div className="header-title-container">
          <h1>DAL Planner</h1>
          <span className="dal-badge">2025–26</span>
        </div>

        <div className="workspace-selector">
          <select
            value={appState.activeWorkspaceId}
            onChange={e => {
              if (e.target.value === 'NEW') createWorkspace()
              else switchWorkspace(e.target.value)
            }}
          >
            {appState.workspaces.map(w => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
            <option value="NEW">+ New Plan...</option>
          </select>
          {appState.workspaces.length > 1 && (
            <button className="workspace-delete" onClick={() => deleteWorkspace(appState.activeWorkspaceId)} title="Delete Plan">
              ✕
            </button>
          )}
        </div>

        {/* Tabs */}
        <nav className="header-tabs">
          <button
            className={`header-tab ${activeTab === 'browse' ? 'active' : ''}`}
            onClick={() => setActiveTab('browse')}
          >
            Browse Classes
          </button>
          <button
            className={`header-tab ${activeTab === 'schedule' ? 'active' : ''}`}
            onClick={() => setActiveTab('schedule')}
          >
            My Schedule
            {selectedClasses.length > 0 && (
              <span className="tab-badge">{selectedClasses.length}</span>
            )}
          </button>
        </nav>

        <div className="header-spacer" />
        {missingLinks.size > 0 && (
          <span className="header-conflict" style={{ backgroundColor: '#fef08a', color: '#854d0e' }}>
            {missingLinks.size} missing link{missingLinks.size > 1 ? 's' : ''}
          </span>
        )}
        {conflicts.size > 0 && (
          <span className="header-conflict">{conflicts.size} conflict{conflicts.size > 1 ? 's' : ''}</span>
        )}
        {selectedClasses.length > 0 && (
          <span className="header-credits">{totalCredits} cr hrs</span>
        )}
      </header>

      {/* ── Env Error Check ── */}
      {envError ? (
        <main className="main-content" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '40px' }}>
          <h2 style={{ color: '#991b1b', marginBottom: '8px' }}>Missing Environment Variables</h2>
          <p style={{ color: '#4b5563', maxWidth: '500px', textAlign: 'center', lineHeight: '1.5' }}>
            It looks like this application is missing its Supabase environment variables. If you just deployed this to Vercel, navigate to <b>Settings &gt; Environment Variables</b> and ensure <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY</code> are correctly entered.
          </p>
        </main>
      ) : (
        <>
          {/* ══════════ BROWSE TAB ══════════ */}
          {activeTab === 'browse' && (
            <div className="tab-content browse-tab">
              {/* Toolbar */}
              <div className="toolbar">
                <div className="toolbar-search-row">
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
                      <button className="search-clear" onClick={() => setSearchQuery('')} aria-label="Clear search">✕</button>
                    )}
                  </div>
                  {searchQuery && (
                    <span className="search-result-count">
                      {filteredClasses.length} {filteredClasses.length === 1 ? 'result' : 'results'}
                    </span>
                  )}
                </div>
                <div className="toolbar-filter-row">
                  <select value={subjectFilter} onChange={e => setSubjectFilter(e.target.value)} className="filter-select">
                    <option value="">All Subjects</option>
                    {uniqueSubjects.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="filter-select">
                    <option value="">All Types</option>
                    <option value="lec">Lecture</option>
                    <option value="lab">Lab</option>
                    <option value="tut">Tutorial</option>
                  </select>
                  <div className="day-toggles">
                    {['M', 'T', 'W', 'R', 'F'].map(d => (
                      <button
                        key={d}
                        className={`day-toggle ${dayFilter.has(d) ? 'active' : ''}`}
                        onClick={() => toggleDayFilter(d)}
                      >{d}</button>
                    ))}
                  </div>
                  <button
                    className={`filter-toggle ${seatsAvailFilter ? 'active' : ''}`}
                    onClick={() => setSeatsAvailFilter(v => !v)}
                  >Available Only</button>
                  <button
                    className={`filter-toggle ${hideCDFilter ? 'active' : ''}`}
                    onClick={() => setHideCDFilter(v => !v)}
                  >Hide C/D</button>
                  {hasActiveFilters && (
                    <button className="filter-clear" onClick={clearFilters}>Clear Filters</button>
                  )}
                </div>
              </div>

              {activeFilterLabels.length > 0 && (
                <div className="active-filters-bar">
                  <span className="active-filters-label">Filtering:</span>
                  {activeFilterLabels.map((label, i) => (
                    <span key={i} className="active-filter-tag">{label}</span>
                  ))}
                  {searchQuery && <span className="active-filter-tag">"{searchQuery}"</span>}
                </div>
              )}

              {/* Pagination Controls */}
              {classes.length > 0 && (
                <div className="pagination-controls" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
                  <div className="pagination-info" style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                    Showing {Math.min((currentPage - 1) * rowsPerPage + 1, filteredClasses.length)} – {Math.min(currentPage * rowsPerPage, filteredClasses.length)} of {filteredClasses.length} results
                  </div>
                  <div className="pagination-actions" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div className="rows-per-page" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Rows per page:</span>
                      <select
                        value={rowsPerPage}
                        onChange={e => {
                          setRowsPerPage(Number(e.target.value))
                          setCurrentPage(1)
                        }}
                        style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border)', fontSize: '0.875rem' }}
                      >
                        <option value={10}>10</option>
                        <option value={20}>20</option>
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                      </select>
                    </div>
                    <div className="page-buttons" style={{ display: 'flex', gap: '4px' }}>
                      <button
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        style={{ padding: '4px 12px', border: '1px solid var(--border)', borderRadius: '4px', background: currentPage === 1 ? 'var(--background)' : 'white', cursor: currentPage === 1 ? 'not-allowed' : 'pointer' }}
                      >
                        Prev
                      </button>
                      <button
                        onClick={() => setCurrentPage(p => Math.min(Math.ceil(filteredClasses.length / rowsPerPage), p + 1))}
                        disabled={currentPage >= Math.ceil(filteredClasses.length / rowsPerPage)}
                        style={{ padding: '4px 12px', border: '1px solid var(--border)', borderRadius: '4px', background: currentPage >= Math.ceil(filteredClasses.length / rowsPerPage) ? 'var(--background)' : 'white', cursor: currentPage >= Math.ceil(filteredClasses.length / rowsPerPage) ? 'not-allowed' : 'pointer' }}
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Table */}
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
                        <th className="th-avail">Availability</th>
                        <th>Instructor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupedClasses.map(group => (
                        <React.Fragment key={group.key}>
                          <tr className="course-header">
                            <td colSpan={19}>
                              <div className="course-header-inner">
                                <span>
                                  <span className="course-code">{highlightMatch(group.code)}</span>
                                  <span className="course-title">{highlightMatch(group.title)}</span>
                                  {group.equiv && <span className="course-equiv">Also offered as {highlightMatch(group.equiv)}</span>}
                                </span>
                                {group.termInfo && <span className="course-term">{group.termInfo}</span>}
                              </div>
                            </td>
                          </tr>
                          {group.sections.map((cls, idx) => {
                            const isSelected = selectedClasses.some(c => c.CRN === cls.CRN && c.SEQ_NUMB === cls.SEQ_NUMB)
                            const noteVal = (cls.NOTE_ROW || '').trim()
                            const noteBottom = (cls.NOTE_BOTTOM || '').trim()
                            const conflictList = conflicts.get(`${cls.CRN}-${cls.SEQ_NUMB}`)
                            const hasConflict = !!conflictList
                            const isInvalidLink = incompatibleLinks.has(`${cls.CRN}-${cls.SEQ_NUMB}`)
                            return (
                              <React.Fragment key={`${group.key}-${idx}`}>
                                <tr
                                  className={[
                                    isSelected ? 'row-selected' : '',
                                    rowTypeClass(cls.SCHD_TYPE),
                                    hasConflict ? 'row-conflict' : '',
                                    cls.TIMES === 'C/D' ? 'row-dimmed' : '',
                                    isInvalidLink ? 'row-incompatible' : '',
                                    noteBottom ? 'row-has-note' : '',
                                  ].filter(Boolean).join(' ')}
                                >
                                  <td className="cell-note">{noteVal}</td>
                                  <td className="cell-select">
                                    {(() => {
                                      const isWlist = Number(cls.SEATS) <= 0 && Number(cls.WLIST) > 0;
                                      return (
                                        <label className={`select-label ${isWlist ? 'is-wlist' : ''}`} title={isInvalidLink ? 'Link combo incompatible' : (isWlist ? 'Full - Join Waitlist' : 'Select Class')}>
                                          <input type="checkbox" checked={isSelected} disabled={isInvalidLink} onChange={() => toggleClassSelection(cls)} />
                                          {isWlist && !isInvalidLink && <span className="wlist-badge">Waitlist</span>}
                                        </label>
                                      )
                                    })()}
                                  </td>
                                  <td>{highlightMatch(String(cls.CRN ?? ''))}</td>
                                  <td>{cls.SEQ_NUMB}</td>
                                  <td>{cls.SCHD_TYPE || 'Lec'}</td>
                                  <td>{cls.CREDIT_HRS}</td>
                                  <td className="cell-narrow">{cls.LINK_CONN}</td>
                                  <td>
                                    {splitByBr(cls.MONDAYS).map((val, i) => (
                                      <div key={i} className={`sub-row ${val?.trim() ? 'day-active' : 'day-empty'}`}>{val}</div>
                                    ))}
                                  </td>
                                  <td>
                                    {splitByBr(cls.TUESDAYS).map((val, i) => (
                                      <div key={i} className={`sub-row ${val?.trim() ? 'day-active' : 'day-empty'}`}>{val}</div>
                                    ))}
                                  </td>
                                  <td>
                                    {splitByBr(cls.WEDNESDAYS).map((val, i) => (
                                      <div key={i} className={`sub-row ${val?.trim() ? 'day-active' : 'day-empty'}`}>{val}</div>
                                    ))}
                                  </td>
                                  <td>
                                    {splitByBr(cls.THURSDAYS).map((val, i) => (
                                      <div key={i} className={`sub-row ${val?.trim() ? 'day-active' : 'day-empty'}`}>{val}</div>
                                    ))}
                                  </td>
                                  <td>
                                    {splitByBr(cls.FRIDAYS).map((val, i) => (
                                      <div key={i} className={`sub-row ${val?.trim() ? 'day-active' : 'day-empty'}`}>{val}</div>
                                    ))}
                                  </td>
                                  <td className="cell-times">
                                    {splitByBr(cls.TIMES).map((t, i) => <div key={i} className="sub-row">{t}</div>)}
                                  </td>
                                  <td className="cell-location">
                                    {splitByBr(cls.LOCATIONS).map((l, i) => <div key={i} className="sub-row">{l}</div>)}
                                  </td>
                                  <td className="cell-avail">
                                    {(() => {
                                      const seats = Number(cls.SEATS) || 0;
                                      const max = Number(cls.MAX_ENRL) || 0;
                                      const enrl = Number(cls.ENRL) || 0;
                                      const wlist = Number(cls.WLIST) || 0;
                                      const pct = max > 0 ? (enrl / max) * 100 : 0;

                                      if (seats <= 0 && wlist > 0) {
                                        return (
                                          <div className="avail-wrapper">
                                            <div className="avail-text wlist-text">Class Full — Waitlist: {wlist}</div>
                                            <div className="avail-bar-bg"><div className="avail-bar-fill wlist-fill" style={{ width: `100%` }} /></div>
                                          </div>
                                        )
                                      }
                                      return (
                                        <div className="avail-wrapper">
                                          <div className="avail-text">{Math.max(0, seats)} seats left ({enrl}/{max})</div>
                                          <div className="avail-bar-bg"><div className="avail-bar-fill" style={{ width: `${Math.min(100, pct)}%`, backgroundColor: pct >= 95 ? '#dc2626' : pct >= 80 ? '#d97706' : '#16a34a' }} /></div>
                                        </div>
                                      )
                                    })()}
                                  </td>
                                  <td className="cell-instructor">
                                    {splitByBr(cls.INSTRUCTORS).map((inst, i) => <div key={i} className="sub-row">{inst}</div>)}
                                  </td>
                                </tr>
                                {missingLinks.has(`${cls.CRN}-${cls.SEQ_NUMB}`) && (
                                  <tr className="row-conflict-detail" style={{ backgroundColor: '#fef08a' }}>
                                    <td className="cell-note"></td>
                                    <td colSpan={15} className="conflict-detail-text" style={{ color: '#854d0e' }}>
                                      Requires a linked section: {missingLinks.get(`${cls.CRN}-${cls.SEQ_NUMB}`)?.join(', ')}
                                    </td>
                                  </tr>
                                )}
                                {hasConflict && (
                                  <tr className="row-conflict-detail">
                                    <td className="cell-note"></td>
                                    <td colSpan={15} className="conflict-detail-text">Conflicts with {conflictList?.join(', ')}</td>
                                  </tr>
                                )}
                                {noteBottom && (
                                  <tr className="row-note">
                                    <td className="cell-note cell-note-label">↳ NOTE</td>
                                    <td colSpan={18} className="cell-note-text">{noteBottom}</td>
                                  </tr>
                                )}
                              </React.Fragment>
                            )
                          })}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Pagination Controls (Bottom) */}
              {classes.length > 0 && (
                <div className="pagination-controls" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
                  <div className="pagination-info" style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                    Showing {Math.min((currentPage - 1) * rowsPerPage + 1, filteredClasses.length)} – {Math.min(currentPage * rowsPerPage, filteredClasses.length)} of {filteredClasses.length} results
                  </div>
                  <div className="pagination-actions" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div className="rows-per-page" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Rows per page:</span>
                      <select
                        value={rowsPerPage}
                        onChange={e => {
                          setRowsPerPage(Number(e.target.value))
                          setCurrentPage(1)
                        }}
                        style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border)', fontSize: '0.875rem' }}
                      >
                        <option value={10}>10</option>
                        <option value={20}>20</option>
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                      </select>
                    </div>
                    <div className="page-buttons" style={{ display: 'flex', gap: '4px' }}>
                      <button
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        style={{ padding: '4px 12px', border: '1px solid var(--border)', borderRadius: '4px', background: currentPage === 1 ? 'var(--background)' : 'white', cursor: currentPage === 1 ? 'not-allowed' : 'pointer' }}
                      >
                        Prev
                      </button>
                      <button
                        onClick={() => setCurrentPage(p => Math.min(Math.ceil(filteredClasses.length / rowsPerPage), p + 1))}
                        disabled={currentPage >= Math.ceil(filteredClasses.length / rowsPerPage)}
                        style={{ padding: '4px 12px', border: '1px solid var(--border)', borderRadius: '4px', background: currentPage >= Math.ceil(filteredClasses.length / rowsPerPage) ? 'var(--background)' : 'white', cursor: currentPage >= Math.ceil(filteredClasses.length / rowsPerPage) ? 'not-allowed' : 'pointer' }}
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Mini Preview Bar (sticky bottom) ── */}
              {selectedClasses.length > 0 && (
                <div className="mini-preview">
                  <div className="mini-preview-info">
                    <span className="mini-preview-count">{selectedClasses.length} class{selectedClasses.length > 1 ? 'es' : ''}</span>
                    <span className="mini-preview-dot">·</span>
                    <span className="mini-preview-credits">{totalCredits} credit hr{totalCredits !== 1 ? 's' : ''}</span>
                    {missingLinks.size > 0 && (
                      <>
                        <span className="mini-preview-dot">·</span>
                        <span className="mini-preview-conflict" style={{ backgroundColor: '#fef08a', color: '#854d0e' }}>
                          {missingLinks.size} missing link{missingLinks.size > 1 ? 's' : ''}
                        </span>
                      </>
                    )}
                    {conflicts.size > 0 && (
                      <>
                        <span className="mini-preview-dot">·</span>
                        <span className="mini-preview-conflict">{conflicts.size} conflict{conflicts.size > 1 ? 's' : ''}</span>
                      </>
                    )}
                  </div>
                  <div className="mini-preview-chips">
                    {selectedClasses.map((sc, i) => (
                      <span key={i} className="mini-chip">
                        {sc.SUBJ_CODE && sc.CRSE_NUMB
                          ? `${sc.SUBJ_CODE} ${sc.CRSE_NUMB}`
                          : `CRN ${sc.CRN}`}
                        <button className="chip-remove" onClick={() => toggleClassSelection(sc)} aria-label="Remove">✕</button>
                      </span>
                    ))}
                  </div>
                  <button className="mini-preview-cta" onClick={() => setActiveTab('schedule')}>
                    View Schedule →
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ══════════ SCHEDULE TAB ══════════ */}
          {activeTab === 'schedule' && (
            <div className="tab-content schedule-tab">
              {selectedClasses.length === 0 ? (
                <div className="schedule-empty">
                  <div className="empty-icon">📅</div>
                  <div className="empty-title">No classes selected</div>
                  <div className="empty-hint">Go to Browse Classes and check the boxes next to classes you want to take</div>
                  <button className="empty-cta" onClick={() => setActiveTab('browse')}>← Browse Classes</button>
                </div>
              ) : (
                <>
                  {conflicts.size > 0 && (
                    <div className="conflict-banner">
                      Schedule conflict — {conflicts.size} class{conflicts.size > 1 ? 'es' : ''} have overlapping times
                    </div>
                  )}

                  <div className="schedule-header">
                    <div className="schedule-stats">
                      <span className="stat-item">{selectedClasses.length} class{selectedClasses.length > 1 ? 'es' : ''}</span>
                      <span className="stat-dot">·</span>
                      <span className="stat-item">{totalCredits} credit hour{totalCredits !== 1 ? 's' : ''}</span>
                    </div>
                    <div className="schedule-chips">
                      {selectedClasses.map((sc, i) => (
                        <span key={i} className="selected-chip">
                          {sc.SUBJ_CODE && sc.CRSE_NUMB
                            ? `${sc.SUBJ_CODE} ${sc.CRSE_NUMB}`
                            : `CRN ${sc.CRN}`
                          } · {sc.SEQ_NUMB}
                          <button className="chip-remove" onClick={() => toggleClassSelection(sc)} aria-label="Remove">✕</button>
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="calendar-full">
                    <ScheduleXCalendar calendarApp={calendar} />
                  </div>

                  {asyncClasses.length > 0 && (
                    <div className="async-section">
                      <h3 className="async-title">Asynchronous & TBA Courses</h3>
                      <div className="async-grid">
                        {asyncClasses.map((cls, i) => (
                          <div key={i} className={`async-card ${courseColorMap.get(`${cls.SUBJ_CODE}-${cls.CRSE_NUMB}`) || 'course-0'}`}>
                            <div className="async-card-header">
                              <span className="async-code">
                                {cls.SUBJ_CODE} {cls.CRSE_NUMB}
                              </span>
                              <span className="async-sec">Sec {cls.SEQ_NUMB}</span>
                            </div>
                            <div className="async-title-text">{cls.CRSE_TITLE}</div>
                            <div className="async-info">
                              <span>{cls.CREDIT_HRS} Cr Hrs</span>
                              <span>·</span>
                              <span>CRN {cls.CRN}</span>
                            </div>
                            <div className="async-times">
                              {splitByBr(cls.TIMES).join(', ') || 'Online / TBA'}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default App
