import type { CourseSection } from '../types'

export type RestrictionData = {
  restr_ind: string
  restr_type: string
  restr_descr: string
}

type RestrictionModalProps = {
  cls: CourseSection
  data: RestrictionData[] | null
  loading: boolean
  onClose: () => void
}

function RestrictionModal({ cls, data, loading, onClose }: RestrictionModalProps) {
  const includeRows = (data ?? []).filter((r: RestrictionData) => r.restr_ind === 'I')
  const excludeRows = (data ?? []).filter((r: RestrictionData) => r.restr_ind === 'E')

  return (
    <div className="restr-overlay" onClick={onClose}>
      <div className="restr-modal" onClick={e => e.stopPropagation()}>
        <div className="restr-header">
          <h2>Class Restrictions</h2>
          <button className="restr-close" onClick={onClose} aria-label="Close">&times;</button>
        </div>

        <table className="restr-info-table">
          <thead>
            <tr>
              <th>CRN</th>
              <th>Subject</th>
              <th>Course</th>
              <th>Section</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{cls.CRN}</td>
              <td>{cls.SUBJ_CODE}</td>
              <td>{cls.CRSE_NUMB}</td>
              <td>{cls.SEQ_NUMB}</td>
            </tr>
          </tbody>
        </table>

        <p className="restr-course-title"><strong>Course Title:</strong> {cls.CRSE_TITLE}</p>

        <hr className="restr-divider" />

        {loading ? (
          <p className="restr-loading">Loading restrictions...</p>
        ) : data && data.length === 0 ? (
          <p className="restr-empty">No restrictions found for this class.</p>
        ) : (
          <>
            {includeRows.length > 0 && (
              <div className="restr-section">
                <p className="restr-section-title"><strong>Restricted to students in:</strong></p>
                {includeRows.map((r: RestrictionData, i: number) => (
                  <p key={`i-${i}`} className="restr-row"><strong>{r.restr_type}:</strong> {r.restr_descr}</p>
                ))}
              </div>
            )}
            {excludeRows.length > 0 && (
              <div className="restr-section">
                <p className="restr-section-title"><strong>Not open to students in:</strong></p>
                {excludeRows.map((r: RestrictionData, i: number) => (
                  <p key={`e-${i}`} className="restr-row"><strong>{r.restr_type}:</strong> {r.restr_descr}</p>
                ))}
              </div>
            )}
          </>
        )}

        <div className="restr-footer">
          <button className="restr-ok-btn" onClick={onClose}>Ok</button>
        </div>
      </div>
    </div>
  )
}

export default RestrictionModal
