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
 * Represents a single enrollment group split from a <br>-delimited enrollment field.
 * Some classes have multiple enrollment caps for different student populations
 * (e.g. OPEN for general, DISP for display-only, MEDS for medical students).
 */
export type EnrollmentGroup = {
  label: string   // e.g. "OPEN", "DISP", "MEDS", or "" for plain numeric rows
  max: number
  enrl: number
  seats: number
  wlist: number
}

/**
 * Extracts the first numeric value from a field that may be a plain number,
 * a bare number string, or a <br>-delimited multi-value string (e.g. "30<br>40").
 * Used by filter logic that only needs a single representative value.
 */
export const firstNumericValue = (field: string | number | null | undefined): number => {
  if (field == null) return 0
  if (typeof field === 'number') return isNaN(field) ? 0 : field
  const first = field.split('<br>')[0].trim()
  const parenMatch = first.match(/\((\d+)\)/)
  if (parenMatch) return parseInt(parenMatch[1], 10) || 0
  return parseInt(first, 10) || 0
}

/**
 * Parses the four enrollment fields into an array of EnrollmentGroup objects,
 * one per <br>-delimited segment. Handles both legacy single-value rows and
 * multi-group rows where MAX_ENRL contains labels like "OPEN (30)<br> MEDS (30)".
 */
export const parseEnrollmentGroups = (
  maxEnrl: string | number | null,
  enrl: string | number | null,
  seats: string | number | null,
  wlist: string | number | null,
): EnrollmentGroup[] => {
  const toStr = (v: string | number | null) => (v == null ? '' : String(v))
  const maxParts = splitByBr(toStr(maxEnrl))
  if (maxParts.length === 0) return [{ label: '', max: 0, enrl: 0, seats: 0, wlist: 0 }]
  const enrlParts = splitByBr(toStr(enrl))
  const seatsParts = splitByBr(toStr(seats))
  const wlistParts = splitByBr(toStr(wlist))
  return maxParts.map((maxPart, i) => {
    const parenMatch = maxPart.match(/^(.*?)\s*\((\d+)\)\s*$/)
    const label = parenMatch ? parenMatch[1].trim() : ''
    const maxNum = parenMatch ? parseInt(parenMatch[2], 10) || 0 : parseInt(maxPart, 10) || 0
    return {
      label,
      max: maxNum,
      enrl: parseInt(enrlParts[i] ?? '0', 10) || 0,
      seats: parseInt(seatsParts[i] ?? '0', 10) || 0,
      wlist: parseInt(wlistParts[i] ?? '0', 10) || 0,
    }
  })
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
  if (t === 'lab') return 'row-lab'
  if (t === 'tut') return 'row-tut'
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
 * Converts a Dalhousie TERM_CODE (e.g. "202710") to a short human-readable
 * label like "Fall 2026/27". The last two digits encode the term type:
 *   10 = Fall, 20 = Winter, 30 = Summer, 00 = Medicine/Dentistry
 * The four-digit year prefix is the academic year's end year (e.g. 2027
 * for the 2026/27 academic year). Fall and Summer are displayed with
 * the straddling year range; Winter and Med/Dent use the single year.
 */
export const getTermLabel = (termCode: string): string => {
  if (!termCode || termCode.length < 6) return termCode || ''
  const yearStr = termCode.substring(0, 4)
  const suffix = termCode.substring(4)
  const endYear = parseInt(yearStr, 10)
  if (isNaN(endYear)) return termCode
  if (suffix === '10') return `Fall ${endYear - 1}/${String(endYear).slice(2)}`
  if (suffix === '20') return `Winter ${endYear - 1}/${String(endYear).slice(2)}`
  if (suffix === '30') return `Summer ${endYear - 1}/${String(endYear).slice(2)}`
  if (suffix === '00') return `Med/Dent ${endYear - 1}/${String(endYear).slice(2)}`
  return termCode
}

/**
 * Returns a short term name (e.g. "FALL", "WINTER") from a TERM_CODE.
 * Used in compact contexts like table columns.
 */
export const getTermShortName = (termCode: string): string => {
  if (!termCode) return ''
  if (termCode.endsWith('10')) return 'FALL'
  if (termCode.endsWith('20')) return 'WINTER'
  if (termCode.endsWith('30')) return 'SUMMER'
  if (termCode.endsWith('00')) return 'MED/DENT'
  return termCode
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
