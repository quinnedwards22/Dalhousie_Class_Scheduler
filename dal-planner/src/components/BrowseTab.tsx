// ── BrowseTab ──────────────────────────────────────────────────
// The main class-browsing view. Owns all filter, search, and pagination
// state so that activity here doesn't cause App or ScheduleTab to re-render.
//
// Data pipeline (all memoized):
//   classes (prop) → filteredClasses → paginatedClasses → groupedClasses
//
// Layout:
//   Term & Location filters (top bar, triggers refetch on term change)
//   Search + secondary filters (subject, type, day, seats, C/D)
//   Active-filter chip bar
//   PaginationControls (top)
//   Class table (grouped by course, each section is a memoized ClassRow)
//   PaginationControls (bottom)
//   Mini-preview bar (sticky, visible when ≥1 class selected)

import React, { useState, useMemo, useCallback } from 'react'
import { splitByBr, DAY_LETTER_TO_KEY } from '../utils/classUtils'
import ClassRow from './ClassRow'
import PaginationControls from './PaginationControls'

type BrowseTabProps = {
  classes: any[]                        // full roster for the selected term(s)
  loading: boolean
  selectedClasses: any[]                // active workspace's selections
  conflicts: Map<string, string[]>      // CRN-SEQ → list of conflicting section names
  incompatibleLinks: Set<string>        // CRN-SEQ ids that can't be added due to link constraints
  missingLinks: Map<string, string[]>   // CRN-SEQ → unsatisfied link token strings
  totalCredits: number
  toggleClassSelection: (cls: any) => void
  setActiveTab: (tab: 'browse' | 'schedule') => void
  termFilter: Set<string>               // lives in App because changing it triggers a fetch
  toggleTerm: (term: string) => void
}

