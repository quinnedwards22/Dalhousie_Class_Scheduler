// ── Export utilities ───────────────────────────────────────────
// Pure functions for exporting selected classes in four formats.
// No React imports — safe to use anywhere.

import { splitByBr, parseTimes } from './classUtils'

// ── Term date lookup ──────────────────────────────────────────
// Maps Dalhousie term codes to their actual start/end dates.
// Pattern: YYYY10 = Winter (Jan–Apr), YYYY20 = Summer (May–Aug),
//          YYYY30 = Fall (Sep–Dec).
// DTSTART in ICS uses the first actual class day of the term.
const TERM_DATES: Record<string, { start: string; end: string }> = {
  // 2025
  '202510': { start: '2025-01-06', end: '2025-04-11' },
  '202520': { start: '2025-05-06', end: '2025-08-08' },
  '202530': { start: '2025-09-03', end: '2025-12-05' },
  // 2026
  '202610': { start: '2026-01-05', end: '2026-04-10' },
  '202620': { start: '2026-05-05', end: '2026-08-07' },
  '202630': { start: '2026-09-02', end: '2026-12-04' },
  // 2027
  '202710': { start: '2027-01-04', end: '2027-04-09' },
  '202720': { start: '2027-05-04', end: '2027-08-06' },
  '202730': { start: '2027-09-01', end: '2027-12-03' },
}

// ── ICS helpers ───────────────────────────────────────────────

// Day-column name → iCal BYDAY token and 0-indexed offset from Monday
const ICS_DAY: Record<string, { byday: string; offset: number }> = {
  MONDAYS:    { byday: 'MO', offset: 0 },
  TUESDAYS:   { byday: 'TU', offset: 1 },
  WEDNESDAYS: { byday: 'WE', offset: 2 },
  THURSDAYS:  { byday: 'TH', offset: 3 },
  FRIDAYS:    { byday: 'FR', offset: 4 },
  SATURDAYS:  { byday: 'SA', offset: 5 },
  SUNDAYS:    { byday: 'SU', offset: 6 },
}

