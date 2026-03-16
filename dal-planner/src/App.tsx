import { useEffect, useState, useCallback, useMemo } from 'react'
import './App.css'
import { supabase } from './utils/supabase'
import { splitByBr, parseTimes, timeToMinutes, parseLinkTokens, getLinkGroupNum } from './utils/classUtils'
import AppHeader from './components/AppHeader'
import BrowseTab from './components/BrowseTab'
import ScheduleTab from './components/ScheduleTab'
import AboutModal from './components/AboutModal'

// ── Types ──────────────────────────────────────────────────────

type Workspace = { id: string; name: string; classes: any[] }

// AppState holds all workspaces and tracks which one is active.
// This entire object is serialised to localStorage on every change.
type AppState = { activeWorkspaceId: string; workspaces: Workspace[] }

const defaultState: AppState = {
  activeWorkspaceId: '1',
  workspaces: [{ id: '1', name: 'Plan A', classes: [] }]
}

// Module-level cache: term_code → normalised class array.
// Lives for the browser session so toggling terms back doesn't re-fetch.
const termCache = new Map<string, any[]>()

// ── App ────────────────────────────────────────────────────────
//
// App is the root component and single source of truth for:
//   • All fetched class data (from Supabase)
//   • Workspace management (multiple saved plans)
//   • Which term(s) are being browsed
//   • Shared derived data: conflicts, link validation, total credits
//
// Browse/schedule-local state (filters, search, calendar) lives
// in the child tab components to keep re-renders isolated.

