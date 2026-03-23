import { useEffect, useState, useCallback, useMemo } from 'react'
import './App.css'
import { supabase } from './utils/supabase'
import { splitByBr, parseTimes, timeToMinutes, parseLinkTokens, getLinkGroupNum } from './utils/classUtils'
import AppHeader from './components/AppHeader'
import BrowseTab from './components/BrowseTab'
import ScheduleTab from './components/ScheduleTab'
import AboutModal from './components/AboutModal'
import type { CourseSection, AppState } from './types'
import { track } from './utils/analytics'

const defaultState: AppState = {
  activeWorkspaceId: '1',
  workspaces: [{ id: '1', name: 'Plan A', classes: [] }]
}

const CACHE_TTL_MS = 10 * 60 * 1000
const termCache = new Map<string, { data: CourseSection[]; fetchedAt: number }>()

function App() {
  const [classes, setClasses] = useState<CourseSection[]>([])
  const [loading, setLoading] = useState(true)
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'browse' | 'schedule'>('browse')
  const [envError, setEnvError] = useState(false)
  const [showAbout, setShowAbout] = useState(false)
  const [fetchError, setFetchError] = useState(false)

  const [termFilter, setTermFilter] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('dal-planner-terms')
      if (stored) return new Set(JSON.parse(stored))
    } catch (_e) { }
    return new Set()
  })

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

  const activeWorkspace = useMemo(
    () => appState.workspaces.find(w => w.id === appState.activeWorkspaceId) || appState.workspaces[0],
    [appState]
  )
  const selectedClasses = activeWorkspace.classes

  const setSelectedClasses = useCallback((updater: CourseSection[] | ((prev: CourseSection[]) => CourseSection[])) => {
    setAppState(prev => {
      const active = prev.workspaces.find(w => w.id === prev.activeWorkspaceId) || prev.workspaces[0]
      const nextClasses = typeof updater === 'function' ? updater(active.classes) : updater
      return {
        ...prev,
        workspaces: prev.workspaces.map(w => w.id === prev.activeWorkspaceId ? { ...w, classes: nextClasses } : w)
      }
    })
  }, [])

  useEffect(() => {
    localStorage.setItem('dal-planner-workspaces', JSON.stringify(appState))
  }, [appState])

  useEffect(() => {
    localStorage.setItem('dal-planner-terms', JSON.stringify(Array.from(termFilter)))
  }, [termFilter])

  const createWorkspace = useCallback(() => {
    setAppState(prev => {
      const newId = String(Date.now())
      const newName = `Plan ${String.fromCharCode(65 + prev.workspaces.length)}`
      track('workspace_created', { workspace_name: newName, total_workspaces: prev.workspaces.length + 1 })
      return {
        activeWorkspaceId: newId,
        workspaces: [...prev.workspaces, { id: newId, name: newName, classes: [] }]
      }
    })
  }, [])

  const switchWorkspace = useCallback((id: string) => {
    track('workspace_switched')
    setAppState(prev => ({ ...prev, activeWorkspaceId: id }))
  }, [])

  const deleteWorkspace = useCallback((id: string) => {
    track('workspace_deleted')
    setAppState(prev => {
      if (prev.workspaces.length <= 1) return prev
      const nextWorkspaces = prev.workspaces.filter(w => w.id !== id)
      const nextId = prev.activeWorkspaceId === id ? nextWorkspaces[0].id : prev.activeWorkspaceId
      return { activeWorkspaceId: nextId, workspaces: nextWorkspaces }
    })
  }, [])

  const renameWorkspace = useCallback((id: string, name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    track('workspace_renamed', { workspace_name: trimmed })
    setAppState(prev => ({
      ...prev,
      workspaces: prev.workspaces.map(w => w.id === id ? { ...w, name: trimmed } : w)
    }))
  }, [])

  const toggleTerm = useCallback((term: string) => {
    setTermFilter(prev => {
      const next = new Set(prev)
      const action = next.has(term) ? 'deselected' : 'selected'
      next.has(term) ? next.delete(term) : next.add(term)
      track('term_filter_toggled', { term, action, active_terms: Array.from(next) })
      return next
    })
  }, [])

  const toggleClassSelection = useCallback((cls: CourseSection) => {
    const isSelected = selectedClasses.some(c => c.CRN === cls.CRN && c.SEQ_NUMB === cls.SEQ_NUMB)
    track(isSelected ? 'class_deselected' : 'class_selected', {
      crn: cls.CRN,
      course: `${cls.SUBJ_CODE} ${cls.CRSE_NUMB}`,
      type: cls.SCHD_TYPE,
      term: cls.TERM_CODE,
    })
    setSelectedClasses(prev => {
      const wasSelected = prev.some(c => c.CRN === cls.CRN && c.SEQ_NUMB === cls.SEQ_NUMB)
      if (wasSelected) return prev.filter(c => !(c.CRN === cls.CRN && c.SEQ_NUMB === cls.SEQ_NUMB))
      return [...prev, cls]
    })
  }, [selectedClasses, setSelectedClasses])

  useEffect(() => {
    if (!import.meta.env.VITE_SUPABASE_URL) {
      setEnvError(true)
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    async function getClasses() {
      if (termFilter.size === 0) {
        setClasses([])
        setLoading(false)
        return
      }

      setLoading(true)
      setFetchError(false)

      const terms = Array.from(termFilter)
      const now = Date.now()
      const uncached = terms.filter(t => {
        const entry = termCache.get(t)
        return !entry || (now - entry.fetchedAt > CACHE_TTL_MS)
      })

      if (uncached.length > 0) {
        const PAGE_SIZE = 1000

        await Promise.all(
          uncached.map(async term => {
            const rows: any[] = []
            let from = 0
            let hasError = false
            while (true) {
              const { data, error } = await supabase
                .from('dalhousie_classes')
                .select(`
                  row_number, subj_code, crse_numb, note_row, crn, seq_numb, schd_type, schd_code,
                  credit_hrs, link_conn,
                  mondays, tuesdays, wednesdays, thursdays, fridays, saturdays, sundays, crse_title,
                  times, locations, max_enrl, enrl, seats, wlist,
                  perc_full, xlist_max, xlist_cur, instructors,
                  tuition_code, bill_hrs, note_bottom, crse_equiv,
                  term_code, ptrm_code, start_date, end_date
                `)
                .eq('term_code', term)
                .order('row_number', { ascending: true })
                .range(from, from + PAGE_SIZE - 1)

              if (error || !data) {
                console.error('Error fetching classes for term', term, error)
                setFetchError(true)
                hasError = true
                break
              }
              rows.push(...data)
              if (data.length < PAGE_SIZE) break
              from += PAGE_SIZE
            }

            if (hasError) return

            if (rows.length > 0) {
              const upper = rows.map((c: any) => {
                const u: Record<string, unknown> = {}
                for (const key in c) u[key.toUpperCase()] = c[key]
                return u as unknown as CourseSection
              })
              termCache.set(term, { data: upper, fetchedAt: Date.now() })
            }
          })
        )
      }

      const allClasses = terms.flatMap(t => termCache.get(t)?.data ?? [])
      allClasses.sort((a, b) => {
        const subj = (a.SUBJ_CODE || '').localeCompare(b.SUBJ_CODE || '')
        if (subj !== 0) return subj
        const crse = (a.CRSE_NUMB || '').localeCompare(b.CRSE_NUMB || '')
        if (crse !== 0) return crse
        const term = (a.TERM_CODE || '').localeCompare(b.TERM_CODE || '')
        if (term !== 0) return term
        return (a.ROW_NUMBER || 0) - (b.ROW_NUMBER || 0)
      })
      setClasses(allClasses)

      const { data: meta } = await supabase
        .from('metadata')
        .select('value')
        .eq('key', 'last_updated')
        .single()
      if (meta?.value) setLastRefreshed(meta.value)

      setSelectedClasses(prev => {
        if (prev.length === 0) return prev
        const crnSet = new Set(allClasses.map((c: CourseSection) => `${c.CRN}-${c.SEQ_NUMB}`))
        const valid = prev.filter((c: CourseSection) => crnSet.has(`${c.CRN}-${c.SEQ_NUMB}`))
        return valid.length === prev.length ? prev : valid
      })

      setLoading(false)
    }
    getClasses()
  }, [termFilter, setSelectedClasses])

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
          const dayVals = splitByBr(cls[dayKey as keyof CourseSection] as string)
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
        // Courses in different semesters can never conflict
        if (a.cls.TERM_CODE !== b.cls.TERM_CODE) continue
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

  // Detect courses where 2+ sections of the same type (e.g. two LEC sections) are selected
  const duplicateCourses = useMemo(() => {
    const counts = new Map<string, number>()
    selectedClasses.forEach(cls => {
      const key = `${cls.SUBJ_CODE} ${cls.CRSE_NUMB} ${cls.SCHD_TYPE || 'Lec'}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    })
    const dupes = new Set<string>()
    counts.forEach((count, key) => { if (count > 1) dupes.add(key) })
    return dupes
  }, [selectedClasses])

  const incompatibleLinks = useMemo(() => {
    const invalid = new Set<string>()

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

    classes.forEach(cls => {
      if (!cls.LINK_CONN || !cls.SCHD_CODE) return
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

  const missingLinks = useMemo(() => {
    const missing = new Map<string, string[]>()

    const selectedByCourse = new Map<string, CourseSection[]>()
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

  const totalCredits = useMemo(
    () => selectedClasses.reduce((sum, cls) => sum + (Number(cls.CREDIT_HRS) || 0), 0),
    [selectedClasses]
  )

  return (
    <div className="app-container">
      <AppHeader
        appState={appState}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        createWorkspace={createWorkspace}
        switchWorkspace={switchWorkspace}
        deleteWorkspace={deleteWorkspace}
        renameWorkspace={renameWorkspace}
        selectedCount={selectedClasses.length}
        totalCredits={totalCredits}
        conflictCount={conflicts.size}
        missingLinkCount={missingLinks.size}
      />

      <div className="disclaimer-banner">
        <span>
          This is an unofficial, student-built tool. It is not affiliated with, endorsed by, or
          operated by Dalhousie University. Always confirm your schedule through Dal's official
          registration system.
        </span>
      </div>

      <div className="mobile-warning">
        <span>⚠️ This tool is designed for desktop. Mobile experience may be limited — some features work best on a larger screen.</span>
      </div>

      {envError ? (
        <main className="main-content env-error-container">
          <h2 className="env-error-title">Missing Environment Variables</h2>
          <p className="env-error-body">
            It looks like this application is missing its Supabase environment variables. If you just deployed this to Vercel, navigate to <b>Settings &gt; Environment Variables</b> and ensure <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY</code> are correctly entered.
          </p>
        </main>
      ) : (
        <>
          {activeTab === 'browse' && (
            <BrowseTab
              classes={classes}
              loading={loading}
              fetchError={fetchError}
              selectedClasses={selectedClasses}
              conflicts={conflicts}
              duplicateCourses={duplicateCourses}
              incompatibleLinks={incompatibleLinks}
              missingLinks={missingLinks}
              totalCredits={totalCredits}
              toggleClassSelection={toggleClassSelection}
              setActiveTab={setActiveTab}
              termFilter={termFilter}
              toggleTerm={toggleTerm}
              lastRefreshed={lastRefreshed}
            />
          )}
          {activeTab === 'schedule' && (
            <ScheduleTab
              selectedClasses={selectedClasses}
              conflicts={conflicts}
              duplicateCourses={duplicateCourses}
              missingLinks={missingLinks}
              totalCredits={totalCredits}
              toggleClassSelection={toggleClassSelection}
              setActiveTab={setActiveTab}
              workspaceName={activeWorkspace.name}
            />
          )}
        </>
      )}

      <footer className="site-footer">
        <span>
          Not affiliated with Dalhousie University. For planning purposes only. Course data may not be current.
          For official course information, visit{' '}
          <a href="https://www.dal.ca" target="_blank" rel="noopener noreferrer">dal.ca</a>.
        </span>
        <button className="footer-about-link" onClick={() => { track('about_modal_opened'); setShowAbout(true) }}>About</button>
      </footer>

      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}
    </div>
  )
}

export default App
