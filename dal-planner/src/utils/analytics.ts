import posthog from 'posthog-js'

// Thin wrapper around posthog.capture for type-safe, centralized event tracking.
// All event names use snake_case to match PostHog conventions.

export function track(event: string, properties?: Record<string, unknown>) {
  posthog.capture(event, properties)
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
