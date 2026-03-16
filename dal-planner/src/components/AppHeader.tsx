import React, { useState, useEffect } from 'react'

type Workspace = { id: string; name: string; classes: any[] }
type AppState = { activeWorkspaceId: string; workspaces: Workspace[] }

type AppHeaderProps = {
  appState: AppState
  activeTab: 'browse' | 'schedule'
  setActiveTab: (tab: 'browse' | 'schedule') => void
  createWorkspace: () => void
  switchWorkspace: (id: string) => void
  deleteWorkspace: (id: string) => void
  selectedCount: number
  totalCredits: number
  conflictCount: number
  missingLinkCount: number
}

const AppHeader = React.memo(function AppHeader({
  appState,
  activeTab,
  setActiveTab,
  createWorkspace,
  switchWorkspace,
  deleteWorkspace,
  selectedCount,
  totalCredits,
  conflictCount,
  missingLinkCount,
}: AppHeaderProps) {
  const [showHint, setShowHint] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => setShowHint(false), 5000)
    if (activeTab === 'schedule') setShowHint(false)
    return () => clearTimeout(timer)
  }, [activeTab])

  return (
    <header className="app-header">
      <div className="header-title-container">
        <h1>DAL Planner</h1>
        <span className="dal-badge">2026–27</span>
      </div>

      <div className="workspace-selector">
        <select
          value={appState.activeWorkspaceId}
          onChange={e => {
            if (e.target.value === 'NEW') createWorkspace()
            else switchWorkspace(e.target.value)
          }}
        >
          {appState.workspaces.map(w => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
          <option value="NEW">+ New Plan...</option>
        </select>
        {appState.workspaces.length > 1 && (
          <button className="workspace-delete" onClick={() => deleteWorkspace(appState.activeWorkspaceId)} title="Delete Plan">
            ✕
          </button>
        )}
      </div>

      <nav className="header-tabs">
        <button
          className={`header-tab ${activeTab === 'browse' ? 'active' : ''}`}
          onClick={() => setActiveTab('browse')}
        >
          Browse Classes
        </button>
        <div className="schedule-tab-wrapper">
          <button
            className={`header-tab ${activeTab === 'schedule' ? 'active' : ''}`}
            onClick={() => setActiveTab('schedule')}
          >
            My Schedule
            {selectedCount > 0 && (
              <span className="tab-badge">{selectedCount}</span>
            )}
          </button>
          {activeTab === 'browse' && (
            <div className={`schedule-hint-popup ${showHint ? 'visible' : ''}`}>
              View & export your weekly timetable
            </div>
          )}
        </div>
      </nav>

      <div className="header-spacer" />

      {missingLinkCount > 0 && (
        <span className="header-conflict" style={{ backgroundColor: '#fef08a', color: '#854d0e' }}>
          {missingLinkCount} missing link{missingLinkCount > 1 ? 's' : ''}
        </span>
      )}
      {conflictCount > 0 && (
        <span className="header-conflict">{conflictCount} conflict{conflictCount > 1 ? 's' : ''}</span>
      )}
      {selectedCount > 0 && (
        <span className="header-credits">{totalCredits} cr hrs</span>
      )}
    </header>
  )
})

export default AppHeader
