import React from "react";
import { CheckCircle2, DollarSign, PieChart, ShieldAlert } from "lucide-react";
import { formatPhp } from "../services/format.js";

export { formatPhp } from "../services/format.js";

export default function FundingSummary({
  totalBudget = 0,
  remainingBudget = 0,
  reservedBudget = 0,
  releasedBudget = 0,
  programName = "",
  fundingCycle = "",
  className = "",
}) {
  const total = Number(totalBudget) || 0;
  const remaining = Number(remainingBudget) || 0;
  const reserved = Number(reservedBudget) || 0;
  const released = Number(releasedBudget) || 0;

  // Authoritative balance formula according to backend view:
  // available_budget = remaining_budget - reserved_budget
  const available = Math.max(0, remaining - reserved);

  // Utilization percentages relative to total
  const releasedPct = total > 0 ? Math.min(100, Math.round((released / total) * 100)) : 0;
  const reservedPct = total > 0 ? Math.min(100, Math.round((reserved / total) * 100)) : 0;
  const availablePct = Math.max(0, 100 - releasedPct - reservedPct);

  return (
    <div className={`funding-summary-widget ${className}`}>
      <div className="funding-summary-header">
        <div>
          <span className="funding-summary-eyebrow">FUND UTILIZATION ENGINE</span>
          <h3 className="funding-summary-title">
            {programName ? `Budget Overview: ${programName}` : "Authoritative Program Balances"}
          </h3>
          {fundingCycle && <p className="funding-summary-cycle">Cycle: {fundingCycle}</p>}
        </div>
        <div className="funding-total-pill">
          <span>Total Authorized Budget</span>
          <strong>{formatPhp(total)}</strong>
        </div>
      </div>

      <div className="funding-metric-cards-grid">
        <div className="funding-metric-card metric-available">
          <div className="metric-header">
            <span className="metric-dot dot-available" />
            <span className="metric-label">Available to Allocate</span>
          </div>
          <div className="metric-value">{formatPhp(available)}</div>
          <span className="metric-subtext">{availablePct}% uncommitted</span>
        </div>

        <div className="funding-metric-card metric-reserved">
          <div className="metric-header">
            <span className="metric-dot dot-reserved" />
            <span className="metric-label">Reserved (Approved Awards)</span>
          </div>
          <div className="metric-value">{formatPhp(reserved)}</div>
          <span className="metric-subtext">{reservedPct}% committed to scholars</span>
        </div>

        <div className="funding-metric-card metric-released">
          <div className="metric-header">
            <span className="metric-dot dot-released" />
            <span className="metric-label">Released (Disbursed)</span>
          </div>
          <div className="metric-value">{formatPhp(released)}</div>
          <span className="metric-subtext">{releasedPct}% disbursed to students</span>
        </div>
      </div>

      <div className="funding-progress-section">
        <div className="progress-labels">
          <span>Utilization breakdown</span>
          <span>
            {releasedPct + reservedPct}% Committed ({formatPhp(reserved + released)} of {formatPhp(total)})
          </span>
        </div>
        <div
          className="multi-progress-bar"
          role="progressbar"
          aria-valuenow={releasedPct + reservedPct}
          aria-valuemin="0"
          aria-valuemax="100"
          aria-label="Budget utilization progress"
        >
          <div
            className="progress-segment segment-released"
            style={{ width: `${releasedPct}%` }}
            title={`Released: ${formatPhp(released)} (${releasedPct}%)`}
          />
          <div
            className="progress-segment segment-reserved"
            style={{ width: `${reservedPct}%` }}
            title={`Reserved: ${formatPhp(reserved)} (${reservedPct}%)`}
          />
          <div
            className="progress-segment segment-available"
            style={{ width: `${availablePct}%` }}
            title={`Available: ${formatPhp(available)} (${availablePct}%)`}
          />
        </div>
        <div className="progress-legend">
          <span className="legend-item">
            <span className="legend-color color-released" />
            <span>Released ({formatPhp(released)})</span>
          </span>
          <span className="legend-item">
            <span className="legend-color color-reserved" />
            <span>Reserved ({formatPhp(reserved)})</span>
          </span>
          <span className="legend-item">
            <span className="legend-color color-available" />
            <span>Available ({formatPhp(available)})</span>
          </span>
        </div>
      </div>
    </div>
  );
}
