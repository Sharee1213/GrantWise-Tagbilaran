import React from "react";
import { Banknote, Building2, CheckCircle2, Clock } from "lucide-react";
import DataTable from "./DataTable.jsx";
import StatusBadge from "./StatusBadge.jsx";
import { formatPhp } from "../services/format.js";

export default function CoordinatorGrantsQueue({
  notifications = [],
  notificationsError,
  onNotificationsRetry,
  grants = [],
  summary = {},
  onDisburse,
  developerPreview = false,
  verificationQueue = [],
  onVerify,
  grantError,
  onGrantRetry,
}) {
  return (
    <>
      {notificationsError && (
        <div role="alert" className="auth-banner auth-banner-error mb-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <strong>{notificationsError.message || "Unable to load this section."}</strong>
            </div>
            <button type="button" onClick={onNotificationsRetry} className="button button-outline button-sm">
              <Clock size={14} className="mr-1.5" /> Retry
            </button>
          </div>
        </div>
      )}

      {Array.isArray(notifications) && notifications.length > 0 && (
        <div className="mb-6 p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 space-y-2">
          <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-semibold text-sm">
            <CheckCircle2 size={18} className="flex-shrink-0" />
            <span>Barangay Cash Disbursement Alerts ({notifications.length})</span>
          </div>
          <div className="space-y-1.5 pl-6">
            {notifications.slice(0, 3).map((n) => (
              <div key={n.notification_id} className="text-xs">
                <span className="font-medium text-foreground">{n.title}:</span>{" "}
                <span className="text-muted">{n.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="stats-grid-4">
        <StatCard
          title="Unclaimed Cash Grants"
          value={summary?.unclaimed_grants ?? (grants || []).filter((g) => g.claim_status === "unclaimed").length}
          subtext="Awaiting cash pickup at Barangay Hall"
          icon={Banknote}
          variant="warning"
        />
        <StatCard
          title="Cash Grants Disbursed"
          value={summary?.claimed_grants ?? (grants || []).filter((g) => g.claim_status === "claimed").length}
          subtext="Scholarships paid to residents"
          icon={CheckCircle2}
          variant="success"
        />
        <StatCard
          title="Pending Residency Queue"
          value={summary?.pending_count || 0}
          subtext="Waiting for your residency review"
          icon={Clock}
          variant="info"
        />
        <StatCard
          title="Assigned Barangay"
          value={grants?.[0]?.barangay_name || verificationQueue?.[0]?.barangay_name || "Tagbilaran"}
          subtext="Authorized residency territory"
          icon={Building2}
          variant="success"
        />
      </div>

      <section className="staff-panel mb-8" id="grants">
        {grantError && (
          <div role="alert" className="auth-banner auth-banner-error mb-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <strong>{grantError.message || "Unable to load this section."}</strong>
              </div>
              <button type="button" onClick={onGrantRetry} className="button button-outline button-sm">
                <Clock size={14} className="mr-1.5" /> Retry
              </button>
            </div>
          </div>
        )}

        <div className="panel-title-bar">
          <div>
            <h2>Approved Barangay Grants & Cash Disbursements</h2>
            <p className="text-muted text-xs">
              Official records of LGU-approved scholarships for residents of your barangay. Verify student ID and certificate of enrollment before releasing cash assistance.
            </p>
          </div>
        </div>

        <DataTable
          keyField="award_id"
          data={grants || []}
          searchFields={[
            "first_name",
            "last_name",
            "student_number",
            "program_name",
            "school_name",
          ]}
          searchPlaceholder="Search approved grants or student name..."
          emptyTitle="No approved grants recorded yet"
          emptyDescription="When the LGU approves an application for your barangay, it will appear here for cash claim and disbursement."
          columns={[
            {
              header: "Student & Institution",
              accessor: "last_name",
              sortable: true,
              cell: (row) => (
                <div>
                  <strong>{row.first_name} {row.last_name}</strong>
                  <div className="text-muted text-xs">ID: {row.student_number || "—"} · {row.school_name}</div>
                </div>
              ),
            },
            {
              header: "Scholarship Program",
              accessor: "program_name",
              sortable: true,
              cell: (row) => (
                <div>
                  <div className="font-medium text-sm">{row.program_name}</div>
                  <div className="text-xs text-muted">Brgy. {row.barangay_name}</div>
                </div>
              ),
            },
            {
              header: "Grant Amount",
              accessor: "award_amount",
              sortable: true,
              cell: (row) => <div className="font-semibold text-emerald-600">{formatPhp(row.award_amount)}</div>,
            },
            {
              header: "LGU Approval Date",
              accessor: "award_timestamp",
              sortable: true,
              cell: (row) => {
                const dateVal = row.award_timestamp || row.award_date;
                return (
                  <div className="text-xs">
                    <div>{dateVal ? new Date(dateVal).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}</div>
                    <div className="text-muted">{dateVal ? new Date(dateVal).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : ""}</div>
                  </div>
                );
              },
            },
            {
              header: "Cash Claim Status",
              accessor: "claim_status",
              sortable: true,
              cell: (row) => {
                const isClaimed = row.claim_status === "claimed";
                return (
                  <div className="space-y-1">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      isClaimed
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-500/20"
                        : "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-500/20"
                    }`}>
                      {isClaimed ? "✓ Cash Disbursed" : "⏳ Not Yet Claimed"}
                    </span>
                    {isClaimed && row.claimed_at && (
                      <div className="text-[11px] text-muted">
                        Claimed: {new Date(row.claimed_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })} {new Date(row.claimed_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                      </div>
                    )}
                  </div>
                );
              },
            },
            {
              header: "Transaction Logs / Action",
              accessor: "actions",
              cell: (row) => {
                if (row.claim_status === "claimed") {
                  const disburserName = row.claimed_by_first_name ? `${row.claimed_by_first_name} ${row.claimed_by_last_name}` : "Barangay Coordinator";
                  return (
                    <div className="text-xs text-muted max-w-xs space-y-0.5">
                      <div><strong className="text-foreground">Released by:</strong> {disburserName}</div>
                      {row.claim_notes && <div className="italic truncate" title={row.claim_notes}>"{row.claim_notes}"</div>}
                    </div>
                  );
                }
                return (
                  <button type="button" className="button button-primary button-sm" onClick={() => onDisburse(row)} disabled={developerPreview}>
                    Disburse Cash
                  </button>
                );
              },
            },
          ]}
        />
      </section>

      <section className="staff-panel" id="verifications">
        <div className="panel-title-bar">
          <div>
            <h2>Barangay Residency Verification Queue</h2>
            <p className="text-muted text-xs">
              Verify genuine residency, voter registration, or certificate of indigency for applicants residing in your barangay.
            </p>
          </div>
        </div>

        <DataTable
          keyField="verification_id"
          data={verificationQueue || []}
          searchFields={["first_name", "last_name", "student_number", "school_name", "program_name"]}
          searchPlaceholder="Search residency queue..."
          emptyTitle="No pending barangay verifications"
          emptyDescription="Your barangay verification queue is completely clear."
          columns={[
            {
              header: "Applicant Name",
              accessor: "last_name",
              sortable: true,
              cell: (row) => (
                <div>
                  <strong>{row.first_name} {row.last_name}</strong>
                  <div className="text-muted text-xs">ID: {row.student_number}</div>
                </div>
              ),
            },
            {
              header: "Program",
              accessor: "program_name",
              sortable: true,
            },
            { header: "School", accessor: "school_name" },
            {
              header: "Residency",
              accessor: "barangay_name",
              cell: (row) => <span>Brgy. {row.barangay_name}</span>,
            },
            {
              header: "Status",
              accessor: "status",
              cell: (row) => <StatusBadge status={row.status} type="verification" />,
            },
            {
              header: "Actions",
              accessor: "actions",
              cell: (row) => (
                <button type="button" className="button button-primary button-sm" onClick={() => onVerify(row)} disabled={developerPreview}>
                  Verify Residency
                </button>
              ),
            },
          ]}
        />
      </section>
    </>
  );
}

function StatCard({ title, value, subtext, icon: Icon, variant = "default" }) {
  const variants = {
    warning: "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300",
    success: "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300",
    info: "bg-blue-500/10 border-blue-500/30 text-blue-700 dark:text-blue-300",
    default: "bg-[var(--surface)] border-[var(--border)] text-foreground",
  };

  return (
    <div className={`rounded-xl border p-4 ${variants[variant]}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</span>
        <Icon size={18} />
      </div>
      <div className="text-3xl font-bold leading-none">{value}</div>
      <div className="mt-2 text-xs text-muted">{subtext}</div>
    </div>
  );
}
