// ── AppHeader ──────────────────────────────────────────────────
// Sticky top bar rendered on every tab. Contains:
//   • App title and academic year badge
//   • Workspace selector (drop-down to switch/create plans)
//   • Tab navigation (Browse / My Schedule)
//   • Summary status chips: conflict count, missing link count, credit total
//
// Wrapped in React.memo so it only re-renders when its props change —
// filter or search activity in the browse tab won't cause it to repaint.

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
  selectedCount: number   // number of sections in the active workspace
  totalCredits: number    // sum of credit hours across selected sections
  conflictCount: number   // number of sections with a time conflict
  missingLinkCount: number // number of sections missing a required companion
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
    // Hide the automatic hint after 5 seconds
    const timer = setTimeout(() => setShowHint(false), 5000)
    // Also hide if they switch tabs
    if (activeTab === 'schedule') setShowHint(false)
    return () => clearTimeout(timer)
  }, [activeTab])

  return (
    <header className="app-header">
      <div className="header-title-container">
        <h1>DAL Planner</h1>
        <span className="dal-badge">2026–27</span>
      </div>

      {/* Workspace selector — choosing "NEW" triggers workspace creation */}
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
        {/* Delete button is hidden when only one workspace remains */}
        {appState.workspaces.length > 1 && (
          <button className="workspace-delete" onClick={() => deleteWorkspace(appState.activeWorkspaceId)} title="Delete Plan">
            ✕
          </button>
        )}
      </div>

      {/* Primary tab navigation */}
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
            {/* Badge shows how many sections are currently selected */}
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

      {/* Status chips — only render when there is something to report */}
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