function App() {
  const [classes, setClasses] = useState<any[]>([])   // full class roster for the selected term(s)
  const [loading, setLoading] = useState(true)
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'browse' | 'schedule'>('browse')
  const [envError, setEnvError] = useState(false)
  const [showAbout, setShowAbout] = useState(false)
  const [bannerDismissed, setBannerDismissed] = useState(
    () => localStorage.getItem('dal-planner-banner-dismissed') === '1'
  )

  // termFilter drives the Supabase query; changing it triggers a re-fetch.
  // Restored from localStorage; defaults to empty (no terms selected).
  const [termFilter, setTermFilter] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('dal-planner-terms')
      if (stored) return new Set(JSON.parse(stored))
    } catch (_e) { }
    return new Set()
  })

  // ── Workspace state ──────────────────────────────────────────
  //
  // Workspaces let a student save multiple alternative schedules ("Plan A",
  // "Plan B", …) without losing either. Workspace data is stored in
  // localStorage under 'dal-planner-workspaces'.
  //
  // The initializer also handles migration from the old v1 format
  // ('dal-planner-selected'), which stored a flat array of classes.
  const [appState, setAppState] = useState<AppState>(() => {
    try {
      const storedV2 = localStorage.getItem('dal-planner-workspaces')
      if (storedV2) return JSON.parse(storedV2)

      // Migrate from v1: wrap the old flat class list in a single workspace
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

  // Resolve the currently active workspace object
  const activeWorkspace = useMemo(
    () => appState.workspaces.find(w => w.id === appState.activeWorkspaceId) || appState.workspaces[0],
    [appState]
  )
  const selectedClasses = activeWorkspace.classes

  // Update only the active workspace's class list without touching other workspaces.
  // Accepts either a new array or an updater function (same API as useState).
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

  // Persist the entire appState to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('dal-planner-workspaces', JSON.stringify(appState))
  }, [appState])

  // Persist selected terms to localStorage
  useEffect(() => {
    localStorage.setItem('dal-planner-terms', JSON.stringify(Array.from(termFilter)))
  }, [termFilter])

  // ── Workspace helpers ────────────────────────────────────────

  // Create a new workspace with an auto-generated name (Plan A, Plan B, …)
  // and immediately switch to it.
  const createWorkspace = useCallback(() => {
    setAppState(prev => {
      const newId = String(Date.now())
      const newName = `Plan ${String.fromCharCode(65 + prev.workspaces.length)}`
      return {
        activeWorkspaceId: newId,
        workspaces: [...prev.workspaces, { id: newId, name: newName, classes: [] }]
      }
    })
  }, [])

  const switchWorkspace = useCallback((id: string) => {
    setAppState(prev => ({ ...prev, activeWorkspaceId: id }))
  }, [])

  // Delete a workspace, falling back to the first remaining one.
  // Deletion is blocked when only one workspace exists.
  const deleteWorkspace = useCallback((id: string) => {
    setAppState(prev => {
      if (prev.workspaces.length <= 1) return prev
      const nextWorkspaces = prev.workspaces.filter(w => w.id !== id)
      const nextId = prev.activeWorkspaceId === id ? nextWorkspaces[0].id : prev.activeWorkspaceId
      return { activeWorkspaceId: nextId, workspaces: nextWorkspaces }
    })
  }, [])

  // Toggle a term code in/out of the active set; the fetch effect reacts automatically.
  const toggleTerm = useCallback((term: string) => {
    setTermFilter(prev => {
      const next = new Set(prev)
      next.has(term) ? next.delete(term) : next.add(term)
      return next
    })
  }, [])

  // Add a class to the active workspace if not already present; remove it if it is.
  const toggleClassSelection = useCallback((cls: any) => {
    setSelectedClasses(prev => {
      const isSelected = prev.some(c => c.CRN === cls.CRN && c.SEQ_NUMB === cls.SEQ_NUMB)
      if (isSelected) return prev.filter(c => !(c.CRN === cls.CRN && c.SEQ_NUMB === cls.SEQ_NUMB))
      return [...prev, cls]
    })
  }, [setSelectedClasses])

  // ── Env check ──────────────────────────────────────────────
  // Detect missing Supabase config early so we can show a helpful message
  // instead of a generic network error.
  useEffect(() => {
    if (!import.meta.env.VITE_SUPABASE_URL) {
      setEnvError(true)
      setLoading(false)
    }
  }, [])

  // ── Fetch data ─────────────────────────────────────────────
  // Re-runs whenever the term filter changes. Fetches all sections for the
  // selected term(s) and normalises every column name to UPPER_CASE so the
  // rest of the app can reference them consistently regardless of how
  // Supabase returns them.
  //
  // After a fetch, already-selected classes are validated against the new
  // roster and any that no longer exist (e.g. after switching terms) are
  // removed to avoid stale references.
  useEffect(() => {
    async function getClasses() {
      if (termFilter.size === 0) {
        setClasses([])
        setLoading(false)
        return
      }

      setLoading(true)

      const terms = Array.from(termFilter)
      const uncached = terms.filter(t => !termCache.has(t))

      if (uncached.length > 0) {
        // PostgREST enforces a server-side max_rows=1000 cap that .range() alone
        // cannot override. Paginate each term in parallel, 1000 rows per page,
        // until a short page signals the last chunk.
        const PAGE_SIZE = 1000

        await Promise.all(
          uncached.map(async term => {
            const rows: any[] = []
            let from = 0
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
                break
              }
              rows.push(...data)
              if (data.length < PAGE_SIZE) break
              from += PAGE_SIZE
            }

            if (rows.length > 0) {
              const upper = rows.map((c: any) => {
                const u: any = {}
                for (const key in c) u[key.toUpperCase()] = c[key]
                return u
              })
              termCache.set(term, upper)
            }
          })
        )
      }

      const allClasses = terms.flatMap(t => termCache.get(t) ?? [])
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

      // Fetch the last-updated timestamp from the metadata table
      const { data: meta } = await supabase
        .from('metadata')
        .select('value')
        .eq('key', 'last_updated')
        .single()
      if (meta?.value) setLastRefreshed(meta.value)

      // Prune selected classes that aren't in the new roster
      setSelectedClasses(prev => {
        if (prev.length === 0) return prev
        const crnSet = new Set(allClasses.map((c: any) => `${c.CRN}-${c.SEQ_NUMB}`))
        const valid = prev.filter((c: any) => crnSet.has(`${c.CRN}-${c.SEQ_NUMB}`))
        return valid.length === prev.length ? prev : valid
      })

      setLoading(false)
    }
    getClasses()
  }, [termFilter, setSelectedClasses])

  // ── Shared derived data ────────────────────────────────────
  //
  // These three memos are computed at App level because their results are
  // consumed by both AppHeader and the active tab component.

  // conflicts: maps each section's "CRN-SEQ" id to the names of sections
  // it overlaps with. Two sections conflict when they share a weekday and
  // their time ranges overlap (start < other.end && other.start < end).
  // O(n²) over selected classes — acceptable since selections are small.
  const conflicts = useMemo(() => {
    const conflictMap = new Map<string, string[]>()
    const dayKeys = ['SUNDAYS', 'MONDAYS', 'TUESDAYS', 'WEDNESDAYS', 'THURSDAYS', 'FRIDAYS', 'SATURDAYS']

    // Pre-compute time slots for each selected class
    const classSlots = selectedClasses.map(cls => {
      const timesArr = splitByBr(cls.TIMES)
      const slots: { day: string; start: number; end: number }[] = []
      timesArr.forEach((timeStr: string, idx: number) => {
        const times = parseTimes(timeStr)
        if (!times) return
        const startMin = timeToMinutes(times.start)
        const endMin = timeToMinutes(times.end)
        // Each time slot applies to whichever days the section meets at that index
        dayKeys.forEach(dayKey => {
          const dayVals = splitByBr(cls[dayKey])
          if (dayVals[idx]?.trim()) {
            slots.push({ day: dayKey, start: startMin, end: endMin })
          }
        })
      })
      return { cls, slots, id: `${cls.CRN}-${cls.SEQ_NUMB}` }
    })

    // Pairwise comparison — each pair checked once
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

  // incompatibleLinks: set of "CRN-SEQ" ids for sections that cannot be
  // added because a currently-selected section's LINK_CONN already locks
  // in a different group number for that section type.
  //
  // Example: if you have selected a lecture with LINK_CONN="B0" (requires
  // lab group 0), then lab sections with group number 1 are incompatible.
  //
  // Algorithm:
  //   1. Build a requirements map from selected classes: course → type → allowed groups
  //   2. For every unselected section in the full roster, check if it has a
  //      link group number that isn't in the allowed set for its type.
  const incompatibleLinks = useMemo(() => {
    const invalid = new Set<string>()

    // Step 1: collect which companion group numbers each selected class requires
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

    // Step 2: flag unselected sections whose group number doesn't match
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

  // missingLinks: maps each selected section's id to the list of LINK_CONN
  // tokens it still needs a companion for in the selected set.
  //
  // A token {prefix, num} is satisfied when another selected section in the
  // same course has SCHD_CODE === prefix AND the same group number.
  // If any tokens remain unsatisfied, a warning row is shown below the section.
  const missingLinks = useMemo(() => {
    const missing = new Map<string, string[]>()

    // Index selected classes by course for efficient companion lookup
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
      // Other selected sections in the same course (excluding self)
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

  // Sum of credit hours across all selected sections
  const totalCredits = useMemo(
    () => selectedClasses.reduce((sum, cls) => sum + (Number(cls.CREDIT_HRS) || 0), 0),
    [selectedClasses]
  )

  // ── Render ─────────────────────────────────────────────────

  const dismissBanner = useCallback(() => {
    setBannerDismissed(true)
    localStorage.setItem('dal-planner-banner-dismissed', '1')
  }, [])

  return (
    <div className="app-container">
      {/* AppHeader is memoized and only re-renders when its scalar props change */}
      <AppHeader
        appState={appState}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        createWorkspace={createWorkspace}
        switchWorkspace={switchWorkspace}
        deleteWorkspace={deleteWorkspace}
        selectedCount={selectedClasses.length}
        totalCredits={totalCredits}
        conflictCount={conflicts.size}
        missingLinkCount={missingLinks.size}
      />

      {/* Disclaimer banner — dismissable, persisted to localStorage */}
      {!bannerDismissed && (
        <div className="disclaimer-banner">
          <span>
            This is an unofficial, student-built tool. It is not affiliated with, endorsed by, or
            operated by Dalhousie University. Always confirm your schedule through Dal's official
            registration system.
          </span>
          <button className="disclaimer-dismiss" onClick={dismissBanner} aria-label="Dismiss">&times;</button>
        </div>
      )}

      {/* If Supabase env vars are missing, show a setup guide instead of the app */}
      {envError ? (
        <main className="main-content env-error-container">
          <h2 className="env-error-title">Missing Environment Variables</h2>
          <p className="env-error-body">
            It looks like this application is missing its Supabase environment variables. If you just deployed this to Vercel, navigate to <b>Settings &gt; Environment Variables</b> and ensure <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY</code> are correctly entered.
          </p>
        </main>
      ) : (
        <>
          {/* Only the active tab mounts; the inactive tab unmounts to keep
              its internal state (filters, scroll, calendar) from running idle */}
          {activeTab === 'browse' && (
            <BrowseTab
              classes={classes}
              loading={loading}
              selectedClasses={selectedClasses}
              conflicts={conflicts}
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
              totalCredits={totalCredits}
              toggleClassSelection={toggleClassSelection}
              setActiveTab={setActiveTab}
              workspaceName={activeWorkspace.name}
            />
          )}
        </>
      )}

      {/* Site footer — persistent on every page */}
      <footer className="site-footer">
        <span>
          DAL Planner is not affiliated with Dalhousie University. Course data may not be current.
          For official course information, visit{' '}
          <a href="https://www.dal.ca" target="_blank" rel="noopener noreferrer">dal.ca</a>.
        </span>
        <button className="footer-about-link" onClick={() => setShowAbout(true)}>About</button>
      </footer>

      {/* About modal */}
      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}
    </div>
  )
}

export default App
