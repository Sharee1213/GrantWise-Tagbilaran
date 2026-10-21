import React from "react";
import { FolderOpen } from "lucide-react";

export default function EmptyState({
  icon: Icon = FolderOpen,
  title = "No records found",
  description = "There are currently no items matching your criteria.",
  action,
  className = "",
}) {
  return (
    <div className={`empty-state-card ${className}`} role="status">
      <div className="empty-state-icon" aria-hidden="true">
        <Icon size={28} />
      </div>
      <h3 className="empty-state-title">{title}</h3>
      <p className="empty-state-description">{description}</p>
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}
