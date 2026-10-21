import React from "react";

export default function LoadingSkeleton({
  lines = 3,
  type = "card", // 'card' | 'table' | 'text' | 'stats'
  className = "",
}) {
  if (type === "stats") {
    return (
      <div className={`skeleton-stats-grid ${className}`} aria-busy="true" aria-label="Loading statistics">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="skeleton-stat-card">
            <div className="skeleton-line skeleton-title" />
            <div className="skeleton-line skeleton-val" />
            <div className="skeleton-line skeleton-sub" />
          </div>
        ))}
      </div>
    );
  }

  if (type === "table") {
    return (
      <div className={`skeleton-table-wrapper ${className}`} aria-busy="true" aria-label="Loading data">
        <div className="skeleton-table-header">
          <div className="skeleton-line skeleton-head" />
        </div>
        {[...Array(lines)].map((_, i) => (
          <div key={i} className="skeleton-table-row">
            <div className="skeleton-line w-1/4" />
            <div className="skeleton-line w-1/3" />
            <div className="skeleton-line w-1/6" />
            <div className="skeleton-line w-1/5" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={`skeleton-card ${className}`} aria-busy="true" aria-label="Loading content">
      {[...Array(lines)].map((_, i) => (
        <div
          key={i}
          className="skeleton-line"
          style={{ width: `${Math.max(40, 100 - i * 18)}%` }}
        />
      ))}
    </div>
  );
}
