// ── HelpfulPrompt ─────────────────────────────────────────────
// Small card shown once per visit, right after a student copies all CRNs or
// exports their schedule: "Did this help you build your schedule?" Answers go
// to the "Did the planner help?" survey in PostHog.

import { useEffect, useRef, useState } from 'react'
import { HELPFUL_SURVEY, newSubmissionId, surveyDismissed, surveySent, surveyShown } from '../utils/surveys'

type HelpfulPromptProps = {
  onClose: () => void
  context: Record<string, unknown>   // what triggered it and the plan's size
}

const [HELPED_Q, BETTER_Q] = HELPFUL_SURVEY.questions

function HelpfulPrompt({ onClose, context }: HelpfulPromptProps) {
  const [answer, setAnswer] = useState('')
  const [comment, setComment] = useState('')
  const [done, setDone] = useState(false)
  const [submissionId] = useState(newSubmissionId)
  const contextRef = useRef(context)

  useEffect(() => { surveyShown(HELPFUL_SURVEY, contextRef.current) }, [])

  // Thank-you state closes itself
  useEffect(() => {
    if (!done) return
    const t = setTimeout(onClose, 2500)
    return () => clearTimeout(t)
  }, [done, onClose])

  function choose(value: string) {
    setAnswer(value)
    // Partial response: the yes/no counts even if they skip the comment
    surveySent(HELPFUL_SURVEY, { [HELPED_Q.id]: value }, submissionId, false, contextRef.current)
  }

  function finish() {
    surveySent(HELPFUL_SURVEY, { [HELPED_Q.id]: answer, [BETTER_Q.id]: comment }, submissionId, true, contextRef.current)
    setDone(true)
  }

  function close() {
    if (!answer) surveyDismissed(HELPFUL_SURVEY, contextRef.current)
    else if (!done) finish()   // answered yes/no, closed without a comment
    onClose()
  }

  return (
    <div className="helpful-prompt" role="dialog" aria-labelledby="helpful-q">
      <button className="helpful-close" onClick={close} aria-label="Close">&times;</button>
      {done ? (
        <p className="helpful-q">Thanks, that helps!</p>
      ) : !answer ? (
        <>
          <p id="helpful-q" className="helpful-q">{HELPED_Q.question}</p>
          <div className="helpful-actions">
            <button onClick={() => choose('Yes')}>👍 Yes</button>
            <button onClick={() => choose('Not really')}>👎 Not really</button>
          </div>
        </>
      ) : (
        <>
          <p id="helpful-q" className="helpful-q">
            {answer === 'Yes' ? 'Glad to hear it! Anything we could do better?' : 'Sorry about that. What got in the way?'}
          </p>
          <textarea value={comment} onChange={e => setComment(e.target.value)} rows={3} maxLength={1000} placeholder="Optional" />
          <div className="helpful-actions">
            <button className="helpful-send" onClick={finish}>{comment.trim() ? 'Send' : 'Skip'}</button>
          </div>
        </>
      )}
    </div>
  )
}

export default HelpfulPrompt
