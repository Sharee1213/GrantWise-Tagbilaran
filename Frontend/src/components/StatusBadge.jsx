import React from "react";
import {
  getApplicationStatusPresenter,
  getVerificationStatusPresenter,
  getDuplicateCheckPresenter,
  getDisbursementStatusPresenter,
} from "../strategies/statusStrategies.js";

export default function StatusBadge({
  status,
  type = "application", // 'application' | 'verification' | 'duplicate' | 'disbursement'
  className = "",
  showIcon = true,
  customLabel,
}) {
  let presenter;
  if (type === "verification") {
    presenter = getVerificationStatusPresenter(status);
  } else if (type === "duplicate") {
    presenter = getDuplicateCheckPresenter(status);
  } else if (type === "disbursement") {
    presenter = getDisbursementStatusPresenter(status);
  } else {
    presenter = getApplicationStatusPresenter(status);
  }

  const { label, variant = "neutral", Icon } = presenter;
  const displayLabel = customLabel || label;

  return (
    <span
      className={`status-badge status-badge-${variant} ${className}`}
      title={presenter.description || displayLabel}
      role="status"
    >
      {showIcon && Icon && <Icon size={13} className="status-badge-icon" aria-hidden="true" />}
      <span className="status-badge-text">{displayLabel}</span>
    </span>
  );
}
