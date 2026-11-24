import posthog from 'posthog-js'

// PostHog "api" surveys: PostHog stores the definitions and responses, and the
// app renders the UI itself. Ids must match the surveys in PostHog (Surveys →
// "Planner feedback" / "Did the planner help?"); responses are keyed by these
// question ids, so never change them without updating the survey.
//
// The app renders these on its own triggers (a button, a successful export)
// rather than asking PostHog which surveys to show: targeting needs a stable
// person, which cookieless tracking doesn't have.

export type ApiSurvey = {
  id: string
  questions: { id: string; question: string }[]
}

export const FEEDBACK_SURVEY = {
  id: '01a20bdc-ff66-0000-a5e9-23034423542e',
  questions: [
    { id: '5d010258-0aa5-4591-b4ce-15b9c84e0212', question: "What's this about?" },
    { id: '11296d16-5d64-46a1-8809-4019b98e1058', question: 'Tell us more' },
    { id: 'acba13af-f6ba-46c4-ab45-ef7913b4992b', question: 'Email (optional)' },
  ],
} as const satisfies ApiSurvey

export const FEEDBACK_TOPICS = ["Something's broken", 'Missing a feature', 'Wrong or outdated class data', 'General feedback'] as const

export const HELPFUL_SURVEY = {
  id: '01a20bdd-0220-0000-00be-20cc76ca2dda',
  questions: [
    { id: '7061ff9d-4310-408c-b239-c769c6775183', question: 'Did this help you build your schedule?' },
    { id: '8ba5766f-8a2e-4909-a18f-75a87705ab0c', question: 'Anything we could do better?' },
  ],
} as const satisfies ApiSurvey

// Both surveys have no iterations (current_iteration is null in PostHog)
const ITERATION = null

export const newSubmissionId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`

export function surveyShown(survey: ApiSurvey, extra?: Record<string, unknown>) {
  posthog.capture('survey shown', { $survey_id: survey.id, $survey_iteration: ITERATION, ...extra })
}

export function surveyDismissed(survey: ApiSurvey, extra?: Record<string, unknown>) {
  posthog.capture('survey dismissed', { $survey_id: survey.id, $survey_iteration: ITERATION, ...extra })
}

/**
 * Sends a response. `answers` maps question id → answer and must hold every
 * answer given so far: PostHog keeps the latest event per submission id, so
 * reuse one submissionId for the partial and final sends of a submission.
 * Unanswered questions are left out.
 */
export function surveySent(
  survey: ApiSurvey,
  answers: Record<string, string>,
  submissionId: string,
  completed: boolean,
  extra?: Record<string, unknown>,
) {
  const responses = Object.fromEntries(
    Object.entries(answers)
      .filter(([, v]) => v.trim() !== '')
      .map(([qid, v]) => [`$survey_response_${qid}`, v.trim()]),
  )
  posthog.capture('survey sent', {
    $survey_id: survey.id,
    $survey_iteration: ITERATION,
    $survey_submission_id: submissionId,
    $survey_completed: completed,
    $survey_questions: survey.questions.map(({ id, question }) => ({ id, question })),
    ...responses,
    ...extra,
  })
}
