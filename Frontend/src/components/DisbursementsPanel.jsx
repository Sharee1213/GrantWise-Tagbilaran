import React from "react";
import {
  Banknote,
  Building2,
  CheckCircle2,
  Clock,
} from "lucide-react";
import DataTable from "./DataTable.jsx";
import { formatPhp } from "../services/format.js";

export default function DisbursementsPanel({
  disbursements = {},
  disbursementSummaryOnly = false,
  activeGrants = [],
  activeAuditLogs = [],
  availableBarangays = [],
  selectedBarangay,
  onSelectBarangay,
  loadError,
  onRetry,
}) {
  return (
    <section className="staff-panel" id="disbursements">
      {loadError && (
        <div role="alert" className="auth-banner auth-banner-error mb-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <strong>{loadError.message || "Unable to load this section."}</strong>
            </div>
            <button type="button" onClick={onRetry} className="button button-outline button-sm">
              <Clock size={14} className="mr-1.5" /> Retry
            </button>
          </div>
        </div>
      )}

      <div className="panel-title-bar">
        <div>
          <div className="flex items-center gap-2">
            <Banknote className="text-emerald-500" size={22} />
            <h2 className="text-xl font-bold">Barangay Cash Disbursements & Student Payout Monitoring</h2>
          </div>
          <p className="text-muted text-xs mt-1">
            {disbursementSummaryOnly
              ? "Showing summary data only because the live cash disbursement feed could not be refreshed."
              : "Real-time visibility into whether designated Tagbilaran barangays have disbursed cash assistance to approved scholars, release timestamps, coordinator notes, and complete transaction logs."}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 my-4">
        <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="text-xs text-muted font-medium">Total Approved Grants</div>
          <div className="text-2xl font-bold mt-1 text-foreground">
            {disbursements?.grants?.length || 0}
          </div>
          <div className="text-xs text-muted mt-0.5">
            Total Allocated: {formatPhp(disbursements?.grants?.reduce((sum, g) => sum + Number(g.award_amount || 0), 0) || 0)}
          </div>
        </div>

        <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10">
          <div className="text-xs text-emerald-700 dark:text-emerald-400 font-semibold flex items-center gap-1.5">
            <CheckCircle2 size={15} /> Cash Disbursed by Barangays
          </div>
          <div className="text-2xl font-bold mt-1 text-emerald-600 dark:text-emerald-400">
            {disbursements?.grants?.filter((g) => g.claim_status === "claimed").length || 0}
          </div>
          <div className="text-xs text-emerald-700/80 dark:text-emerald-400/80 mt-0.5">
            Disbursed: {formatPhp(disbursements?.grants?.filter((g) => g.claim_status === "claimed").reduce((sum, g) => sum + Number(g.award_amount || 0), 0) || 0)}
          </div>
        </div>

        <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/10">
          <div className="text-xs text-amber-700 dark:text-amber-400 font-semibold flex items-center gap-1.5">
            <Clock size={15} /> Awaiting Barangay Release
          </div>
          <div className="text-2xl font-bold mt-1 text-amber-600 dark:text-amber-400">
            {disbursements?.grants?.filter((g) => g.claim_status === "unclaimed").length || 0}
          </div>
          <div className="text-xs text-amber-700/80 dark:text-amber-400/80 mt-0.5">
            Pending Pickup: {formatPhp(disbursements?.grants?.filter((g) => g.claim_status === "unclaimed").reduce((sum, g) => sum + Number(g.award_amount || 0), 0) || 0)}
          </div>
        </div>

        <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="text-xs text-muted font-medium">Disbursement Rate</div>
          <div className="text-2xl font-bold mt-1 text-foreground">
            {disbursements?.grants?.length
              ? Math.round(
                  (disbursements.grants.filter((g) => g.claim_status === "claimed").length /
                    disbursements.grants.length) *
                    100,
                )
              : 0}
            %
          </div>
          <div className="text-xs text-muted mt-0.5">
            Pacing across all Tagbilaran barangays
          </div>
        </div>
      </div>

      {Array.isArray(disbursements?.barangay_breakdown) && disbursements.barangay_breakdown.length > 0 && (
        <div className="my-6">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted mb-3">
            Distribution Status by Barangay
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {disbursements.barangay_breakdown.map((b) => {
              const isFullyDisbursed = b.total_grants > 0 && b.unclaimed_grants === 0;
              return (
                <div
                  key={b.barangay_id}
                  className={`p-3.5 rounded-lg border text-xs transition-colors ${
                    isFullyDisbursed
                      ? "border-emerald-500/30 bg-emerald-500/5"
                      : b.claimed_grants > 0
                        ? "border-blue-500/30 bg-blue-500/5"
                        : "border-[var(--border)] bg-[var(--surface)]"
                  }`}
                >
                  <div className="flex items-center justify-between font-bold text-sm text-foreground mb-1">
                    <span>Brgy. {b.barangay_name}</span>
                    <span
                      className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                        isFullyDisbursed
                          ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                          : b.unclaimed_grants > 0
                            ? "bg-amber-500/20 text-amber-700 dark:text-amber-300"
                            : "bg-[var(--border)] text-muted"
                      }`}
                    >
                      {isFullyDisbursed ? "✓ 100% Disbursed" : `${b.unclaimed_grants} Pending Release`}
                    </span>
                  </div>
                  <div className="flex justify-between text-muted text-[11px] mt-1">
                    <span>Total Grants: {b.total_grants} ({formatPhp(b.total_amount)})</span>
                    <span>Released: {formatPhp(b.disbursed_amount)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="my-6 p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-muted">
              Filter By Student's Barangay
            </span>
            <p className="text-xs text-muted">
              Select a specific barangay to verify released cash handovers and track student disbursements.
            </p>
          </div>
          {selectedBarangay !== "all" && (
            <button
              type="button"
              onClick={() => onSelectBarangay("all")}
              className="button button-outline button-sm self-start"
            >
              Reset to All Barangays
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onSelectBarangay("all")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              selectedBarangay === "all"
                ? "bg-emerald-600 text-white shadow-sm"
                : "bg-[var(--hover-bg)] text-[var(--secondary-text)] hover:bg-[var(--border)]"
            }`}
          >
            All Barangays ({disbursements?.grants?.length || 0})
          </button>
          {availableBarangays.map((b) => (
            <button
              key={b.name}
              type="button"
              onClick={() => onSelectBarangay(b.name)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                selectedBarangay.toLowerCase() === b.name.toLowerCase()
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "bg-[var(--hover-bg)] text-[var(--secondary-text)] hover:bg-[var(--border)]"
              }`}
            >
              <Building2 size={13} />
              Brgy. {b.name} ({b.count})
            </button>
          ))}
        </div>
      </div>

      <div className="my-6">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">
              {selectedBarangay === "all"
                ? "All Approved Grants & Cash Disbursement Logs"
                : `Brgy. ${selectedBarangay} Cash Disbursements & Student Payouts`}
            </h3>
            <p className="text-xs text-muted">
              Showing {activeGrants.length} record(s) {selectedBarangay !== "all" ? `for Brgy. ${selectedBarangay}` : "across all Tagbilaran barangays"}. 
            </p>
          </div>
        </div>
        <DataTable
          keyField="award_id"
          data={activeGrants}
          searchFields={[
            "student_first_name",
            "student_last_name",
            "student_number",
            "barangay_name",
            "program_name",
            "school_name",
            "claim_status",
          ]}
          searchPlaceholder="Search by student, barangay, program, or status..."
          emptyTitle="No approved scholarship grants found"
          emptyDescription="Grants approved by LGU will appear here with real-time disbursement status and coordinator logs."
          columns={[
            {
              header: "Student Beneficiary",
              accessor: "student_last_name",
              sortable: true,
              cell: (row) => (
                <div>
                  <strong>
                    {row.student_first_name} {row.student_last_name}
                  </strong>
                  <div className="text-muted text-xs">
                    {row.student_number} · {row.school_name}
                  </div>
                  <div className="text-muted text-xs">
                    {row.course} {row.year_level ? `(${row.year_level})` : ""}
                  </div>
                </div>
              ),
            },
            {
              header: "Program & Amount",
              accessor: "award_amount",
              sortable: true,
              cell: (row) => (
                <div>
                  <strong className="text-foreground">{formatPhp(row.award_amount)}</strong>
                  <div className="text-muted text-xs">{row.program_name}</div>
                </div>
              ),
            },
            {
              header: "Assigned Barangay",
              accessor: "barangay_name",
              sortable: true,
              cell: (row) => (
                <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[var(--surface)] border border-[var(--border)] font-medium text-xs">
                  <Building2 size={13} className="text-muted" />
                  <span>Brgy. {row.barangay_name}</span>
                </div>
              ),
            },
            {
              header: "LGU Approval",
              accessor: "approved_at",
              sortable: true,
              cell: (row) => (
                <div className="text-xs">
                  <div>
                    {row.approved_at
                      ? new Date(row.approved_at).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })
                      : "—"}
                  </div>
                  <div className="text-muted text-[11px]">
                    By: {row.approved_by_first_name ? `${row.approved_by_first_name} ${row.approved_by_last_name || ""}` : "LGU Officer"}
                  </div>
                </div>
              ),
            },
            {
              header: "Cash Distribution Status",
              accessor: "claim_status",
              sortable: true,
              cell: (row) => {
                const isClaimed = row.claim_status === "claimed";
                return (
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                      isClaimed
                        ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/40"
                        : "bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/40"
                    }`}
                  >
                    {isClaimed ? <CheckCircle2 size={13} /> : <Clock size={13} />}
                    {isClaimed ? "✓ Cash Disbursed" : "⏳ Pending Release"}
                  </span>
                );
              },
            },
            {
              header: "Barangay Disbursement Details & Proof",
              accessor: "claimed_at",
              cell: (row) => {
                const isClaimed = row.claim_status === "claimed";
                if (!isClaimed) {
                  return (
                    <div className="text-xs text-amber-600 dark:text-amber-400 italic">
                      Cash assistance awaiting student release at Brgy. {row.barangay_name} Hall
                    </div>
                  );
                }
                return (
                  <div className="text-xs space-y-0.5">
                    <div className="font-semibold text-emerald-700 dark:text-emerald-300">
                      Disbursed on: {new Date(row.claimed_at).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                    <div className="text-muted">
                      Released By: <span className="text-foreground font-medium">{row.claimed_by_first_name ? `${row.claimed_by_first_name} ${row.claimed_by_last_name || ""}` : row.claimed_by_email || `Brgy. ${row.barangay_name} Coordinator`}</span>
                    </div>
                    {row.claim_notes && (
                      <div className="text-[11px] text-muted italic bg-[var(--surface)] p-1.5 rounded border border-[var(--border)] mt-1">
                        "{row.claim_notes}"
                      </div>
                    )}
                  </div>
                );
              },
            },
          ]}
        />
      </div>

      <div className="my-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">
              Official Cash Disbursement Audit Trail (Immutable Logs)
            </h3>
            <p className="text-xs text-muted">
              Recorded transactions when Barangay Coordinators verify students and release cash funds.
            </p>
          </div>
        </div>

        {Array.isArray(activeAuditLogs) && activeAuditLogs.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
            <table className="w-full text-left text-xs">
              <thead className="bg-[var(--surface)] border-b border-[var(--border)] text-muted font-semibold uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="p-3">Log ID & Timestamp</th>
                  <th className="p-3">Action Type</th>
                  <th className="p-3">Barangay Coordinator</th>
                  <th className="p-3">Student Beneficiary</th>
                  <th className="p-3">Amount</th>
                  <th className="p-3">Barangay</th>
                  <th className="p-3">Transaction Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {activeAuditLogs.map((log) => {
                  const details = log.details || {};
                  return (
                    <tr key={log.log_id} className="hover:bg-[var(--hover-bg)] transition-colors">
                      <td className="p-3 font-mono text-[11px]">
                        <div>#{log.log_id}</div>
                        <div className="text-muted">
                          {new Date(log.created_at).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                      </td>
                      <td className="p-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
                          {log.action_type}
                        </span>
                      </td>
                      <td className="p-3">
                        <strong>
                          {log.user_first_name ? `${log.user_first_name} ${log.user_last_name || ""}` : log.user_email || `User #${log.user_id}`}
                        </strong>
                        <div className="text-muted text-[11px]">{log.role_name || "Coordinator"}</div>
                      </td>
                      <td className="p-3 font-medium text-foreground">
                        {details.student_name || "—"}
                      </td>
                      <td className="p-3 font-bold text-foreground">
                        {details.award_amount ? formatPhp(details.award_amount) : "—"}
                      </td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 rounded bg-[var(--surface)] border border-[var(--border)]">
                          {details.barangay_name || "—"}
                        </span>
                      </td>
                      <td className="p-3 text-muted max-w-xs truncate" title={details.notes}>
                        {details.notes || "Standard disbursement"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-6 text-center border rounded-lg text-muted text-xs">
            No cash disbursement audit logs recorded yet. Once barangay coordinators release cash assistance, immutable transaction records will appear here.
          </div>
        )}
      </div>
    </section>
  );
}
