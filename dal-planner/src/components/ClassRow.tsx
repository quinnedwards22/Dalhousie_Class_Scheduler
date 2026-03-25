// ── ClassRow ───────────────────────────────────────────────────
// Renders one section of a course as one or more <tr> elements inside
// the class table. Each section can produce up to four rows:
//   1. Main data row  (always present)
//   2. Missing-link warning row  (when a required companion is absent)
//   3. Time-conflict detail row  (when times overlap with another selection)
//   4. Bottom-note row  (when NOTE_BOTTOM is non-empty)
//
// Wrapped in React.memo — row only re-renders when its own props change.
// This is the biggest render-performance win in the application: toggling
// one class's selection now only repaints the rows affected by conflicts
// or link changes, not every visible row.

import React, { useMemo } from 'react'
import type { CourseSection } from '../types'
import { splitByBr, rowTypeClass, parseEnrollmentGroups } from '../utils/classUtils'

type ClassRowProps = {
  cls: CourseSection              // raw class object from Supabase (UPPER_CASE keys)
  isSelected: boolean
  hasConflict: boolean
  conflictList?: string[]       // names of conflicting sections
  isInvalidLink: boolean        // true if adding this section would break a link constraint
  hasMissingLink: boolean       // true if this selected section is missing a required companion
  missingLinkTokens?: string[]  // e.g. ["B0", "T0"] — which companion types are still needed
  isDuplicate: boolean          // true when 2+ sections of same SUBJ+CRSE+SCHD_TYPE are selected
  searchQuery: string           // current search text, used to highlight CRN matches
  onToggle: (cls: CourseSection) => void
  onShowRestrictions: (crn: string, cls: CourseSection) => void
}

/**
 * Wraps matched portions of `text` in <mark> elements for search highlighting.
 * Escapes the query string before using it as a regex to avoid injection.
 * Returns the original string unchanged if there's no query or no match.
 */
function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query.trim() || !text) return text
  const q = query.trim()
  const regex = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
  const parts = text.split(regex)
  if (parts.length === 1) return text
  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? <mark key={`${i}-${part}`} className="search-highlight">{part}</mark> : part
      )}
    </>
  )
}

