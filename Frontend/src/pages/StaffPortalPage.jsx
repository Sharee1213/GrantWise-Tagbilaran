import React, { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Banknote,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  Eye,
  FileCheck,
  FileText,
  GraduationCap,
  Landmark,
  Plus,
  RefreshCw,
  School,
  ShieldCheck,
  UserCheck,
  Users,
  XCircle,
} from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import PageHeading from "../components/PageHeading.jsx";
import StatCard from "../components/StatCard.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import DataTable from "../components/DataTable.jsx";
import FundingSummary from "../components/FundingSummary.jsx";
import DisbursementsPanel from "../components/DisbursementsPanel.jsx";
import CoordinatorGrantsQueue from "../components/CoordinatorGrantsQueue.jsx";
import DisburseModal from "../components/DisburseModal.jsx";
import ModalDialog from "../components/ModalDialog.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import EmptyState from "../components/EmptyState.jsx";
import LoadingSkeleton from "../components/LoadingSkeleton.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { getPortalStrategy } from "../strategies/portalStrategies.js";
import { apiRequest } from "../services/api.js";
import { displayStatus, formatPhp } from "../services/format.js";

function LoadErrorBanner({ error, onRetry }) {
  if (!error) return null;

  return (
    <div role="alert" className="auth-banner auth-banner-error mb-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <strong>{error.message || "Unable to load this section."}</strong>
        </div>
        <button type="button" onClick={onRetry} className="button button-outline button-sm">
          <RefreshCw size={14} className="mr-1.5" /> Retry
        </button>
      </div>
    </div>
  );
}

