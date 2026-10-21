import React from "react";

export default function StatCard({
  title,
  value,
  subtext,
  icon: Icon,
  variant = "default", // 'default' | 'success' | 'warning' | 'info' | 'danger'
  badge,
  className = "",
  onClick,
}) {
  const isClickable = typeof onClick === "function";

  return (
    <article
      className={`stat-card stat-card-${variant} ${isClickable ? "is-clickable" : ""} ${className}`}
      onClick={onClick}
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={
        isClickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      <div className="stat-card-header">
        <span className="stat-card-title">{title}</span>
        {Icon && (
          <span className="stat-card-icon-wrapper" aria-hidden="true">
            <Icon size={18} />
          </span>
        )}
      </div>

      <div className="stat-card-body">
        <div className="stat-card-value">{value ?? "—"}</div>
        {badge && <span className="stat-card-badge">{badge}</span>}
      </div>

      {subtext && <p className="stat-card-subtext">{subtext}</p>}
    </article>
  );
}
