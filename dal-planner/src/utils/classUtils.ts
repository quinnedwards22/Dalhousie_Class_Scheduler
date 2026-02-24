// ── Pure helpers & constants ──────────────────────────────────
// No React imports — safe to use from any component or in tests.

/**
 * Dalhousie's raw data encodes multi-value fields (e.g. a class meeting
 * on two days with two time slots) as HTML-style "<br>" delimiters.
 * This helper splits those values and trims whitespace from each part.
 */
export const splitByBr = (str: string | undefined | null): string[] => {
  if (!str) return []
  return str.split('<br>').map(s => s.trim())
}

/**
 * Parses a compact "HHMM-HHMM" time range string into { start, end }
 * objects with colon-formatted times (e.g. "08:35-09:55").
 * Returns null if the string is missing, malformed, or has no dash.
 */
export const parseTimes = (timeStr: string) => {
  if (!timeStr || !timeStr.includes('-')) return null
  const [startRaw, endRaw] = timeStr.split('-')
  if (!startRaw || !endRaw || startRaw.length !== 4 || endRaw.length !== 4) return null
  return {
    start: `${startRaw.substring(0, 2)}:${startRaw.substring(2, 4)}`,
    end: `${endRaw.substring(0, 2)}:${endRaw.substring(2, 4)}`,
  }
}

/**
 * Converts a "HH:MM" string to a total-minutes integer for arithmetic
 * comparisons in conflict detection.
 */
export const timeToMinutes = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

/**
 * Maps a schedule type code (SCHD_TYPE) to a CSS row class.
 * Lectures get a subtle highlight; labs and tutorials get a different one.
 * Returns '' for any unrecognized type.
 */
export const rowTypeClass = (schdType: string) => {
  if (!schdType) return ''
  const t = schdType.trim().toLowerCase()
  if (t === 'lec') return 'row-lec'
  if (t === 'lab' || t === 'tut') return 'row-lab'
  return ''
}

/**
 * Parses a LINK_CONN string like "B0, T0" into structured tokens.
 * Each token represents one required companion section type + group number.
 *
 * LINK_CONN encodes which other section types a student must also register
 * in. For example "B0, T0" means this section requires a lab (B) with
 * group number 0 AND a tutorial (T) with group number 0.
 *
 * prefix — the SCHD_CODE letter of the required companion (e.g. 'B' = lab)
 * num    — the group number; companion sections must share this number
 */
export const parseLinkTokens = (linkStr: string | null | undefined): { prefix: string; num: string }[] => {
  if (!linkStr) return []
  return linkStr.split(',').map(s => s.trim()).filter(Boolean).map(s => ({
    prefix: s.charAt(0),   // e.g. 'B' — the SCHD_CODE of the required companion
    num: s.substring(1),   // e.g. '0' — the group number that must match
  }))
}

/**
 * Returns the shared group number for a section's LINK_CONN string.
 * All tokens within a LINK_CONN reference the same group number, so
 * reading the first token's num is sufficient.
 * e.g. "L0, T0" → "0", "B1" → "1", null if no link.
 */
export const getLinkGroupNum = (linkStr: string | null | undefined): string | null => {
  const tokens = parseLinkTokens(linkStr)
  return tokens.length > 0 ? tokens[0].num : null
}

/**
 * 8-color palette used to visually distinguish courses on the calendar.
 * Each entry follows Schedule-X's color API: main (event background),
 * container (label background), onContainer (label text).
 * Colors cycle when more than 8 courses are selected.
 */
export const COLOR_PALETTE = [
  { main: '#1565c0', container: '#dbeafe', onContainer: '#0d47a1' },
  { main: '#2e7d32', container: '#dcfce7', onContainer: '#166534' },
  { main: '#e65100', container: '#ffedd5', onContainer: '#9a3412' },
  { main: '#7b1fa2', container: '#f3e8ff', onContainer: '#581c87' },
  { main: '#c62828', container: '#fee2e2', onContainer: '#991b1b' },
  { main: '#00838f', container: '#cffafe', onContainer: '#155e75' },
  { main: '#ef6c00', container: '#fff3e0', onContainer: '#e65100' },
  { main: '#ad1457', container: '#fce7f3', onContainer: '#9d174d' },
]

/**
 * Maps each day-of-week column name to:
 *  - letter: the single-character code used in day-filter toggles (M/T/W/R/F/S/U)
 *  - date: an arbitrary fixed Monday-week date used to anchor calendar events.
 *          Schedule-X renders a weekly view, so all events need concrete dates;
 *          the absolute date doesn't matter — only the day-of-week alignment does.
 */
export const DAY_CONFIG = {
  SUNDAYS: { letter: 'U', date: '2026-02-15' },
  MONDAYS: { letter: 'M', date: '2026-02-16' },
  TUESDAYS: { letter: 'T', date: '2026-02-17' },
  WEDNESDAYS: { letter: 'W', date: '2026-02-18' },
  THURSDAYS: { letter: 'R', date: '2026-02-19' },
  FRIDAYS: { letter: 'F', date: '2026-02-20' },
  SATURDAYS: { letter: 'S', date: '2026-02-21' },
} as const

/**
 * Reverse lookup from the single-character day-filter letter to the
 * corresponding database column name. Used when applying the day filter
 * to check whether a class meets on a given day.
 */
export const DAY_LETTER_TO_KEY: Record<string, string> = {
  U: 'SUNDAYS', M: 'MONDAYS', T: 'TUESDAYS', W: 'WEDNESDAYS', R: 'THURSDAYS', F: 'FRIDAYS', S: 'SATURDAYS',
}
