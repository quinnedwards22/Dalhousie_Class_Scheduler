// Shared type representing a single class section after column-name normalisation.
// Every field matches the UPPER_CASE key produced by the fetch in App.tsx.

export interface CourseSection {
  ROW_NUMBER: number
  SUBJ_CODE: string
  CRSE_NUMB: string
  NOTE_ROW: string | null
  CRN: string
  SEQ_NUMB: string
  SCHD_TYPE: string
  SCHD_CODE: string
  CREDIT_HRS: number | null
  LINK_CONN: string | null
  MONDAYS: string | null
  TUESDAYS: string | null
  WEDNESDAYS: string | null
  THURSDAYS: string | null
  FRIDAYS: string | null
  SATURDAYS: string | null
  SUNDAYS: string | null
  CRSE_TITLE: string
  TIMES: string | null
  LOCATIONS: string | null
  MAX_ENRL: string | number | null
  ENRL: string | number | null
  SEATS: string | number | null
  WLIST: string | number | null
  PERC_FULL: number | null
  XLIST_MAX: number | null
  XLIST_CUR: number | null
  INSTRUCTORS: string | null
  TUITION_CODE: string | null
  BILL_HRS: number | null
  NOTE_BOTTOM: string | null
  CRSE_EQUIV: string | null
  TERM_CODE: string
  PTRM_CODE: string | null
  START_DATE: string | null
  END_DATE: string | null
}

export type Workspace = { id: string; name: string; classes: CourseSection[] }

export type AppState = { activeWorkspaceId: string; workspaces: Workspace[] }
