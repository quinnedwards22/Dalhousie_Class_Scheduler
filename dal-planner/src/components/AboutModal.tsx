type AboutModalProps = {
  onClose: () => void
}

function AboutModal({ onClose }: AboutModalProps) {
  return (
    <div className="restr-overlay" onClick={onClose}>
      <div className="restr-modal about-modal" onClick={e => e.stopPropagation()}>
        <div className="restr-header">
          <h2>About DAL Planner</h2>
          <button className="restr-close" onClick={onClose} aria-label="Close">&times;</button>
        </div>

        <p>
          DAL Planner is an independent scheduling tool built by a Dalhousie University student
          to make course planning easier. It is not affiliated with, endorsed by, or officially
          connected to Dalhousie University in any way.
        </p>

        <p>
          Course data is pulled from Dalhousie's publicly accessible academic timetable.
          This tool does not allow course registration, it is for planning purposes only.
          All enrollment and scheduling decisions should be confirmed through the official
          Dalhousie registration portal.
        </p>

        <p>
          This project is free to use and contains no advertising. No personal data is
          collected from users.
        </p>

        <div className="restr-footer">
          <button className="restr-ok-btn" onClick={onClose}>Ok</button>
        </div>
      </div>
    </div>
  )
}

export default AboutModal