const ClassRow = React.memo(function ClassRow({
  cls,
  isSelected,
  hasConflict,
  conflictList,
  isInvalidLink,
  hasMissingLink,
  missingLinkTokens,
  isDuplicate,
  searchQuery,
  onToggle,
  onShowRestrictions,
}: ClassRowProps) {
  const noteVal = (cls.NOTE_ROW || '').trim()      // short inline note shown in the first column
  const noteBottom = (cls.NOTE_BOTTOM || '').trim() // multi-line note shown in a sub-row below

  // Memoize CRN highlight so it doesn't re-run on every render
  const crnText = useMemo(() => highlightMatch(String(cls.CRN ?? ''), searchQuery), [cls.CRN, searchQuery])

  // Parse enrollment into one group per <br>-delimited segment
  const enrollGroups = useMemo(
    () => parseEnrollmentGroups(cls.MAX_ENRL, cls.ENRL, cls.SEATS, cls.WLIST),
    [cls.MAX_ENRL, cls.ENRL, cls.SEATS, cls.WLIST],
  )

  // A section is waitlisted when the first (general) group is full but has a waitlist
  const isWlist = enrollGroups.length > 0 && enrollGroups[0].seats <= 0 && enrollGroups[0].wlist > 0

  // Compose the row's CSS class string from all applicable states
  const rowClass = [
    isSelected ? 'row-selected' : '',
    rowTypeClass(cls.SCHD_TYPE),               // row-lec or row-lab based on type
    hasConflict ? 'row-conflict' : '',
    isDuplicate ? 'row-duplicate' : '',
    cls.TIMES === 'C/D' ? 'row-dimmed' : '',   // C/D = "course/department" — no set schedule
    isInvalidLink ? 'row-incompatible' : '',
    noteBottom ? 'row-has-note' : '',
  ].filter(Boolean).join(' ')

  return (
    <React.Fragment>
      {/* ── Main data row ── */}
      <tr className={rowClass}>
        <td className="cell-note">
          {noteVal.includes('R') ? (
            <>
              {noteVal.replace(/R/g, '')}
              <button
                className="restriction-badge"
                onClick={(e) => { e.stopPropagation(); onShowRestrictions(String(cls.CRN), cls) }}
                title="View restrictions"
              >R</button>
            </>
          ) : noteVal}
        </td>

        {/* Selection checkbox — disabled and titled when the link constraint blocks it */}
        <td className="cell-select">
          <label
            className={`select-label ${isWlist ? 'is-wlist' : ''}`}
            title={isInvalidLink ? 'Link combo incompatible' : (isWlist ? 'Full - Join Waitlist' : 'Select Class')}
          >
            <input
              type="checkbox"
              checked={isSelected}
              disabled={isInvalidLink}
              onChange={() => onToggle(cls)}
            />
            {isWlist && !isInvalidLink && <span className="wlist-badge">Waitlist</span>}
          </label>
        </td>

        <td>{crnText}</td>
        <td>{cls.SEQ_NUMB}</td>
        <td>{cls.SCHD_TYPE || 'Lec'}</td>
        <td>{cls.CREDIT_HRS}</td>
        <td className="cell-narrow">{cls.LINK_CONN}</td>

        {/* Day columns (Mon–Fri) — each cell can have multiple sub-rows
            when a section meets at different times on the same day */}
        <td>
          {splitByBr(cls.MONDAYS).map((val, i) => (
            <div key={`mon-${i}`} className={`sub-row ${val?.trim() ? 'day-active' : 'day-empty'}`}>{val}</div>
          ))}
        </td>
        <td>
          {splitByBr(cls.TUESDAYS).map((val, i) => (
            <div key={`tue-${i}`} className={`sub-row ${val?.trim() ? 'day-active' : 'day-empty'}`}>{val}</div>
          ))}
        </td>
        <td>
          {splitByBr(cls.WEDNESDAYS).map((val, i) => (
            <div key={`wed-${i}`} className={`sub-row ${val?.trim() ? 'day-active' : 'day-empty'}`}>{val}</div>
          ))}
        </td>
        <td>
          {splitByBr(cls.THURSDAYS).map((val, i) => (
            <div key={`thu-${i}`} className={`sub-row ${val?.trim() ? 'day-active' : 'day-empty'}`}>{val}</div>
          ))}
        </td>
        <td>
          {splitByBr(cls.FRIDAYS).map((val, i) => (
            <div key={`fri-${i}`} className={`sub-row ${val?.trim() ? 'day-active' : 'day-empty'}`}>{val}</div>
          ))}
        </td>

        <td className="cell-times">
          {splitByBr(cls.TIMES).map((t, i) => <div key={`time-${i}`} className="sub-row">{t}</div>)}
        </td>
        <td className="cell-location">
          {splitByBr(cls.LOCATIONS).map((l, i) => <div key={`loc-${i}`} className="sub-row" dangerouslySetInnerHTML={{ __html: l }} />)}
        </td>

        {/* Availability cell — one sub-row per enrollment group.
            Multi-group rows (e.g. OPEN / DISP / MEDS) each get their own
            label, seat count, and colour-coded progress bar.
            Red ≥ 95% full, amber ≥ 80% full, green otherwise. */}
        <td className="cell-avail">
          {enrollGroups.map((g, i) => {
            const pct = g.max > 0 ? (g.enrl / g.max) * 100 : 0
            return (
              <div key={i} className="avail-wrapper">
                {g.label && <div className="avail-group-label">{g.label}</div>}
                {g.seats <= 0 && g.wlist > 0 ? (
                  <>
                    <div className="avail-text wlist-text">Full — WL: {g.wlist}</div>
                    <div className="avail-bar-bg"><div className="avail-bar-fill wlist-fill" style={{ width: '100%' }} /></div>
                  </>
                ) : (
                  <>
                    <div className="avail-text">{Math.max(0, g.seats)} seats ({g.enrl}/{g.max})</div>
                    <div className="avail-bar-bg">
                      <div
                        className="avail-bar-fill"
                        style={{
                          width: `${Math.min(100, pct)}%`,
                          backgroundColor: pct >= 95 ? '#dc2626' : pct >= 80 ? '#d97706' : '#16a34a',
                        }}
                      />
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </td>

        <td className="cell-instructor">
          {splitByBr(cls.INSTRUCTORS).map((inst, i) => <div key={`inst-${i}`} className="sub-row">{inst}</div>)}
        </td>
      </tr>

      {/* ── Missing-link warning row — only for selected sections ── */}
      {hasMissingLink && (
        <tr className="row-conflict-detail" style={{ backgroundColor: '#fef08a' }}>
          <td className="cell-note"></td>
          <td colSpan={15} className="conflict-detail-text" style={{ color: '#854d0e' }}>
            Requires a linked section: {missingLinkTokens?.join(', ')}
          </td>
        </tr>
      )}

      {/* ── Duplicate warning row — only for selected sections ── */}
      {isDuplicate && (
        <tr className="row-conflict-detail" style={{ backgroundColor: '#fef08a' }}>
          <td className="cell-note"></td>
          <td colSpan={15} className="conflict-detail-text" style={{ color: '#854d0e' }}>
            Multiple {cls.SCHD_TYPE || 'Lecture'} sections of {cls.SUBJ_CODE} {cls.CRSE_NUMB} selected.
          </td>
        </tr>
      )}

      {/* ── Conflict detail row — lists which other sections overlap ── */}
      {hasConflict && (
        <tr className="row-conflict-detail">
          <td className="cell-note"></td>
          <td colSpan={15} className="conflict-detail-text">Conflicts with {conflictList?.join(', ')}</td>
        </tr>
      )}

      {/* ── Bottom note row — free-text annotation from the registrar ── */}
      {noteBottom && (
        <tr className="row-note">
          <td className="cell-note cell-note-label">↳ NOTE</td>
          <td colSpan={18} className="cell-note-text">{noteBottom}</td>
        </tr>
      )}
    </React.Fragment>
  )
})

export default ClassRow
