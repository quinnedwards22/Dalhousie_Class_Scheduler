import posthog from 'posthog-js'

// Thin wrapper around posthog.capture for type-safe, centralized event tracking.
// All event names use snake_case to match PostHog conventions.

export function track(event: string, properties?: Record<string, unknown>) {
  posthog.capture(event, properties)
}
