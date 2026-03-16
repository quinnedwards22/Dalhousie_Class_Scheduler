// ── PaginationControls ─────────────────────────────────────────
// Reusable bar rendered both above and below the class table.
// Displays the current result range, a rows-per-page selector,
// and Prev/Next buttons. Changing rows-per-page automatically
// resets to page 1 to avoid showing an empty page.
//
// Wrapped in React.memo — re-renders only when page, rowsPerPage,
// or totalCount changes (not on every filter keystroke).

import React from 'react'

type Props = {
  currentPage: number
  rowsPerPage: number
  totalCount: number                          // total filtered results (not total rows in DB)
  onPageChange: (page: number) => void
  onRowsPerPageChange: (rows: number) => void
  lastRefreshed?: string | null
}

const PaginationControls = React.memo(function PaginationControls({
  currentPage,
  rowsPerPage,
  totalCount,
  onPageChange,
  onRowsPerPageChange,
  lastRefreshed,
}: Props) {
  const totalPages = Math.ceil(totalCount / rowsPerPage)
  // Clamp start to 1 when totalCount is 0 to avoid displaying "0 – 0 of 0"
  const start = Math.min((currentPage - 1) * rowsPerPage + 1, totalCount)
  const end = Math.min(currentPage * rowsPerPage, totalCount)

  return (
    <div className="pagination-controls">
      <div className="pagination-info">
        Showing {start} – {end} of {totalCount} results
        {lastRefreshed && (
          <span className="last-refreshed">
            Data last updated: {new Date(lastRefreshed).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </span>
        )}
      </div>
      <div className="pagination-actions">
        <div className="rows-per-page">
          <span className="pagination-label">Rows per page:</span>
          <select
            value={rowsPerPage}
            onChange={e => {
              onRowsPerPageChange(Number(e.target.value))
              onPageChange(1) // reset to first page whenever page size changes
            }}
            className="pagination-select"
          >
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </div>
        <div className="page-buttons">
          <button
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
            disabled={currentPage === 1}
            className={`page-btn ${currentPage === 1 ? 'page-btn-disabled' : ''}`}
          >
            Prev
          </button>
          <button
            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage >= totalPages}
            className={`page-btn ${currentPage >= totalPages ? 'page-btn-disabled' : ''}`}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )
})

export default PaginationControls
