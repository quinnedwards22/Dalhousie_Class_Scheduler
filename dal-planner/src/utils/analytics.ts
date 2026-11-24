import posthog from 'posthog-js'

// Thin wrapper around posthog.capture for type-safe, centralized event tracking.
// All event names use snake_case to match PostHog conventions.

// Per-page-load tally of every event sent through track(). It lives only in
// memory (nothing is stored in the browser) and feeds the session_summary
// event, which records what a visit amounted to when the tab is hidden.
const visitCounts: Record<string, number> = {}
const visitStartedAt = Date.now()

type TrackListener = (event: string, properties?: Record<string, unknown>) => void
const listeners = new Set<TrackListener>()

/** Run `listener` after every tracked event (e.g. to react to an export). Returns an unsubscribe. */
export function onTrack(listener: TrackListener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function track(event: string, properties?: Record<string, unknown>) {
  visitCounts[event] = (visitCounts[event] ?? 0) + 1
  posthog.capture(event, properties)
  listeners.forEach(l => l(event, properties))
}

/**
 * Reports an error the app caught and handled itself, so it still shows up in
 * PostHog error tracking. Uncaught errors are picked up by exception
 * autocapture; this covers the ones we swallow to keep the UI alive.
 * `source` names the place it came from, for grouping and filtering.
 */
export function captureError(error: unknown, source: string, properties?: Record<string, unknown>) {
  const err = error instanceof Error
    ? error
    : new Error(typeof error === 'object' && error && 'message' in error ? String(error.message) : String(error))
  posthog.captureException(err, { source, ...properties })
}

const count = (...events: string[]) => events.reduce((n, e) => n + (visitCounts[e] ?? 0), 0)

let summarySeq = 0

/**
 * Sends session_summary: what this visit amounted to so far. Called each time
 * the tab is hidden (switching to Dal's registration site, closing the tab),
 * so the latest one per session is the final state. `state` is the plan as it
 * stands now; the counts come from the events tracked during this page load.
 * Uses sendBeacon so it still goes out while the page is unloading.
 */
export function sendSessionSummary(state: Record<string, unknown>) {
  summarySeq += 1
  const tookToRegistration = count('crn_copied', 'crn_copied_all', 'schedule_exported') > 0
  posthog.capture('session_summary', {
    ...state,
    summary_seq: summarySeq,
    seconds_on_page: Math.round((Date.now() - visitStartedAt) / 1000),
    took_to_registration: tookToRegistration,
    searches: count('search_performed'),
    no_result_searches: count('search_no_results'),
    filter_changes: count('subject_filter_changed', 'type_filter_changed', 'day_filter_toggled',
      'seats_filter_toggled', 'hide_cd_filter_toggled', 'location_filter_toggled'),
    classes_added: count('class_selected'),
    classes_removed: count('class_deselected'),
    restrictions_viewed: count('restrictions_viewed'),
    exports: count('schedule_exported'),
    crn_copies: count('crn_copied', 'crn_copied_all'),
    pages_viewed: count('page_changed'),
    warnings_shown: count('schedule_warning_shown'),
    warnings_resolved: count('schedule_warning_resolved'),
  }, { transport: 'sendBeacon' })
}