export default function StaffPortalPage() {
  const { portalType } = useParams();
  const [searchParams] = useSearchParams();
  const strategy = getPortalStrategy(portalType);

  const previewRole = searchParams.get("previewRole");
  const previewScopeId = Number(searchParams.get("previewScopeId"));
  const hasDeveloperPreview = Boolean(
    strategy &&
    previewRole === strategy.roleName &&
    Number.isSafeInteger(previewScopeId) &&
    previewScopeId > 0,
  );
  const previewDisplayName = searchParams.get("previewName");

  const [identityState, setIdentityState] = useState("loading");
  const [authorized, setAuthorized] = useState(false);
  const [developerPreview, setDeveloperPreview] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState("");
  const { addToast } = useToast();

  const loadErrors = Array.isArray(data?.loadErrors) ? data.loadErrors : [];
  const getLoadError = useCallback(
    (key) => loadErrors.find((entry) => entry.key === key),
    [loadErrors],
  );

  // Modals & Active Selections
  const [selectedDisbursementBarangay, setSelectedDisbursementBarangay] = useState("all");
  const [reviewModalItem, setReviewModalItem] = useState(null);
  const [disburseModalGrant, setDisburseModalGrant] = useState(null);
  const [disburseNotes, setDisburseNotes] = useState("");
  const [decisionType, setDecisionType] = useState("approved");
  const [decisionRemarks, setDecisionRemarks] = useState("");
  const [decisionAwardAmount, setDecisionAwardAmount] = useState("");
  const [decisionFieldError, setDecisionFieldError] = useState({});
  const [confirmingDecision, setConfirmingDecision] = useState(false);

  // LGU Allocation Modal
  const [allocationProgram, setAllocationProgram] = useState(null);
  const [allocationRows, setAllocationRows] = useState([]);

  // LGU Create Program Modal
  const [createProgramModalOpen, setCreateProgramModalOpen] = useState(false);
  const [programForm, setProgramForm] = useState({
    programName: "",
    fundingCycleId: "",
    totalBudget: "",
    startDate: "",
    endDate: "",
  });

  // Registrar Academic Records Modal
  const [academicDetail, setAcademicDetail] = useState(null);
  const [academicSubTab, setAcademicSubTab] = useState("view"); // 'view' | 'grade' | 'check'
  const [gradeForm, setGradeForm] = useState({
    schoolYear: "2026-2027",
    semester: "1st Semester",
    gpa: "",
    remarks: "",
  });
  const [eligibilityForm, setEligibilityForm] = useState({
    checkType: "enrollment_status",
    result: "eligible",
    remarks: "",
  });

  const requestPortalData = useCallback(
    (path, options) => {
      if (!hasDeveloperPreview) return apiRequest(path, options);
      const params = new URLSearchParams({
        previewRole: strategy.roleName,
        previewScopeId: String(previewScopeId),
      });
      return apiRequest(`${path}?${params.toString()}`, options);
    },
    [hasDeveloperPreview, strategy, previewScopeId],
  );

  const loadPortalData = useCallback(async () => {
    if (!strategy) return;
    setError(null);
    try {
      const loaded = await strategy.loadDashboardData(
        requestPortalData,
        apiRequest,
      );
      setData(loaded);
    } catch (requestError) {
      const loadErrorMessage =
        requestError.message || "Please refresh or sign in again.";
      const loadErrorTitle =
        requestError.status === 503
          ? "Workflow schema or database prerequisites not ready."
          : requestError.status === 403
            ? "Access denied. Your account is not authorized for this role scope."
            : requestError.status === 401
              ? "Your authentication session is expired."
              : "Failed to load portal records.";

      setError({
        status: requestError.status,
        title: loadErrorTitle,
        message: loadErrorMessage,
      });
      addToast({
        variant: "error",
        title: "Portal load failed",
        message: loadErrorMessage,
      });
      setData(null);
    }
  }, [addToast, strategy, requestPortalData]);

  const retryLoadError = useCallback(
    async (key) => {
      if (!strategy || !requestPortalData) return;

      const endpointMap = {
        "admin/disbursements": "admin/disbursements",
        "coordinator/grants": "coordinator/grants",
        "coordinator/notifications": "coordinator/notifications",
      };

      const endpoint = endpointMap[key];
      if (!endpoint) return;

      try {
        const partial = await requestPortalData(endpoint);

        setData((current) => {
          const next = { ...(current || {}) };

          if (key === "admin/disbursements") {
            next.disbursements =
              partial && Array.isArray(partial.grants) && partial.grants.length > 0
                ? partial
                : next.disbursements || {
                    grants: [],
                    barangay_breakdown: [],
                    audit_logs: [],
                  };
            next.disbursementSummaryOnly = false;
          }

          if (key === "coordinator/grants") {
            next.grants = Array.isArray(partial?.grants) ? partial.grants : [];
          }

          if (key === "coordinator/notifications") {
            next.notifications = Array.isArray(partial?.notifications) ? partial.notifications : [];
          }

          next.loadErrors = (Array.isArray(next.loadErrors) ? next.loadErrors : []).filter(
            (entry) => entry.key !== key,
          );

          return next;
        });
      } catch (requestError) {
        const retryErrorMessage = requestError.message || "Unable to reload this data right now.";
        addToast({
          variant: "error",
          title: "Retry failed",
          message: retryErrorMessage,
        });
        setData((current) => {
          const next = { ...(current || {}) };
          next.loadErrors = [
            ...((Array.isArray(next.loadErrors) ? next.loadErrors : []).filter((entry) => entry.key !== key)),
            {
              key,
              message: retryErrorMessage,
            },
          ];
          return next;
        });
      }
    },
    [addToast, requestPortalData, strategy],
  );

  useEffect(() => {
    let active = true;
    setIdentityState("loading");
    setAuthorized(false);
    setDeveloperPreview(false);
    setData(null);
    setError(null);

    if (!strategy) {
      setIdentityState("invalid");
      return () => {
        active = false;
      };
    }

    apiRequest("auth/me")
      .then(({ user }) => {
        if (!active) return;
        const isDeveloperPreview =
          user.role === "System Admin" && hasDeveloperPreview;
        if (user.role !== strategy.roleName && !isDeveloperPreview) {
          setIdentityState("forbidden");
          setError({
            status: 403,
            title: "Access Restricted",
            message: `This workspace requires the authorized ${strategy.roleName} role.`,
          });
          return;
        }
        setDeveloperPreview(isDeveloperPreview);
        setAuthorized(true);
        setIdentityState("ready");
      })
      .catch((requestError) => {
        if (!active) return;
        setIdentityState(requestError.status === 401 ? "signed-out" : "error");
        setError({
          status: requestError.status,
          title:
            requestError.status === 401
              ? "Authentication required"
              : "Unable to verify session",
          message: requestError.message || "Please sign in to proceed.",
        });
      });

    return () => {
      active = false;
    };
  }, [hasDeveloperPreview, strategy]);

  useEffect(() => {
    if (identityState === "ready" && authorized) {
      loadPortalData();
    }
  }, [identityState, authorized, loadPortalData]);

  async function handleMutation(action, message) {
    setBusy(true);
    setError(null);
    setSuccess("");
    try {
      await action();
      setSuccess(message);
      await loadPortalData();
      return true;
    } catch (requestError) {
      setError({
        status: requestError.status,
        title: "Transaction failed",
        message:
          requestError.message || "The requested action could not be saved.",
      });
      return false;
    } finally {
      setBusy(false);
    }
  }

  // LGU Program Creation
  async function handleCreateProgram(e) {
    e.preventDefault();
    const saved = await handleMutation(
      () =>
        apiRequest("admin/programs", {
          method: "POST",
          body: JSON.stringify({
            programName: programForm.programName.trim(),
            fundingCycleId: Number(programForm.fundingCycleId),
            totalBudget: Number(programForm.totalBudget),
            startDate: programForm.startDate || null,
            endDate: programForm.endDate || null,
          }),
        }),
      "Scholarship program created successfully.",
    );
    if (saved) {
      setCreateProgramModalOpen(false);
      setProgramForm({
        programName: "",
        fundingCycleId: "",
        totalBudget: "",
        startDate: "",
        endDate: "",
      });
    }
  }

  // LGU Toggle Program Status
  async function handleToggleProgramStatus(program) {
    const nextStatus = program.status === "active" ? "inactive" : "active";
    await handleMutation(
      () =>
        apiRequest(`admin/programs/${program.program_id}`, {
          method: "PATCH",
          body: JSON.stringify({ status: nextStatus }),
        }),
      `Program status changed to ${nextStatus}.`,
    );
  }

  // Open Allocation Editor
  function openAllocationEditor(program) {
    setAllocationProgram(program);
    const existing = (program.barangay_allocations || []).map((a) => ({
      barangayId: String(a.barangayId),
      allocatedAmount: String(a.allocatedAmount),
    }));
    setAllocationRows(
      existing.length > 0
        ? existing
        : data?.barangays?.slice(0, 3).map((b) => ({
            barangayId: String(b.barangay_id),
            allocatedAmount: "0",
          })) || [],
    );
  }

  async function handleSaveAllocations() {
    if (!allocationProgram) return;
    const allocations = allocationRows.map((r) => ({
      barangayId: Number(r.barangayId),
      allocatedAmount: Number(r.allocatedAmount),
    }));
    const totalAllocated = allocations.reduce(
      (sum, a) => sum + a.allocatedAmount,
      0,
    );
    if (totalAllocated > Number(allocationProgram.total_budget)) {
      setError({
        title: "Budget constraint violated",
        message: `Total allocated amount (₱${totalAllocated.toLocaleString()}) cannot exceed the program budget of ₱${Number(allocationProgram.total_budget).toLocaleString()}.`,
      });
      return;
    }

    const saved = await handleMutation(
      () =>
        apiRequest(
          `admin/programs/${allocationProgram.program_id}/barangay-allocations`,
          {
            method: "PUT",
            body: JSON.stringify({ allocations }),
          },
        ),
      "Barangay allocations updated successfully.",
    );
    if (saved) {
      setAllocationProgram(null);
    }
  }

  // Coordinator Grant Disbursement Handling
  async function handleDisburseGrant() {
    if (!disburseModalGrant) return;
    const successMessage = `Cash assistance of ${formatPhp(disburseModalGrant.award_amount)} marked as disbursed to ${disburseModalGrant.first_name} ${disburseModalGrant.last_name}.`;
    const saved = await handleMutation(
      () =>
        apiRequest(`coordinator/grants/${disburseModalGrant.award_id}/disburse`, {
          method: "PATCH",
          body: JSON.stringify({ notes: disburseNotes }),
        }),
      successMessage,
    );
    if (saved) {
      addToast({
        variant: "success",
        title: "Cash assistance released",
        message: successMessage,
      });
      setDisburseModalGrant(null);
      setDisburseNotes("");
    } else {
      addToast({
        variant: "error",
        title: "Disbursement failed",
        message: "The cash handover could not be recorded.",
      });
    }
  }

  // Verification Decision Handling
  function openReviewModal(item) {
    setError(null);
    setSuccess("");
    setReviewModalItem(item);
    setDecisionType("approved");
    setDecisionRemarks("");
    setDecisionAwardAmount("");
    setDecisionFieldError({});
  }

  async function handleExecuteDecision() {
    if (!reviewModalItem) return;
    const vStrategy = strategy.getVerificationStrategy();
    const errors = vStrategy.validateDecision(decisionType, decisionRemarks, {
      awardAmount: decisionAwardAmount,
    });
    if (Object.keys(errors).length > 0) {
      setDecisionFieldError(errors);
      return;
    }

    const saved = await handleMutation(
      () =>
        vStrategy.submitDecision(apiRequest, reviewModalItem.verification_id, {
          status: decisionType,
          remarks: decisionRemarks.trim() || null,
          awardAmount: decisionAwardAmount
            ? Number(decisionAwardAmount)
            : undefined,
        }),
      decisionType === "approved"
        ? strategy.base === "admin"
          ? "Application approved and award reserved successfully."
          : "Verification endorsed successfully."
        : decisionType === "needs_information"
          ? "Requested additional information from the applicant."
          : "Application verification marked as rejected.",
    );

    if (saved) {
      setReviewModalItem(null);
      setConfirmingDecision(false);
    }
  }

  // Registrar Academic Records Details
  async function openRegistrarDetails(item) {
    setBusy(true);
    try {
      const res = await apiRequest(
        `registrar/verifications/${item.verification_id}${
          hasDeveloperPreview
            ? `?previewRole=${encodeURIComponent(strategy.roleName)}&previewScopeId=${previewScopeId}`
            : ""
        }`,
      );
      setAcademicDetail({ ...res, queueItem: item });
      setAcademicSubTab("view");
    } catch (err) {
      setError({
        title: "Could not load academic records",
        message: err.message,
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleAddGradeReport(e) {
    e.preventDefault();
    if (!academicDetail?.queueItem) return;
    const regStrategy = strategy.getVerificationStrategy();
    const saved = await handleMutation(
      () =>
        regStrategy.submitGradeReport(
          apiRequest,
          academicDetail.queueItem.application_id,
          {
            schoolYear: gradeForm.schoolYear,
            semester: gradeForm.semester,
            gpa: Number(gradeForm.gpa),
            remarks: gradeForm.remarks || null,
          },
        ),
      "Academic grade report recorded.",
    );
    if (saved) {
      openRegistrarDetails(academicDetail.queueItem);
    }
  }

  async function handleAddEligibilityCheck(e) {
    e.preventDefault();
    if (!academicDetail?.queueItem) return;
    const regStrategy = strategy.getVerificationStrategy();
    const saved = await handleMutation(
      () =>
        regStrategy.submitEligibilityCheck(
          apiRequest,
          academicDetail.queueItem.application_id,
          {
            checkType: eligibilityForm.checkType,
            result: eligibilityForm.result,
            remarks: eligibilityForm.remarks || null,
          },
        ),
      "Eligibility check recorded.",
    );
    if (saved) {
      openRegistrarDetails(academicDetail.queueItem);
    }
  }

  if (!strategy || identityState === "invalid") {
    return (
      <div className="page-container information-page">
        <PageHeading
          eyebrow="GRANTWISE WORKSPACE"
          title="Invalid Portal Route"
          description="The requested staff workspace does not exist in the GrantWise engine."
        />
        <Link className="button button-outline" to="/portals">
          <ArrowLeft size={16} /> Return to Portal Directory
        </Link>
      </div>
    );
  }

  const availableBarangays = React.useMemo(() => {
    const list = data?.disbursements?.grants || [];
    const bSet = new Map();
    list.forEach((g) => {
      if (g.barangay_name) {
        bSet.set(g.barangay_name, (bSet.get(g.barangay_name) || 0) + 1);
      }
    });
    return Array.from(bSet.entries()).map(([name, count]) => ({ name, count }));
  }, [data?.disbursements?.grants]);

  const activeGrants = React.useMemo(() => {
    const list = data?.disbursements?.grants || [];
    if (selectedDisbursementBarangay === "all") return list;
    return list.filter(
      (g) =>
        String(g.barangay_name).toLowerCase() ===
        selectedDisbursementBarangay.toLowerCase()
    );
  }, [data?.disbursements?.grants, selectedDisbursementBarangay]);

  const activeAuditLogs = React.useMemo(() => {
    const logs = data?.disbursements?.audit_logs || [];
    if (selectedDisbursementBarangay === "all") return logs;
    return logs.filter((l) => {
      const bName = l.details?.barangay_name || "";
      return bName.toLowerCase() === selectedDisbursementBarangay.toLowerCase();
    });
  }, [data?.disbursements?.audit_logs, selectedDisbursementBarangay]);

  return (
    <div className="staff-portal-workspace">
      {/* Page Header */}
      <div className="workspace-header">
        <div>
          <PageHeading
            eyebrow={strategy.eyebrow}
            title={strategy.title}
            description={strategy.description}
          />
          <div className="workspace-scope-pill">
            <span className="scope-indicator" />
            <span>
              {developerPreview
                ? `Developer Preview Mode (${previewDisplayName || `Scope #${previewScopeId}`})`
                : "Active Server-Verified Assignment"}
            </span>
          </div>
        </div>

        <div className="workspace-actions">
          {authorized && (
            <button
              type="button"
              className="button button-secondary"
              onClick={loadPortalData}
              disabled={busy}
              title="Refresh queue and budget records"
            >
              <RefreshCw
                size={15}
                className={busy ? "spin" : ""}
                aria-hidden="true"
              />
              <span>Refresh</span>
            </button>
          )}
          {strategy.base === "admin" && !developerPreview && (
            <button
              type="button"
              className="button button-primary"
              onClick={() => (
                setError(null),
                setSuccess(""),
                setCreateProgramModalOpen(true)
              )}
            >
              <Plus size={16} aria-hidden="true" />
              <span>Create Program</span>
            </button>
          )}
        </div>
      </div>

      {/* Developer Preview Alert */}
      {developerPreview && (
        <div className="staff-notice auth-banner-success" role="note">
          <ShieldCheck size={18} aria-hidden="true" />
          <div>
            <strong>Read-Only Developer Preview Active</strong>
            <p>
              Simulating authorized access for {strategy.roleName} (
              {previewDisplayName || `Scope #${previewScopeId}`}). Mutations are
              restricted.
            </p>
          </div>
        </div>
      )}

      {/* Notices & Alerts */}
      {error && (
        <div className="staff-notice staff-notice-error" role="alert">
          <AlertCircle size={18} aria-hidden="true" />
          <div>
            <strong>{error.title}</strong>
            <p>{error.message}</p>
          </div>
        </div>
      )}

      {success && (
        <div className="staff-notice staff-notice-success" role="status">
          <CheckCircle2 size={18} aria-hidden="true" />
          <p>{success}</p>
        </div>
      )}

      {/* Loading state */}
      {identityState === "loading" && <LoadingSkeleton type="stats" />}

      {/* Data display */}
      {data && (
        <div className="workspace-body">
          {/* A. LGU PROGRAM ADMIN VIEW */}
          {strategy.base === "admin" && (
            <>
              {/* Stat Cards */}
              <div className="stats-grid-4">
                <StatCard
                  title="Active Programs"
                  value={data.summary?.program_count || 0}
                  subtext="In your funding unit"
                  icon={Landmark}
                />
                <StatCard
                  title="Total Applications"
                  value={data.summary?.application_count || 0}
                  subtext="Submitted across all programs"
                  icon={FileText}
                />
                <StatCard
                  title="In Review Queue"
                  value={data.summary?.in_review_count || 0}
                  subtext="Awaiting LGU review / award approval"
                  icon={Clock}
                  variant="warning"
                />
                <StatCard
                  title="Available Budget"
                  value={formatPhp(
                    Number(data.summary?.remaining_budget || 0) -
                      Number(data.summary?.reserved_budget || 0),
                  )}
                  numericValue={
                    Number(data.summary?.remaining_budget || 0) -
                    Number(data.summary?.reserved_budget || 0)
                  }
                  format={(value) => formatPhp(value)}
                  subtext={`Total: ${formatPhp(data.summary?.total_budget || 0)}`}
                  icon={Building2}
                  variant="success"
                />
              </div>

              {/* Funding Summary Visualizer */}
              <FundingSummary
                totalBudget={data.summary?.total_budget}
                remainingBudget={data.summary?.remaining_budget}
                reservedBudget={data.summary?.reserved_budget}
                releasedBudget={data.summary?.released_budget}
                programName={
                  data.programs?.[0]?.program_name || "Funding Unit Portfolio"
                }
                fundingCycle={data.fundingCycles?.[0]?.cycle_code}
              />

              {/* Program Management Table */}
              <section className="staff-panel" id="programs">
                <div className="panel-title-bar">
                  <div>
                    <h2>Scholarship Programs & Barangay Allocations</h2>
                    <p className="text-muted text-xs">
                      Authorized funding programs and quota allocations for
                      Tagbilaran barangays.
                    </p>
                  </div>
                </div>

                <DataTable
                  keyField="program_id"
                  data={data.programs || []}
                  searchFields={["program_name", "cycle_code"]}
                  searchPlaceholder="Search programs..."
                  columns={[
                    {
                      header: "Program Name",
                      accessor: "program_name",
                      sortable: true,
                      cell: (row) => (
                        <div>
                          <strong>{row.program_name}</strong>
                          <div className="text-muted text-xs">
                            Cycle: {row.cycle_code}
                          </div>
                        </div>
                      ),
                    },
                    {
                      header: "Total Budget",
                      accessor: "total_budget",
                      sortable: true,
                      cell: (row) => formatPhp(row.total_budget),
                    },
                    {
                      header: "Reserved (Awards)",
                      accessor: "reserved_budget",
                      sortable: true,
                      cell: (row) => formatPhp(row.reserved_budget),
                    },
                    {
                      header: "Released",
                      accessor: "released_budget",
                      sortable: true,
                      cell: (row) => formatPhp(row.released_budget),
                    },
                    {
                      header: "Status",
                      accessor: "status",
                      cell: (row) => (
                        <StatusBadge
                          status={
                            row.status === "active" ? "approved" : "neutral"
                          }
                          customLabel={displayStatus(row.status)}
                        />
                      ),
                    },
                    {
                      header: "Actions",
                      accessor: "actions",
                      cell: (row) => (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className="button button-secondary button-sm"
                            onClick={() => openAllocationEditor(row)}
                            disabled={developerPreview}
                            title="Manage barangay quota and allocations"
                          >
                            Allocations ({row.barangay_allocations?.length || 0}
                            )
                          </button>
                          <button
                            type="button"
                            className="button button-outline button-sm"
                            onClick={() => handleToggleProgramStatus(row)}
                            disabled={
                              developerPreview ||
                              row.status === "closed" ||
                              busy
                            }
                          >
                            {row.status === "active" ? "Pause" : "Activate"}
                          </button>
                        </div>
                      ),
                    },
                  ]}
                />
              </section>

              {/* LGU Application Review Queue */}
              <section className="staff-panel" id="verifications">
                <div className="panel-title-bar">
                  <div>
                    <h2>LGU Final Review Queue</h2>
                    <p className="text-muted text-xs">
                      Endorsed applications requiring final municipal review,
                      duplicate grant verification, and award reservation.
                    </p>
                  </div>
                </div>

                <DataTable
                  keyField="verification_id"
                  data={data.verifications || []}
                  searchFields={[
                    "first_name",
                    "last_name",
                    "student_number",
                    "program_name",
                    "school_name",
                    "barangay_name",
                  ]}
                  searchPlaceholder="Search review queue..."
                  emptyTitle="No applications pending LGU review"
                  emptyDescription="All endorsed applications have been processed for your funding unit."
                  columns={[
                    {
                      header: "Applicant",
                      accessor: "last_name",
                      sortable: true,
                      cell: (row) => (
                        <div>
                          <strong>
                            {row.first_name} {row.last_name}
                          </strong>
                          <div className="text-muted text-xs">
                            {row.student_number}
                          </div>
                        </div>
                      ),
                    },
                    {
                      header: "Program",
                      accessor: "program_name",
                      sortable: true,
                    },
                    {
                      header: "School & Barangay",
                      accessor: "school_name",
                      cell: (row) => (
                        <div>
                          <span>{row.school_name}</span>
                          <div className="text-muted text-xs">
                            Brgy. {row.barangay_name}
                          </div>
                        </div>
                      ),
                    },
                    {
                      header: "Course & Standing",
                      accessor: "course",
                      cell: (row) => (
                        <span className="text-xs">
                          {row.course || "—"}{" "}
                          {row.year_level ? `(${row.year_level})` : ""}
                        </span>
                      ),
                    },
                    {
                      header: "Stage Status",
                      accessor: "status",
                      cell: (row) => (
                        <StatusBadge status={row.status} type="verification" />
                      ),
                    },
                    {
                      header: "Actions",
                      accessor: "actions",
                      cell: (row) => (
                        <button
                          type="button"
                          className="button button-primary button-sm"
                          onClick={() => openReviewModal(row)}
                          disabled={developerPreview}
                        >
                          Review & Decide
                        </button>
                      ),
                    },
                  ]}
                />
              </section>

              {/* All Applications Directory */}
              <section className="staff-panel" id="applications">
                <h2>All Applications Portfolio</h2>
                <DataTable
                  keyField="application_id"
                  data={data.applications || []}
                  searchFields={[
                    "first_name",
                    "last_name",
                    "student_number",
                    "program_name",
                    "school_name",
                    "barangay_name",
                  ]}
                  searchPlaceholder="Search all unit applications..."
                  columns={[
                    {
                      header: "Applicant",
                      accessor: "last_name",
                      sortable: true,
                      cell: (row) =>
                        `${row.first_name} ${row.last_name} (${row.student_number})`,
                    },
                    {
                      header: "Program",
                      accessor: "program_name",
                      sortable: true,
                    },
                    { header: "School", accessor: "school_name" },
                    { header: "Barangay", accessor: "barangay_name" },
                    {
                      header: "Application Status",
                      accessor: "application_status",
                      cell: (row) => (
                        <StatusBadge status={row.application_status} />
                      ),
                    },
                  ]}
                />
              </section>

              {/* Barangay Cash Disbursements & Audit Trail */}
              <DisbursementsPanel
                disbursements={data.disbursements || {}}
                disbursementSummaryOnly={Boolean(data.disbursementSummaryOnly)}
                activeGrants={activeGrants}
                activeAuditLogs={activeAuditLogs}
                availableBarangays={availableBarangays}
                selectedBarangay={selectedDisbursementBarangay}
                onSelectBarangay={setSelectedDisbursementBarangay}
                loadError={getLoadError("admin/disbursements")}
                onRetry={() => retryLoadError("admin/disbursements")}
              />
            </>
          )}

          {/* B. BARANGAY COORDINATOR VIEW */}
          {strategy.base === "coordinator" && (
            <CoordinatorGrantsQueue
              notifications={data.notifications || []}
              notificationsError={getLoadError("coordinator/notifications")}
              onNotificationsRetry={() => retryLoadError("coordinator/notifications")}
              grants={data.grants || []}
              summary={data.summary || {}}
              onDisburse={(row) => {
                setDisburseModalGrant(row);
                setDisburseNotes(`Student presented valid School ID. Received ${formatPhp(row.award_amount)} in cash.`);
              }}
              developerPreview={developerPreview}
              verificationQueue={data.verifications || []}
              onVerify={openReviewModal}
              grantError={getLoadError("coordinator/grants")}
              onGrantRetry={() => retryLoadError("coordinator/grants")}
            />
          )}

          {/* C. SCHOOL REGISTRAR VIEW */}
          {strategy.base === "registrar" && (
            <>
              <div className="stats-grid-4">
                <StatCard
                  title="Pending Academic Verifications"
                  value={data.summary?.pending_count || 0}
                  subtext="Waiting for school enrollment verification"
                  icon={Clock}
                  variant="warning"
                />
                <StatCard
                  title="Needs Academic Information"
                  value={data.summary?.needs_information_count || 0}
                  subtext="Pending grade or enrollment clarification"
                  icon={AlertCircle}
                />
                <StatCard
                  title="Rejected Applications"
                  value={data.summary?.rejected_count || 0}
                  subtext="Applications denied enrollment verification"
                  icon={XCircle}
                  variant="danger"
                />
                <StatCard
                  title="Assigned Institution"
                  value={data.verifications?.[0]?.school_name || "Campus"}
                  subtext="Authorized registrar scope"
                  icon={School}
                  variant="success"
                />
              </div>

              <section className="staff-panel" id="verifications">
                <div className="panel-title-bar">
                  <div>
                    <h2>Academic & Enrollment Verification Queue</h2>
                    <p className="text-muted text-xs">
                      Verify student registration, academic standing, and submit
                      official grade reports or eligibility records.
                    </p>
                  </div>
                </div>

                <DataTable
                  keyField="verification_id"
                  data={data.verifications || []}
                  searchFields={[
                    "first_name",
                    "last_name",
                    "student_number",
                    "course",
                    "program_name",
                  ]}
                  searchPlaceholder="Search academic queue..."
                  emptyTitle="No academic verifications pending"
                  emptyDescription="All student applications for your school have been verified."
                  columns={[
                    {
                      header: "Student",
                      accessor: "last_name",
                      sortable: true,
                      cell: (row) => (
                        <div>
                          <strong>
                            {row.first_name} {row.last_name}
                          </strong>
                          <div className="text-muted text-xs">
                            {row.student_number}
                          </div>
                        </div>
                      ),
                    },
                    { header: "Program", accessor: "program_name" },
                    {
                      header: "Curriculum",
                      accessor: "course",
                      cell: (row) =>
                        `${row.course || "—"} (${row.year_level || "1st Year"})`,
                    },
                    {
                      header: "Verification Status",
                      accessor: "status",
                      cell: (row) => (
                        <StatusBadge status={row.status} type="verification" />
                      ),
                    },
                    {
                      header: "Actions",
                      accessor: "actions",
                      cell: (row) => (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className="button button-secondary button-sm"
                            onClick={() => openRegistrarDetails(row)}
                            disabled={busy}
                          >
                            Academic Records
                          </button>
                          <button
                            type="button"
                            className="button button-primary button-sm"
                            onClick={() => openReviewModal(row)}
                            disabled={developerPreview}
                          >
                            Endorse
                          </button>
                        </div>
                      ),
                    },
                  ]}
                />
              </section>
            </>
          )}
        </div>
      )}

      {/* =====================================================================
         MODAL: LGU CREATE PROGRAM
         ===================================================================== */}
      <ModalDialog
        isOpen={createProgramModalOpen}
        onClose={() => setCreateProgramModalOpen(false)}
        title="Create Scholarship Program"
        subtitle="Establish a new scholarship fund under your assigned funding unit."
      >
        <form onSubmit={handleCreateProgram} className="staff-modal-form">
          <div className="form-field">
            <label className="form-label">Program Name</label>
            <input
              required
              maxLength={200}
              placeholder="e.g., Tagbilaran Tertiary Educational Assistance 2026"
              value={programForm.programName}
              onChange={(e) =>
                setProgramForm({ ...programForm, programName: e.target.value })
              }
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="form-field">
              <label className="form-label">Funding Cycle</label>
              <select
                required
                value={programForm.fundingCycleId}
                onChange={(e) =>
                  setProgramForm({
                    ...programForm,
                    fundingCycleId: e.target.value,
                  })
                }
              >
                <option value="">Select funding cycle</option>
                {(data?.fundingCycles || []).map((c) => (
                  <option key={c.funding_cycle_id} value={c.funding_cycle_id}>
                    {c.cycle_code}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-field">
              <label className="form-label">Authorized Budget (PHP)</label>
              <input
                required
                type="number"
                min="0.01"
                step="0.01"
                placeholder="500000.00"
                value={programForm.totalBudget}
                onChange={(e) =>
                  setProgramForm({
                    ...programForm,
                    totalBudget: e.target.value,
                  })
                }
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="form-field">
              <label className="form-label">Application Start Date</label>
              <input
                type="date"
                value={programForm.startDate}
                onChange={(e) =>
                  setProgramForm({ ...programForm, startDate: e.target.value })
                }
              />
            </div>
            <div className="form-field">
              <label className="form-label">Application End Date</label>
              <input
                type="date"
                value={programForm.endDate}
                onChange={(e) =>
                  setProgramForm({ ...programForm, endDate: e.target.value })
                }
              />
            </div>
          </div>

          {error && (
            <div className="staff-notice staff-notice-error" role="alert">
              <AlertCircle size={18} aria-hidden="true" />
              <div>
                <strong>{error.title}</strong>
                <p>{error.message}</p>
              </div>
            </div>
          )}

          <div className="modal-actions">
            <button
              type="button"
              className="button button-outline"
              onClick={() => setCreateProgramModalOpen(false)}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="button button-primary"
              disabled={busy}
            >
              {busy ? "Creating Program..." : "Create Program"}
            </button>
          </div>
        </form>
      </ModalDialog>

      {/* =====================================================================
         MODAL: LGU BARANGAY ALLOCATIONS EDITOR
         ===================================================================== */}
      {allocationProgram && (
        <ModalDialog
          isOpen={Boolean(allocationProgram)}
          onClose={() => setAllocationProgram(null)}
          title={`Barangay Allocations: ${allocationProgram.program_name}`}
          subtitle={`Program Total Budget: ${formatPhp(allocationProgram.total_budget)}`}
          maxWidth="max-w-3xl"
        >
          <div className="allocation-editor-wrapper">
            <p className="text-sm text-muted mb-4">
              Allocate authorized scholarship grant funds per Tagbilaran
              barangay. Allocations cannot exceed total program budget.
            </p>

            <div className="allocations-table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Barangay</th>
                    <th>Allocated Amount (PHP)</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {allocationRows.map((row, index) => (
                    <tr key={index}>
                      <td>
                        <select
                          value={row.barangayId}
                          onChange={(e) => {
                            const updated = [...allocationRows];
                            updated[index].barangayId = e.target.value;
                            setAllocationRows(updated);
                          }}
                        >
                          {(data?.barangays || []).map((b) => (
                            <option
                              key={b.barangay_id}
                              value={b.barangay_id}
                              disabled={allocationRows.some(
                                (r, i) =>
                                  i !== index &&
                                  String(r.barangayId) ===
                                    String(b.barangay_id),
                              )}
                            >
                              {b.barangay_name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={row.allocatedAmount}
                          onChange={(e) => {
                            const updated = [...allocationRows];
                            updated[index].allocatedAmount = e.target.value;
                            setAllocationRows(updated);
                          }}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="button button-outline button-sm text-red-600"
                          onClick={() => {
                            const updated = allocationRows.filter(
                              (_, i) => i !== index,
                            );
                            setAllocationRows(updated);
                          }}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between items-center mt-4 pt-3 border-t border-[var(--border-color)]">
              <button
                type="button"
                className="button button-secondary button-sm"
                onClick={() => {
                  const used = new Set(allocationRows.map((r) => r.barangayId));
                  const nextAvail = (data?.barangays || []).find(
                    (b) => !used.has(String(b.barangay_id)),
                  );
                  if (nextAvail) {
                    setAllocationRows([
                      ...allocationRows,
                      {
                        barangayId: String(nextAvail.barangay_id),
                        allocatedAmount: "0",
                      },
                    ]);
                  }
                }}
                disabled={
                  allocationRows.length >= (data?.barangays?.length || 0)
                }
              >
                + Add Barangay Allocation
              </button>

              <div className="text-right">
                <span className="text-xs text-muted block">
                  Total Allocated Sum:
                </span>
                <strong className="text-base text-[var(--main-text)]">
                  {formatPhp(
                    allocationRows.reduce(
                      (sum, r) => sum + (Number(r.allocatedAmount) || 0),
                      0,
                    ),
                  )}
                </strong>
              </div>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="button button-outline"
                onClick={() => setAllocationProgram(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button button-primary"
                onClick={handleSaveAllocations}
                disabled={busy}
              >
                {busy ? "Saving Allocations..." : "Save Allocations"}
              </button>
            </div>
          </div>
        </ModalDialog>
      )}

      {/* =====================================================================
         MODAL: VERIFICATION & AWARD DECISION
         ===================================================================== */}
      {reviewModalItem && (
        <ModalDialog
          isOpen={Boolean(reviewModalItem)}
          onClose={() => setReviewModalItem(null)}
          title={`Review Application: ${reviewModalItem.first_name} ${reviewModalItem.last_name}`}
          subtitle={`${reviewModalItem.program_name} · ${reviewModalItem.school_name}`}
        >
          <div className="review-modal-body">
            {/* Applicant Summary Card */}
            <div className="applicant-details-card mb-4 p-4 rounded-lg bg-[var(--hover-bg)] border border-[var(--border-color)]">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-muted block text-xs">Student ID:</span>
                  <strong>{reviewModalItem.student_number}</strong>
                </div>
                <div>
                  <span className="text-muted block text-xs">
                    Barangay Residency:
                  </span>
                  <strong>Brgy. {reviewModalItem.barangay_name}</strong>
                </div>
                <div>
                  <span className="text-muted block text-xs">School:</span>
                  <span>{reviewModalItem.school_name}</span>
                </div>
                <div>
                  <span className="text-muted block text-xs">Curriculum:</span>
                  <span>
                    {reviewModalItem.course || "—"} (
                    {reviewModalItem.year_level || "1st Year"})
                  </span>
                </div>
              </div>
            </div>

            {/* Decision Radio Group */}
            <div className="form-field">
              <label className="form-label">Verification Decision</label>
              <div className="grid grid-cols-3 gap-3">
                <button
                  type="button"
                  className={`p-3 rounded-lg border text-sm font-semibold transition text-center ${
                    decisionType === "approved"
                      ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200"
                      : "border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--secondary-text)]"
                  }`}
                  onClick={() => setDecisionType("approved")}
                >
                  <CheckCircle2
                    size={16}
                    className="mx-auto mb-1 text-emerald-600"
                  />
                  {strategy.base === "admin" ? "Approve & Award" : "Endorse"}
                </button>

                <button
                  type="button"
                  className={`p-3 rounded-lg border text-sm font-semibold transition text-center ${
                    decisionType === "needs_information"
                      ? "border-amber-500 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200"
                      : "border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--secondary-text)]"
                  }`}
                  onClick={() => setDecisionType("needs_information")}
                >
                  <Clock size={16} className="mx-auto mb-1 text-amber-600" />
                  Need Info
                </button>

                <button
                  type="button"
                  className={`p-3 rounded-lg border text-sm font-semibold transition text-center ${
                    decisionType === "rejected"
                      ? "border-red-500 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-200"
                      : "border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--secondary-text)]"
                  }`}
                  onClick={() => setDecisionType("rejected")}
                >
                  <XCircle size={16} className="mx-auto mb-1 text-red-600" />
                  Reject
                </button>
              </div>
            </div>

            {/* If LGU Admin and Approved: Award Amount input */}
            {strategy.base === "admin" && decisionType === "approved" && (
              <div className="form-field">
                <label className="form-label">
                  Scholarship Award Amount (PHP)
                </label>
                <div className="input-with-icon">
                  <span className="input-leading-icon font-bold">₱</span>
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    className={`form-input has-leading-icon ${decisionFieldError.awardAmount ? "form-input-error" : ""}`}
                    placeholder="e.g. 5000.00"
                    value={decisionAwardAmount}
                    onChange={(e) => setDecisionAwardAmount(e.target.value)}
                  />
                </div>
                {decisionFieldError.awardAmount && (
                  <span className="form-error-msg">
                    {decisionFieldError.awardAmount}
                  </span>
                )}
                <span className="text-xs text-muted">
                  Approving immediately reserves this amount from the program's
                  available budget.
                </span>
              </div>
            )}

            {/* Remarks input */}
            <div className="form-field">
              <label className="form-label">
                Reviewer Remarks{" "}
                {decisionType !== "approved" && (
                  <span className="text-red-500">*</span>
                )}
              </label>
              <textarea
                rows={3}
                placeholder="Enter notes, requirements, or reasons for this decision..."
                value={decisionRemarks}
                onChange={(e) => setDecisionRemarks(e.target.value)}
                className={decisionFieldError.remarks ? "form-input-error" : ""}
              />
              {decisionFieldError.remarks && (
                <span className="form-error-msg">
                  {decisionFieldError.remarks}
                </span>
              )}
            </div>

            {error && (
              <div className="staff-notice staff-notice-error" role="alert">
                <AlertCircle size={18} aria-hidden="true" />
                <div>
                  <strong>{error.title}</strong>
                  <p>{error.message}</p>
                </div>
              </div>
            )}

            <div className="modal-actions">
              <button
                type="button"
                className="button button-outline"
                onClick={() => setReviewModalItem(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`button ${
                  decisionType === "rejected"
                    ? "button-danger"
                    : "button-primary"
                }`}
                onClick={handleExecuteDecision}
                disabled={busy}
              >
                {busy ? "Saving Decision..." : "Submit Decision"}
              </button>
            </div>
          </div>
        </ModalDialog>
      )}

      {/* =====================================================================
         MODAL: BARANGAY CASH DISBURSEMENT HANDOVER
         ===================================================================== */}
      <DisburseModal
        grant={disburseModalGrant}
        notes={disburseNotes}
        onNotesChange={setDisburseNotes}
        error={error}
        busy={busy}
        onClose={() => setDisburseModalGrant(null)}
        onConfirm={handleDisburseGrant}
      />

      {/* =====================================================================
         MODAL: REGISTRAR ACADEMIC RECORDS & ELIGIBILITY
         ===================================================================== */}
      {academicDetail && (
        <ModalDialog
          isOpen={Boolean(academicDetail)}
          onClose={() => setAcademicDetail(null)}
          title={`Academic Records: ${academicDetail.queueItem.first_name} ${academicDetail.queueItem.last_name}`}
          subtitle={`${academicDetail.queueItem.student_number} · ${academicDetail.queueItem.course || "College"}`}
          maxWidth="max-w-2xl"
        >
          <div className="academic-records-dialog">
            {/* Tabs */}
            <div className="flex gap-2 border-b border-[var(--border-color)] pb-3 mb-4">
              <button
                type="button"
                className={`px-3 py-1.5 rounded-md text-xs font-semibold ${
                  academicSubTab === "view"
                    ? "bg-[var(--primary-interactive)] text-white"
                    : "bg-[var(--hover-bg)] text-[var(--secondary-text)]"
                }`}
                onClick={() => setAcademicSubTab("view")}
              >
                Existing Records
              </button>
              <button
                type="button"
                className={`px-3 py-1.5 rounded-md text-xs font-semibold ${
                  academicSubTab === "grade"
                    ? "bg-[var(--primary-interactive)] text-white"
                    : "bg-[var(--hover-bg)] text-[var(--secondary-text)]"
                }`}
                onClick={() => setAcademicSubTab("grade")}
              >
                + Record Grade Report
              </button>
              <button
                type="button"
                className={`px-3 py-1.5 rounded-md text-xs font-semibold ${
                  academicSubTab === "check"
                    ? "bg-[var(--primary-interactive)] text-white"
                    : "bg-[var(--hover-bg)] text-[var(--secondary-text)]"
                }`}
                onClick={() => setAcademicSubTab("check")}
              >
                + Record Eligibility Check
              </button>
            </div>

            {/* TAB: VIEW RECORDS */}
            {academicSubTab === "view" && (
              <div className="space-y-4">
                <div>
                  <h4 className="text-xs font-bold text-muted uppercase tracking-wider mb-2">
                    Grade Reports
                  </h4>
                  {(academicDetail.academicRecords?.gradeReports || [])
                    .length === 0 ? (
                    <p className="text-xs text-muted italic">
                      No grade reports recorded for this applicant yet.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {academicDetail.academicRecords.gradeReports.map(
                        (r, i) => (
                          <div
                            key={i}
                            className="p-3 rounded-lg border border-[var(--border-color)] bg-[var(--hover-bg)] text-xs flex justify-between"
                          >
                            <div>
                              <strong>
                                {r.school_year} · {r.semester}
                              </strong>
                              <p className="text-muted m-0">
                                {r.remarks || "No remarks"}
                              </p>
                            </div>
                            <div className="text-right">
                              <span className="text-emerald-700 dark:text-emerald-400 font-bold text-sm">
                                GPA: {r.gpa}
                              </span>
                            </div>
                          </div>
                        ),
                      )}
                    </div>
                  )}
                </div>

                <div>
                  <h4 className="text-xs font-bold text-muted uppercase tracking-wider mb-2">
                    Eligibility Checks
                  </h4>
                  {(academicDetail.academicRecords?.eligibilityChecks || [])
                    .length === 0 ? (
                    <p className="text-xs text-muted italic">
                      No eligibility checks recorded yet.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {academicDetail.academicRecords.eligibilityChecks.map(
                        (c, i) => (
                          <div
                            key={i}
                            className="p-3 rounded-lg border border-[var(--border-color)] bg-[var(--hover-bg)] text-xs flex justify-between items-center"
                          >
                            <div>
                              <strong>{c.check_type}</strong>
                              <p className="text-muted m-0">
                                {c.remarks || "No remarks"}
                              </p>
                            </div>
                            <StatusBadge
                              status={c.result}
                              customLabel={displayStatus(c.result)}
                            />
                          </div>
                        ),
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB: ADD GRADE REPORT */}
            {academicSubTab === "grade" && (
              <form onSubmit={handleAddGradeReport} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="form-field">
                    <label className="form-label">School Year</label>
                    <input
                      required
                      value={gradeForm.schoolYear}
                      onChange={(e) =>
                        setGradeForm({
                          ...gradeForm,
                          schoolYear: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="form-field">
                    <label className="form-label">Semester</label>
                    <input
                      required
                      value={gradeForm.semester}
                      onChange={(e) =>
                        setGradeForm({ ...gradeForm, semester: e.target.value })
                      }
                    />
                  </div>
                </div>

                <div className="form-field">
                  <label className="form-label">
                    Grade Point Average (GPA)
                  </label>
                  <input
                    required
                    type="number"
                    step="0.01"
                    min="0"
                    max="5.00"
                    placeholder="e.g. 1.75"
                    value={gradeForm.gpa}
                    onChange={(e) =>
                      setGradeForm({ ...gradeForm, gpa: e.target.value })
                    }
                  />
                </div>

                <div className="form-field">
                  <label className="form-label">Registrar Remarks</label>
                  <input
                    placeholder="e.g. Cleared for scholarship quota"
                    value={gradeForm.remarks}
                    onChange={(e) =>
                      setGradeForm({ ...gradeForm, remarks: e.target.value })
                    }
                  />
                </div>

                <button
                  type="submit"
                  className="button button-primary"
                  disabled={busy}
                >
                  {busy ? "Saving Grade Report..." : "Save Grade Report"}
                </button>
              </form>
            )}

            {/* TAB: ADD ELIGIBILITY CHECK */}
            {academicSubTab === "check" && (
              <form onSubmit={handleAddEligibilityCheck} className="space-y-3">
                <div className="form-field">
                  <label className="form-label">Check Type</label>
                  <select
                    value={eligibilityForm.checkType}
                    onChange={(e) =>
                      setEligibilityForm({
                        ...eligibilityForm,
                        checkType: e.target.value,
                      })
                    }
                  >
                    <option value="enrollment_status">Enrollment Status</option>
                    <option value="academic_standing">Academic Standing</option>
                    <option value="good_moral">Good Moral Character</option>
                    <option value="unit_load">Units Enrolled Load</option>
                  </select>
                </div>

                <div className="form-field">
                  <label className="form-label">Verification Result</label>
                  <select
                    value={eligibilityForm.result}
                    onChange={(e) =>
                      setEligibilityForm({
                        ...eligibilityForm,
                        result: e.target.value,
                      })
                    }
                  >
                    <option value="eligible">Eligible</option>
                    <option value="ineligible">Ineligible</option>
                    <option value="pending">Pending Further Audit</option>
                  </select>
                </div>

                <div className="form-field">
                  <label className="form-label">Remarks</label>
                  <input
                    placeholder="Optional notes or eligibility verification details"
                    value={eligibilityForm.remarks}
                    onChange={(e) =>
                      setEligibilityForm({
                        ...eligibilityForm,
                        remarks: e.target.value,
                      })
                    }
                  />
                </div>

                <button
                  type="submit"
                  className="button button-primary"
                  disabled={busy}
                >
                  {busy
                    ? "Saving Eligibility Record..."
                    : "Save Eligibility Record"}
                </button>
              </form>
            )}

            <div className="modal-actions">
              <button
                type="button"
                className="button button-outline"
                onClick={() => setAcademicDetail(null)}
              >
                Close
              </button>
            </div>
          </div>
        </ModalDialog>
      )}
    </div>
  );
}
