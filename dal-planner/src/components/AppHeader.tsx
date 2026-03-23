import React, { useState, useEffect } from 'react'
import { track } from '../utils/analytics'

type Workspace = { id: string; name: string; classes: any[] }
type AppState = { activeWorkspaceId: string; workspaces: Workspace[] }

type AppHeaderProps = {
  appState: AppState
  activeTab: 'browse' | 'schedule'
  setActiveTab: (tab: 'browse' | 'schedule') => void
  createWorkspace: () => void
  switchWorkspace: (id: string) => void
  deleteWorkspace: (id: string) => void
  renameWorkspace: (id: string, name: string) => void
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
  renameWorkspace,
  selectedCount,
  totalCredits,
  conflictCount,
  missingLinkCount,
}: AppHeaderProps) {
  const [showHint, setShowHint] = useState(true)
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [showRenameHint, setShowRenameHint] = useState(
    () => !localStorage.getItem('dal-planner-rename-hint-seen')
  )

  function dismissRenameHint() {
    setShowRenameHint(false)
    localStorage.setItem('dal-planner-rename-hint-seen', '1')
  }

  function startEditing() {
    dismissRenameHint()
    const active = appState.workspaces.find(w => w.id === appState.activeWorkspaceId) || appState.workspaces[0]
    setEditName(active.name)
    setIsEditing(true)
  }

  function commitEdit() {
    renameWorkspace(appState.activeWorkspaceId, editName)
    setIsEditing(false)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') commitEdit()
    else if (e.key === 'Escape') setIsEditing(false)
  }

  useEffect(() => {
    const timer = setTimeout(() => setShowHint(false), 5000)
    if (activeTab === 'schedule') setShowHint(false)
    return () => clearTimeout(timer)
  }, [activeTab])

  useEffect(() => {
    if (!showRenameHint) return
    const timer = setTimeout(dismissRenameHint, 5000)
    return () => clearTimeout(timer)
  }, [showRenameHint])

  return (
    <header className="app-header">
      <div className="header-title-container">
        <h1>DAL Planner</h1>
        <span className="dal-badge">2026–27</span>
      </div>

      <div className="workspace-selector">
        {isEditing ? (
          <input
            className="workspace-name-input"
            value={editName}
            onChange={e => setEditName(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={handleKeyDown}
            autoFocus
          />
        ) : (
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
        )}
        <div className="workspace-rename-wrapper">
          <button className="workspace-rename" onClick={startEditing} title="Rename Plan">
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M8.5 1.5a1.414 1.414 0 0 1 2 2L3.5 10.5l-3 .5.5-3L8.5 1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <div className={`rename-hint-popup ${showRenameHint ? 'visible' : ''}`}>
            New! Name your plans
          </div>
        </div>
        {appState.workspaces.length > 1 && (
          <button className="workspace-delete" onClick={() => deleteWorkspace(appState.activeWorkspaceId)} title="Delete Plan">
            ✕
          </button>
        )}
      </div>

      <nav className="header-tabs">
        <button
          className={`header-tab ${activeTab === 'browse' ? 'active' : ''}`}
          onClick={() => { track('tab_changed', { tab: 'browse', source: 'header' }); setActiveTab('browse') }}
        >
          Browse Classes
        </button>
        <div className="schedule-tab-wrapper">
          <button
            className={`header-tab ${activeTab === 'schedule' ? 'active' : ''}`}
            onClick={() => { track('tab_changed', { tab: 'schedule', source: 'header' }); setActiveTab('schedule') }}
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
