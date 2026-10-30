import React from "react";
import useCountUp from "../hooks/useCountUp.js";

export default function StatCard({
  title,
  value,
  subtext,
  icon: Icon,
  variant = "default", // 'default' | 'success' | 'warning' | 'info' | 'danger'
  badge,
  className = "",
  onClick,
  numericValue,
  format,
}) {
  const isClickable = typeof onClick === "function";
  const shouldAnimate =
    numericValue !== undefined &&
    numericValue !== null &&
    typeof format === "function";

  const animatedValue = useCountUp(
    shouldAnimate ? Number(numericValue) : value ?? 0,
    {
      enabled: shouldAnimate,
      format: typeof format === "function" ? format : (raw) => raw ?? "—",
    },
  );

  const displayValue = shouldAnimate ? animatedValue : value ?? "—";

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
          <span className={`stat-card-icon-wrapper stat-card-icon-wrapper-${variant}`} aria-hidden="true">
            <Icon size={18} />
          </span>
        )}
      </div>

      <div className="stat-card-body">
        <div className="stat-card-value">{displayValue}</div>
        {badge && <span className="stat-card-badge">{badge}</span>}
      </div>

      {subtext && <p className="stat-card-subtext">{subtext}</p>}
    </article>
  );
}