function BrowseTab({
  classes,
  loading,
  selectedClasses,
  conflicts,
  incompatibleLinks,
  missingLinks,
  totalCredits,
  toggleClassSelection,
  setActiveTab,
  termFilter,
  toggleTerm,
}: BrowseTabProps) {
  // ── Filter state ─────────────────────────────────────────────
  // All filter state is local to BrowseTab so that changing a filter
  // doesn't cause App or ScheduleTab to re-render.

  const [searchQuery, setSearchQuery] = useState('')
  const [subjectFilter, setSubjectFilter] = useState('')  // exact SUBJ_CODE match
  const [typeFilter, setTypeFilter] = useState('')         // lec | lab | tut
  const [dayFilter, setDayFilter] = useState<Set<string>>(new Set())  // M/T/W/R/F
  const [seatsAvailFilter, setSeatsAvailFilter] = useState(false)  // hide full sections
  const [hideCDFilter, setHideCDFilter] = useState(false)           // hide C/D-scheduled sections
  // Location defaults to all four categories selected (equivalent to "show all")
  const [locationFilter, setLocationFilter] = useState<Set<string>>(new Set(['Halifax', 'Truro', 'Online', 'Others']))
  const [currentPage, setCurrentPage] = useState(1)
  const [rowsPerPage, setRowsPerPage] = useState(20)

  // True when all four location categories are selected — used to skip the
  // per-class location check in filteredClasses for a small perf gain.
  const isLocAll = locationFilter.size === 4

  // Toggle all locations on/off; reset to page 1
  const toggleLocAll = useCallback(() => {
    setLocationFilter(isLocAll ? new Set() : new Set(['Halifax', 'Truro', 'Online', 'Others']))
    setCurrentPage(1)
  }, [isLocAll])

  const toggleLoc = useCallback((loc: string) => {
    setLocationFilter(prev => {
      const next = new Set(prev)
      next.has(loc) ? next.delete(loc) : next.add(loc)
      return next
    })
    setCurrentPage(1)
  }, [])

  const toggleDayFilter = useCallback((day: string) => {
    setDayFilter(prev => {
      const next = new Set(prev)
      next.has(day) ? next.delete(day) : next.add(day)
      return next
    })
    setCurrentPage(1)
  }, [])

  // Reset all secondary filters (search query and location are intentionally
  // excluded — they are separate UI controls with their own clear affordances)
  const clearFilters = useCallback(() => {
    setSubjectFilter('')
    setTypeFilter('')
    setDayFilter(new Set())
    setSeatsAvailFilter(false)
    setHideCDFilter(false)
    setCurrentPage(1)
  }, [])

  // ── Derived data ─────────────────────────────────────────────

  // Sorted list of every unique subject code in the roster; used to populate
  // the subject dropdown. Recomputes only when the roster changes.
  const uniqueSubjects = useMemo(() => {
    const subjects = new Set(classes.map(c => c.SUBJ_CODE).filter(Boolean))
    return Array.from(subjects).sort()
  }, [classes])

  // Apply all active filters in order. Each filter short-circuits early with
  // `return false` so subsequent filters are skipped for rejected classes.
  //
  // Order: search → subject → type → day → seats → C/D → location
  const filteredClasses = useMemo(() => {
    return classes.filter(cls => {
      // Full-text search across course title, code (e.g. "CSCI 2110"), and CRN
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const title = (cls.CRSE_TITLE || '').toLowerCase()
        const code = `${cls.SUBJ_CODE || ''} ${cls.CRSE_NUMB || ''}`.toLowerCase()
        const crn = String(cls.CRN || '').toLowerCase()
        if (!title.includes(q) && !code.includes(q) && !crn.includes(q)) return false
      }

      if (subjectFilter && cls.SUBJ_CODE !== subjectFilter) return false
      if (typeFilter && (cls.SCHD_TYPE || '').toLowerCase() !== typeFilter.toLowerCase()) return false

      // Day filter: a class passes if it meets on at least one of the selected days
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

      // Hide sections whose times field is exactly "C/D" (course/department-scheduled)
      if (hideCDFilter && (cls.TIMES || '').trim().toUpperCase() === 'C/D') return false

      // Location classification by building name patterns in the LOCATIONS field.
      // Skip entirely when all categories are selected (isLocAll) for performance.
      if (!isLocAll) {
        const loc = (cls.LOCATIONS || '').trim().toLowerCase()
        const isHalifax = /studley|carleton|sexton|king's/i.test(loc)
        const isTruro = /agricultural/i.test(loc)
        const isOnline = /online/i.test(loc)
        let matched = false
        if (locationFilter.has('Halifax') && isHalifax) matched = true
        if (locationFilter.has('Truro') && isTruro) matched = true
        if (locationFilter.has('Online') && isOnline) matched = true
        if (locationFilter.has('Others') && !isHalifax && !isTruro && !isOnline) matched = true
        if (!matched) return false
      }

      return true
    })
  }, [classes, searchQuery, subjectFilter, typeFilter, dayFilter, seatsAvailFilter, hideCDFilter, locationFilter, isLocAll])

  // Slice filteredClasses to only the rows for the current page
  const paginatedClasses = useMemo(() => {
    const startIdx = (currentPage - 1) * rowsPerPage
    return filteredClasses.slice(startIdx, startIdx + rowsPerPage)
  }, [filteredClasses, currentPage, rowsPerPage])

  // Group the current page's sections by course (SUBJ_CODE + CRSE_NUMB).
  // Each group gets one header row (course code, title, term info) followed
  // by one ClassRow per section. Groups preserve the order returned by Supabase.
  const groupedClasses = useMemo(() => {
    const groups: { key: string; code: string; title: string; termInfo: string; equiv: string; sections: any[] }[] = []
    const map = new Map<string, number>()  // course key → index in groups array
    paginatedClasses.forEach(cls => {
      const key = `${cls.SUBJ_CODE || ''}-${cls.CRSE_NUMB || ''}`
      if (!map.has(key)) {
        map.set(key, groups.length)
        const ptrm = cls.PTRM_CODE ? `(${cls.PTRM_CODE})` : ''
        const term = cls.TERM_CODE ? `(${cls.TERM_CODE})` : ''

        let termName = ''
        if (cls.TERM_CODE) {
          if (cls.TERM_CODE.endsWith('00')) termName = 'MEDICINE/DENTISTRY'
          else if (cls.TERM_CODE.endsWith('10')) termName = 'FALL'
          else if (cls.TERM_CODE.endsWith('20')) termName = 'WINTER'
          else if (cls.TERM_CODE.endsWith('30')) termName = 'SUMMER'
        }

        const dates = cls.START_DATE && cls.END_DATE ? `${cls.START_DATE} - ${cls.END_DATE}` : ''
        const termLabelPart = [term, termName, ptrm].filter(Boolean).join(' ')
        const termLabel = dates ? `${termLabelPart}: ${dates}` : termLabelPart

        groups.push({
          key,
          code: `${cls.SUBJ_CODE || ''} ${cls.CRSE_NUMB || ''}`,
          title: cls.CRSE_TITLE || '',
          termInfo: termLabel,
          equiv: cls.CRSE_EQUIV || '',  // cross-listed equivalent course code
          sections: [],
        })
      }
      groups[map.get(key)!].sections.push(cls)
    })
    return groups
  }, [paginatedClasses])

  // True when any secondary filter (not search/location) is active — controls
  // whether the "Clear Filters" button is shown
  const hasActiveFilters = subjectFilter || typeFilter || dayFilter.size > 0 || seatsAvailFilter || hideCDFilter

  // Human-readable labels for the active-filter chip bar
  const activeFilterLabels = useMemo(() => {
    const labels: string[] = []
    if (subjectFilter) labels.push(subjectFilter)
    if (typeFilter) labels.push(typeFilter.toUpperCase())
    if (dayFilter.size > 0) labels.push(Array.from(dayFilter).join(''))
    if (seatsAvailFilter) labels.push('Available')
    if (hideCDFilter) labels.push('No C/D')
    return labels
  }, [subjectFilter, typeFilter, dayFilter, seatsAvailFilter, hideCDFilter])

  return (
    <div className="tab-content browse-tab">
      {/* ── Top filters: Term & Location ── */}
      {/* Term checkboxes are passed up to App because toggling them triggers
          a Supabase re-fetch. Location checkboxes are local to BrowseTab. */}
      <div className="toolbar-top-filters">
        <div className="filter-group">
          <h3 className="filter-group-title">Terms:</h3>
          <div className="filter-checkboxes">
            <label className="filter-checkbox"><input type="checkbox" checked={termFilter.has('202600')} onChange={() => toggleTerm('202600')} /> (202600) 2025/2026 Medicine/Dentistry</label>
            <label className="filter-checkbox"><input type="checkbox" checked={termFilter.has('202610')} onChange={() => toggleTerm('202610')} /> (202610) 2025/2026 Fall</label>
            <label className="filter-checkbox"><input type="checkbox" checked={termFilter.has('202620')} onChange={() => toggleTerm('202620')} /> (202620) 2025/2026 Winter</label>
            <label className="filter-checkbox"><input type="checkbox" checked={termFilter.has('202630')} onChange={() => toggleTerm('202630')} /> (202630) 2025/2026 Summer</label>
          </div>
        </div>

        <div className="filter-group loc-group">
          <h3 className="filter-group-title">Locations:</h3>
          <div className="filter-checkboxes">
            <label className="filter-checkbox"><input type="checkbox" checked={isLocAll} onChange={toggleLocAll} /> All</label>
            <label className="filter-checkbox"><input type="checkbox" checked={locationFilter.has('Halifax')} onChange={() => toggleLoc('Halifax')} /> Halifax</label>
            <label className="filter-checkbox"><input type="checkbox" checked={locationFilter.has('Truro')} onChange={() => toggleLoc('Truro')} /> Truro</label>
            <label className="filter-checkbox"><input type="checkbox" checked={locationFilter.has('Online')} onChange={() => toggleLoc('Online')} /> Online</label>
            <label className="filter-checkbox"><input type="checkbox" checked={locationFilter.has('Others')} onChange={() => toggleLoc('Others')} /> Others</label>
          </div>
        </div>
      </div>

      {/* ── Secondary toolbar: Search + filter controls ── */}
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
              onChange={e => { setSearchQuery(e.target.value); setCurrentPage(1) }}
            />
            {searchQuery && (
              <button className="search-clear" onClick={() => { setSearchQuery(''); setCurrentPage(1) }} aria-label="Clear search">✕</button>
            )}
          </div>
          {/* Result count only appears while a search is active */}
          {searchQuery && (
            <span className="search-result-count">
              {filteredClasses.length} {filteredClasses.length === 1 ? 'result' : 'results'}
            </span>
          )}
        </div>
        <div className="toolbar-filter-row">
          <select value={subjectFilter} onChange={e => { setSubjectFilter(e.target.value); setCurrentPage(1) }} className="filter-select">
            <option value="">All Subjects</option>
            {uniqueSubjects.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setCurrentPage(1) }} className="filter-select">
            <option value="">All Types</option>
            <option value="lec">Lecture</option>
            <option value="lab">Lab</option>
            <option value="tut">Tutorial</option>
          </select>
          {/* Day toggles — multi-select; a class passes if it meets on any selected day */}
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
            onClick={() => { setSeatsAvailFilter(v => !v); setCurrentPage(1) }}
          >Available Only</button>
          <button
            className={`filter-toggle ${hideCDFilter ? 'active' : ''}`}
            onClick={() => { setHideCDFilter(v => !v); setCurrentPage(1) }}
          >Hide C/D</button>
          {hasActiveFilters && (
            <button className="filter-clear" onClick={clearFilters}>Clear Filters</button>
          )}
        </div>
      </div>

      {/* Active-filter chip bar — summary of what's currently filtered */}
      {activeFilterLabels.length > 0 && (
        <div className="active-filters-bar">
          <span className="active-filters-label">Filtering:</span>
          {activeFilterLabels.map((label) => (
            <span key={label} className="active-filter-tag">{label}</span>
          ))}
          {searchQuery && <span className="active-filter-tag">"{searchQuery}"</span>}
        </div>
      )}

      {/* Top pagination bar — hidden when no data has loaded */}
      {classes.length > 0 && (
        <PaginationControls
          currentPage={currentPage}
          rowsPerPage={rowsPerPage}
          totalCount={filteredClasses.length}
          onPageChange={setCurrentPage}
          onRowsPerPageChange={setRowsPerPage}
        />
      )}

      {/* ── Class table ── */}
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
                  {/* Course header row — spans all columns */}
                  <tr className="course-header">
                    <td colSpan={19}>
                      <div className="course-header-inner">
                        <span>
                          <span className="course-code">{group.code}</span>
                          <span className="course-title">{group.title}</span>
                          {group.equiv && <span className="course-equiv">Also offered as {group.equiv}</span>}
                        </span>
                        {group.termInfo && <span className="course-term">{group.termInfo}</span>}
                      </div>
                    </td>
                  </tr>
                  {/* One ClassRow per section in this course group */}
                  {group.sections.map(cls => {
                    const id = `${cls.CRN}-${cls.SEQ_NUMB}`
                    return (
                      <ClassRow
                        key={id}
                        cls={cls}
                        isSelected={selectedClasses.some(c => c.CRN === cls.CRN && c.SEQ_NUMB === cls.SEQ_NUMB)}
                        hasConflict={conflicts.has(id)}
                        conflictList={conflicts.get(id)}
                        isInvalidLink={incompatibleLinks.has(id)}
                        hasMissingLink={missingLinks.has(id)}
                        missingLinkTokens={missingLinks.get(id)}
                        searchQuery={searchQuery}
                        onToggle={toggleClassSelection}
                      />
                    )
                  })}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Bottom pagination bar */}
      {classes.length > 0 && (
        <PaginationControls
          currentPage={currentPage}
          rowsPerPage={rowsPerPage}
          totalCount={filteredClasses.length}
          onPageChange={setCurrentPage}
          onRowsPerPageChange={setRowsPerPage}
        />
      )}

      {/* ── Mini preview bar (sticky footer) ──────────────────── */}
      {/* Visible whenever at least one class is selected. Shows a summary
          of the current plan and chips for each selected section. The
          "View Schedule" CTA switches to the schedule tab. */}
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
            {selectedClasses.map(sc => (
              <span key={`${sc.CRN}-${sc.SEQ_NUMB}`} className="mini-chip">
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
  )
}

export default BrowseTab
