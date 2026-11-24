// ── FeedbackModal ─────────────────────────────────────────────
// The always-available feedback form (header "Feedback" button and footer
// link). Responses go to the "Planner feedback" survey in PostHog, alongside
// the visit's session recording.

import { useEffect, useRef, useState } from 'react'
import { FEEDBACK_SURVEY, FEEDBACK_TOPICS, newSubmissionId, surveyDismissed, surveySent, surveyShown } from '../utils/surveys'

type FeedbackModalProps = {
  onClose: () => void
  context: Record<string, unknown>   // where it was opened from, current tab, plan size
}

const [TOPIC_Q, DETAILS_Q, EMAIL_Q] = FEEDBACK_SURVEY.questions

function FeedbackModal({ onClose, context }: FeedbackModalProps) {
  const [topic, setTopic] = useState('')
  const [details, setDetails] = useState('')
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [submissionId] = useState(newSubmissionId)
  const contextRef = useRef(context)

  useEffect(() => { surveyShown(FEEDBACK_SURVEY, contextRef.current) }, [])

  const emailValid = email.trim() === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  const canSend = topic !== '' && details.trim().length >= 3 && emailValid

  function close() {
    // Closed without sending anything: record a dismissal, not a response
    if (!sent) surveyDismissed(FEEDBACK_SURVEY, contextRef.current)
    onClose()
  }

  function send() {
    if (!canSend) return
    surveySent(FEEDBACK_SURVEY, {
      [TOPIC_Q.id]: topic,
      [DETAILS_Q.id]: details,
      [EMAIL_Q.id]: email,
    }, submissionId, true, contextRef.current)
    setSent(true)
  }

  return (
    <div className="restr-overlay" onClick={close}>
      <div className="restr-modal feedback-modal" role="dialog" aria-labelledby="feedback-title" onClick={e => e.stopPropagation()}>
        <div className="restr-header">
          <h2 id="feedback-title">{sent ? 'Thanks!' : 'Send feedback'}</h2>
          <button className="restr-close" onClick={close} aria-label="Close">&times;</button>
        </div>

        {sent ? (
          <>
            <p className="feedback-thanks">
              Got it — this goes straight to the person who builds DAL Planner.
              {email.trim() ? ' You may get a reply by email.' : ''}
            </p>
            <div className="restr-footer">
              <button className="restr-ok-btn" onClick={onClose}>Close</button>
            </div>
          </>
        ) : (
          <>
            <fieldset className="feedback-field">
              <legend>{TOPIC_Q.question}</legend>
              <div className="feedback-topics">
                {FEEDBACK_TOPICS.map(t => (
                  <button
                    key={t}
                    type="button"
                    className={`feedback-topic${topic === t ? ' selected' : ''}`}
                    aria-pressed={topic === t}
                    onClick={() => setTopic(t)}
                  >{t}</button>
                ))}
              </div>
            </fieldset>

            <label className="feedback-field">
              <span>{DETAILS_Q.question}</span>
              <textarea
                value={details}
                onChange={e => setDetails(e.target.value)}
                rows={4}
                maxLength={2000}
                placeholder="What happened, what you expected, or what would make this better"
              />
            </label>

            <label className="feedback-field">
              <span>Email <span className="feedback-optional">(optional, only if you'd like a reply)</span></span>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@dal.ca" />
              {!emailValid && <span className="feedback-error">That doesn't look like an email address.</span>}
            </label>

            <p className="feedback-note">Feedback is stored with this visit's anonymous usage data so issues can be reproduced.</p>

            <div className="restr-footer">
              <button className="restr-ok-btn" onClick={send} disabled={!canSend}>Send</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default FeedbackModal