/** Add `n` days to an ISO date string, returning a new ISO date string. */
function addDays(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Return the 0-indexed day-of-week (Mon=0 … Sun=6) for an ISO date. */
function dowMon0(isoDate: string): number {
  const d = new Date(`${isoDate}T00:00:00Z`)
  return (d.getUTCDay() + 6) % 7  // Sun=0 in JS → shift so Mon=0
}

/** Format "YYYY-MM-DD" + "HH:MM" into an iCal local datetime "YYYYMMDDTHHMMSS". */
function toIcsLocal(isoDate: string, time: string): string {
  const date = isoDate.replace(/-/g, '')
  const t = time.replace(':', '') + '00'
  return `${date}T${t}`
}

/** Format "YYYY-MM-DD" as iCal UTC end-of-day "YYYYMMDDTHHMMSSZ". */
function toIcsUntil(isoDate: string): string {
  return `${isoDate.replace(/-/g, '')}T235959Z`
}

/** Wrap long lines at 75 octets per RFC 5545 §3.1. */
function foldLine(line: string): string {
  const MAX = 75
  if (line.length <= MAX) return line
  let out = ''
  let pos = 0
  while (pos < line.length) {
    if (pos === 0) {
      out += line.slice(0, MAX)
      pos = MAX
    } else {
      out += '\r\n ' + line.slice(pos, pos + MAX - 1)
      pos += MAX - 1
    }
  }
  return out
}

// ── triggerDownload ────────────────────────────────────────────

function triggerDownload(content: string | Blob, filename: string, mimeType?: string) {
  const blob = typeof content === 'string'
    ? new Blob([content], { type: mimeType || 'text/plain' })
    : content
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── exportICS ─────────────────────────────────────────────────

/**
 * Generates and downloads a .ics file with one VEVENT per
 * unique (section × time-slot group), with weekly RRULE recurrence
 * through the semester.
 */
export function exportICS(selectedClasses: any[], workspaceName: string) {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//DAL Planner//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${workspaceName || 'My Schedule'}`,
  ]

  for (const cls of selectedClasses) {
    const termDates = TERM_DATES[cls.TERM_CODE]
    const termStart = termDates?.start ?? '2026-02-16'  // fallback to reference week Mon
    const termEnd   = termDates?.end   ?? '2026-02-20'

    const timesArr = splitByBr(cls.TIMES)
    const validTimes = timesArr.filter((t: string) => t.includes('-'))

    if (validTimes.length === 0) {
      // Async / TBA — emit a single all-day event
      lines.push(
        'BEGIN:VEVENT',
        foldLine(`UID:async-${cls.CRN}-${cls.SEQ_NUMB}@dal-planner`),
        `DTSTART;VALUE=DATE:${termStart.replace(/-/g, '')}`,
        `DTEND;VALUE=DATE:${termStart.replace(/-/g, '')}`,
        foldLine(`SUMMARY:${cls.SUBJ_CODE} ${cls.CRSE_NUMB} (${cls.SCHD_TYPE || 'Lec'}) — Async/TBA`),
        foldLine(`DESCRIPTION:${cls.CRSE_TITLE || ''}\\nSection ${cls.SEQ_NUMB} | CRN ${cls.CRN}\\nNo fixed schedule`),
        'END:VEVENT',
      )
      continue
    }

    // Parse all day arrays in parallel with timesArr
    const dayColumns: Record<string, string[]> = {
      MONDAYS:    splitByBr(cls.MONDAYS),
      TUESDAYS:   splitByBr(cls.TUESDAYS),
      WEDNESDAYS: splitByBr(cls.WEDNESDAYS),
      THURSDAYS:  splitByBr(cls.THURSDAYS),
      FRIDAYS:    splitByBr(cls.FRIDAYS),
      SATURDAYS:  splitByBr(cls.SATURDAYS),
      SUNDAYS:    splitByBr(cls.SUNDAYS),
    }
    const locsArr = splitByBr(cls.LOCATIONS)

    // Group slots by time range so MWF at the same time → one VEVENT with BYDAY=MO,WE,FR
    // key: "HH:MM|HH:MM"  value: { days: string[], location: string }
    const groups = new Map<string, { days: string[]; location: string; slotIdx: number }>()

    timesArr.forEach((timeStr: string, idx: number) => {
      const times = parseTimes(timeStr)
      if (!times) return
      const key = `${times.start}|${times.end}`

      const activeDays: string[] = []
      for (const [dayKey, arr] of Object.entries(dayColumns)) {
        const val = arr[idx]
        if (val && val.trim() !== '') activeDays.push(dayKey)
      }
      if (activeDays.length === 0) return

      const rawLoc = locsArr[idx] || locsArr[0] || ''
      const cleanLoc = rawLoc.replace(/<[^>]*>/g, '').trim()

      if (groups.has(key)) {
        // Merge days into existing group
        const existing = groups.get(key)!
        for (const d of activeDays) {
          if (!existing.days.includes(d)) existing.days.push(d)
        }
      } else {
        groups.set(key, { days: activeDays, location: cleanLoc, slotIdx: idx })
      }
    })

    // Emit one VEVENT per group
    let groupIdx = 0
    for (const [key, { days, location }] of groups) {
      const [startTime, endTime] = key.split('|')

      // Find the first occurrence of any meeting day on or after term start
      // We want the earliest calendar date ≥ termStart that lands on one of the meeting days
      const termStartDow = dowMon0(termStart)  // 0=Mon … 6=Sun
      let firstDate = termStart
      let minOffset = 7

      for (const dayKey of days) {
        const { offset } = ICS_DAY[dayKey]
        let diff = offset - termStartDow
        if (diff < 0) diff += 7
        if (diff < minOffset) {
          minOffset = diff
          firstDate = addDays(termStart, diff)
        }
      }

      const byDay = days
        .sort((a, b) => ICS_DAY[a].offset - ICS_DAY[b].offset)
        .map(d => ICS_DAY[d].byday)
        .join(',')

      lines.push(
        'BEGIN:VEVENT',
        foldLine(`UID:${cls.CRN}-${cls.SEQ_NUMB}-g${groupIdx}@dal-planner`),
        `DTSTART;TZID=America/Halifax:${toIcsLocal(firstDate, startTime)}`,
        `DTEND;TZID=America/Halifax:${toIcsLocal(firstDate, endTime)}`,
        foldLine(`RRULE:FREQ=WEEKLY;BYDAY=${byDay};UNTIL=${toIcsUntil(termEnd)}`),
        foldLine(`SUMMARY:${cls.SUBJ_CODE} ${cls.CRSE_NUMB} (${cls.SCHD_TYPE || 'Lec'})`),
        foldLine(`DESCRIPTION:${cls.CRSE_TITLE || ''}\\nSection ${cls.SEQ_NUMB} | CRN ${cls.CRN}`),
        ...(location ? [foldLine(`LOCATION:${location}`)] : []),
        'END:VEVENT',
      )
      groupIdx++
    }
  }

  lines.push('END:VCALENDAR')
  const ics = lines.join('\r\n') + '\r\n'
  triggerDownload(ics, `${workspaceName || 'schedule'}.ics`, 'text/calendar;charset=utf-8')
}

// ── exportCSV ─────────────────────────────────────────────────

const CSV_HEADERS = ['Subject', 'Course #', 'Title', 'Section', 'CRN', 'Type', 'Credits', 'Days', 'Times', 'Location']

function csvEscape(val: string | number | undefined | null): string {
  const s = String(val ?? '')
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

/** Derives a human-readable days string like "MWF" from the day columns. */
function parseDays(cls: any): string {
  const DAY_LETTERS: [string, string][] = [
    ['MONDAYS', 'M'], ['TUESDAYS', 'T'], ['WEDNESDAYS', 'W'],
    ['THURSDAYS', 'R'], ['FRIDAYS', 'F'], ['SATURDAYS', 'S'], ['SUNDAYS', 'U'],
  ]
  const result: string[] = []
  for (const [col, letter] of DAY_LETTERS) {
    const vals = splitByBr(cls[col])
    if (vals.some((v: string) => v.trim() !== '')) result.push(letter)
  }
  return result.join('')
}

/** Formats TIMES from "HHMM-HHMM<br>..." to "HH:MM–HH:MM, ..." */
function formatTimes(timesStr: string): string {
  return splitByBr(timesStr)
    .map((t: string) => {
      const parsed = parseTimes(t)
      return parsed ? `${parsed.start}–${parsed.end}` : t
    })
    .filter(Boolean)
    .join(', ')
}

/**
 * Generates and downloads a .csv file listing all selected classes
 * with their schedule details.
 */
export function exportCSV(selectedClasses: any[]) {
  const rows = [CSV_HEADERS.map(csvEscape).join(',')]

  for (const cls of selectedClasses) {
    const location = splitByBr(cls.LOCATIONS)
      .map((l: string) => l.replace(/<[^>]*>/g, '').trim())
      .filter(Boolean)
      .join('; ')

    const row = [
      cls.SUBJ_CODE,
      cls.CRSE_NUMB,
      cls.CRSE_TITLE,
      cls.SEQ_NUMB,
      cls.CRN,
      cls.SCHD_TYPE,
      cls.CREDIT_HRS,
      parseDays(cls),
      formatTimes(cls.TIMES),
      location,
    ].map(csvEscape).join(',')
    rows.push(row)
  }

  triggerDownload(rows.join('\n'), 'schedule.csv', 'text/csv;charset=utf-8')
}

// ── exportPNG ─────────────────────────────────────────────────

/**
 * Captures the given DOM element as a PNG and triggers a download.
 */
export async function exportPNG(element: HTMLElement) {
  const { default: html2canvas } = await import('html2canvas')
  const canvas = await html2canvas(element, { scale: 2, useCORS: true, backgroundColor: '#ffffff' })
  canvas.toBlob(blob => {
    if (blob) triggerDownload(blob, 'schedule.png', 'image/png')
  }, 'image/png')
}

// ── exportPDF ─────────────────────────────────────────────────

/**
 * Captures the given DOM element and saves it as a PDF.
 * The page is sized to match the element (landscape if wider than tall).
 */
export async function exportPDF(element: HTMLElement, workspaceName: string) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ])
  const canvas = await html2canvas(element, { scale: 2, useCORS: true, backgroundColor: '#ffffff' })
  const imgData = canvas.toDataURL('image/png')

  const imgW = canvas.width
  const imgH = canvas.height
  const orientation = imgW > imgH ? 'l' : 'p'
  const pdf = new jsPDF({ orientation, unit: 'px', format: [imgW, imgH] })
  pdf.addImage(imgData, 'PNG', 0, 0, imgW, imgH)
  pdf.save(`${workspaceName || 'schedule'}.pdf`)
}
