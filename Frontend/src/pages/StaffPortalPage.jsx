import React, { useCallback, useEffect, useState } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import PageHeading from "../components/PageHeading.jsx";
import { apiRequest } from "../services/api.js";

const portalDetails = {
  "lgu-admin": {
    role: "LGU Admin",
    eyebrow: "LGU PROGRAM ADMIN",
    title: "Program oversight, within scope.",
    description:
      "Manage your assigned funding unit's programs, review applications, and monitor its funding.",
    base: "admin",
  },
  "barangay-coordinator": {
    role: "Barangay Coordinator",
    eyebrow: "BARANGAY COORDINATOR",
    title: "Local verification, securely scoped.",
    description:
      "Review applications associated with your currently assigned barangay.",
    base: "coordinator",
  },
  "school-registrar": {
    role: "Registrar",
    eyebrow: "SCHOOL REGISTRAR",
    title: "Academic verification, by school.",
    description:
      "Review applications for your assigned school using the academic records available to GrantWise.",
    base: "registrar",
  },
};

function displayStatus(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function ErrorNotice({ error }) {
  if (!error) return null;
  return (
    <section className="staff-notice staff-notice-error" role="alert">
      <strong>{error.title}</strong>
      <p>{error.message}</p>
      {error.status === 503 && (
        <p>
          This role remains protected. The backend will enable these records only
          after its required database workflow and staff assignments are
          configured.
        </p>
      )}
      {error.status === 403 && (
        <Link className="text-link" to="/portals">
          Return to portal directory
        </Link>
      )}
      {error.status === 401 && (
        <Link className="text-link" to="/login">
          Sign in to continue
        </Link>
      )}
    </section>
  );
}

export default function StaffPortalPage() {
  const { portalType } = useParams();
  const [searchParams] = useSearchParams();
  const portal = portalDetails[portalType];
  const previewRole = searchParams.get("previewRole");
  const previewScopeId = Number(searchParams.get("previewScopeId"));
  const hasDeveloperPreview = Boolean(
    portal &&
      previewRole === portal.role &&
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
  const [remarks, setRemarks] = useState({});
  const [awardAmounts, setAwardAmounts] = useState({});
  const [allocationForms, setAllocationForms] = useState({});
  const [programForm, setProgramForm] = useState({
    programName: "",
    fundingCycleId: "",
    totalBudget: "",
    startDate: "",
    endDate: "",
  });
  const [academicForm, setAcademicForm] = useState({
    schoolYear: "",
    semester: "",
    gpa: "",
    gradeRemarks: "",
    checkType: "",
    result: "pending",
    eligibilityRemarks: "",
  });
  const [selectedDetail, setSelectedDetail] = useState(null);

  const requestPortalData = useCallback(
    (path, options) => {
      if (!hasDeveloperPreview) return apiRequest(path, options);
      const params = new URLSearchParams({
        previewRole: portal.role,
        previewScopeId: String(previewScopeId),
      });
      return apiRequest(`${path}?${params.toString()}`, options);
    },
    [hasDeveloperPreview, portal, previewScopeId],
  );

  const loadPortalData = useCallback(async () => {
    if (!portal) return;
    setError(null);
    try {
      if (portal.base === "admin") {
        const [dashboard, programs, applications, fundingCycles, queue, lookups] =
          await Promise.all([
            requestPortalData("admin/dashboard"),
            requestPortalData("admin/programs"),
            requestPortalData("admin/applications"),
            requestPortalData("admin/funding-cycles"),
            requestPortalData("admin/verifications"),
            apiRequest("lookups"),
          ]);
        setData({
          ...dashboard,
          ...programs,
          ...applications,
          ...fundingCycles,
          ...queue,
          ...lookups,
        });
      } else {
        const [dashboard, queue] = await Promise.all([
          requestPortalData(`${portal.base}/dashboard`),
          requestPortalData(`${portal.base}/verifications`),
        ]);
        setData({ ...dashboard, ...queue });
      }
    } catch (requestError) {
      setError({
        status: requestError.status,
        title:
          requestError.status === 503
            ? "This portal needs the database workflow."
            : requestError.status === 403
              ? "This account cannot access this portal."
              : requestError.status === 401
                ? "Your session is not available."
                : "The portal data could not be loaded.",
        message: requestError.message || "Try again in a moment.",
      });
      setData(null);
    }
  }, [portal, requestPortalData]);

  useEffect(() => {
    let active = true;
    setIdentityState("loading");
    setAuthorized(false);
    setDeveloperPreview(false);
    setData(null);
    setError(null);
    if (!portal) {
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
        if (user.role !== portal.role && !isDeveloperPreview) {
          setIdentityState("forbidden");
          setError({
            status: 403,
            title: "This staff portal is not available to your account.",
            message: `This workspace is restricted to the ${portal.role} role.`,
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
              ? "Sign in to access this staff portal."
              : requestError.status === 403
                ? "This account has no active staff assignment."
                : "Unable to verify your session.",
          message: requestError.message || "The current session could not be checked.",
        });
      });
    return () => {
      active = false;
    };
  }, [hasDeveloperPreview, portal]);

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
      setSelectedDetail(null);
      await loadPortalData();
      return true;
    } catch (requestError) {
      setError({
        status: requestError.status,
        title: "The change could not be saved.",
        message: requestError.message || "Try again in a moment.",
      });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function createProgram(event) {
    event.preventDefault();
    const saved = await handleMutation(
      () =>
        apiRequest("admin/programs", {
          method: "POST",
          body: JSON.stringify({
            programName: programForm.programName,
            fundingCycleId: Number(programForm.fundingCycleId),
            totalBudget: Number(programForm.totalBudget),
            startDate: programForm.startDate || null,
            endDate: programForm.endDate || null,
          }),
        }),
      "Program created.",
    );
    if (!saved) return;
    setProgramForm({
      programName: "",
      fundingCycleId: "",
      totalBudget: "",
      startDate: "",
      endDate: "",
    });
  }

  async function changeProgramStatus(program) {
    const status = program.status === "active" ? "inactive" : "active";
    await handleMutation(
      () =>
        apiRequest(`admin/programs/${program.program_id}`, {
          method: "PATCH",
          body: JSON.stringify({ status }),
        }),
      `Program ${status === "active" ? "activated" : "paused"}.`,
    );
  }

  function allocationsFor(program) {
    return allocationForms[program.program_id] || (
      program.barangay_allocations || []
    ).map((allocation) => ({
      barangayId: String(allocation.barangayId),
      allocatedAmount: String(allocation.allocatedAmount),
    }));
  }

  function updateAllocation(programId, index, field, value) {
    const program = data.programs.find(
      (item) => item.program_id === programId,
    );
    const allocations = [...allocationsFor(program)];
    allocations[index] = { ...allocations[index], [field]: value };
    setAllocationForms({ ...allocationForms, [programId]: allocations });
  }

  function addAllocation(program) {
    const allocations = [...allocationsFor(program)];
    const usedIds = new Set(allocations.map((allocation) => allocation.barangayId));
    const firstAvailable = data.barangays.find(
      (barangay) => !usedIds.has(String(barangay.barangay_id)),
    );
    if (!firstAvailable) return;
    setAllocationForms({
      ...allocationForms,
      [program.program_id]: [
        ...allocations,
        {
          barangayId: String(firstAvailable.barangay_id),
          allocatedAmount: "0",
        },
      ],
    });
  }

  function removeAllocation(program, index) {
    const allocations = [...allocationsFor(program)];
    allocations.splice(index, 1);
    setAllocationForms({
      ...allocationForms,
      [program.program_id]: allocations,
    });
  }

  async function saveAllocations(program) {
    const saved = await handleMutation(
      () =>
        apiRequest(
          `admin/programs/${program.program_id}/barangay-allocations`,
          {
            method: "PUT",
            body: JSON.stringify({
              allocations: allocationsFor(program).map((allocation) => ({
                barangayId: Number(allocation.barangayId),
                allocatedAmount: Number(allocation.allocatedAmount),
              })),
            }),
          },
        ),
      "Barangay allocations saved.",
    );
    if (saved) {
      const next = { ...allocationForms };
      delete next[program.program_id];
      setAllocationForms(next);
    }
  }

  async function decideVerification(verification, status) {
    const body = {
      status,
      remarks: remarks[verification.verification_id] || null,
    };
    if (portal.base === "admin" && status === "approved") {
      body.awardAmount = Number(awardAmounts[verification.verification_id]);
    }
    await handleMutation(
      () =>
        apiRequest(
          `${portal.base}/verifications/${verification.verification_id}`,
          { method: "PATCH", body: JSON.stringify(body) },
        ),
      status === "needs_information"
        ? "More information requested."
        : status === "rejected"
          ? "Application rejected."
          : portal.base === "admin"
            ? "Application approved and award reserved."
            : "Verification recorded.",
    );
  }

  async function showRegistrarDetails(verificationId) {
    setBusy(true);
    setError(null);
    try {
      const result = await apiRequest(
        `registrar/verifications/${verificationId}${
          hasDeveloperPreview
            ? `?previewRole=${encodeURIComponent(portal.role)}&previewScopeId=${previewScopeId}`
            : ""
        }`,
      );
      setSelectedDetail(result);
    } catch (requestError) {
      setError({
        status: requestError.status,
        title: "Verification details could not be loaded.",
        message: requestError.message || "Try again in a moment.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function saveAcademicRecord(verification, kind) {
    const gradeReport = kind === "grade-report";
    const body = gradeReport
      ? {
          schoolYear: academicForm.schoolYear,
          semester: academicForm.semester,
          gpa: Number(academicForm.gpa),
          remarks: academicForm.gradeRemarks || null,
        }
      : {
          checkType: academicForm.checkType,
          result: academicForm.result,
          remarks: academicForm.eligibilityRemarks || null,
        };
    const route = gradeReport ? "grade-reports" : "eligibility-checks";
    await handleMutation(
      () =>
        apiRequest(
          `registrar/applications/${verification.application_id}/${route}`,
          { method: "POST", body: JSON.stringify(body) },
        ),
      gradeReport ? "Grade report recorded." : "Eligibility check recorded.",
    );
  }

  if (!portal || identityState === "invalid") {
    return (
      <section className="page-container information-page">
        <PageHeading
          eyebrow="STAFF PORTAL"
          title="This portal is not available."
          description="Choose one of the GrantWise role portals."
        />
        <Link className="text-link" to="/portals">
          <ArrowLeft size={16} aria-hidden="true" />
          All portals
        </Link>
      </section>
    );
  }

  return (
    <div className="page-container information-page staff-dashboard">
      <PageHeading
        eyebrow={portal.eyebrow}
        title={portal.title}
        description={portal.description}
      />
      <div className="staff-toolbar">
        <span>
          {developerPreview
            ? `Developer preview · read-only · ${previewDisplayName || portal.role}`
            : "Access is checked against your active server-side assignment."}
        </span>
        {authorized && (
          <button
            className="button button-secondary"
            type="button"
            onClick={loadPortalData}
            disabled={busy}
          >
            <RefreshCw size={15} aria-hidden="true" />
            Refresh
          </button>
        )}
      </div>

      {developerPreview && (
        <section className="staff-notice" role="note">
          <strong>Read-only developer preview</strong>
          <p>
            You are viewing the {portal.role} dashboard for{" "}
            {previewDisplayName || `scope #${previewScopeId}`}. Changes and
            student portal access are disabled in this preview.
          </p>
        </section>
      )}

      {identityState === "loading" && (
        <p role="status" className="staff-loading">Checking your staff session...</p>
      )}
      <ErrorNotice error={error} />
      {success && <p className="staff-notice staff-notice-success" role="status">{success}</p>}
      {identityState === "ready" && !data && !error && (
        <p role="status" className="staff-loading">Loading authorized records...</p>
      )}

      {data && portal.base === "admin" && (
        <>
          <section className="staff-summary-grid" aria-label="Funding unit summary">
            {[
              ["Programs", data.summary.program_count],
              ["Applications", data.summary.application_count],
              ["In review", data.summary.in_review_count],
              ["Total budget", formatMoney(data.summary.total_budget)],
              ["Remaining", formatMoney(data.summary.remaining_budget)],
              ["Reserved", formatMoney(data.summary.reserved_budget)],
              ["Released", formatMoney(data.summary.released_budget)],
            ].map(([label, value]) => (
              <article className="staff-summary-card" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </article>
            ))}
          </section>

          <section className="staff-panel">
            <h2>Programs in your funding unit</h2>
            {data.programs.length === 0 ? (
              <p className="staff-empty">No programs are recorded for this funding unit.</p>
            ) : (
              <div className="staff-record-list">
                {data.programs.map((program) => (
                  <article className="staff-record" key={program.program_id}>
                    <div>
                      <strong>{program.program_name}</strong>
                      <p>{program.cycle_code} · {displayStatus(program.status)}</p>
                      <p>
                        Total {formatMoney(program.total_budget)} · Remaining{" "}
                        {formatMoney(program.remaining_budget)} · Reserved{" "}
                        {formatMoney(program.reserved_budget)} · Released{" "}
                        {formatMoney(program.released_budget)}
                      </p>
                      <div className="staff-allocation-editor" hidden={developerPreview}>
                        <strong>Barangay allocations</strong>
                        {allocationsFor(program).map((allocation, index) => (
                          <div
                            className="staff-allocation-row"
                            key={`${program.program_id}-${index}`}
                          >
                            <select
                              aria-label="Allocation barangay"
                              value={allocation.barangayId}
                              onChange={(event) => updateAllocation(
                                program.program_id,
                                index,
                                "barangayId",
                                event.target.value,
                              )}
                            >
                              <option value="">Select barangay</option>
                              {data.barangays.map((barangay) => (
                                <option
                                  key={barangay.barangay_id}
                                  value={barangay.barangay_id}
                                  disabled={allocationsFor(program).some(
                                    (row, rowIndex) =>
                                      rowIndex !== index &&
                                      row.barangayId === String(barangay.barangay_id),
                                  )}
                                >
                                  {barangay.barangay_name}
                                </option>
                              ))}
                            </select>
                            <input
                              aria-label="Barangay allocation amount in PHP"
                              type="number"
                              min="0"
                              step="0.01"
                              value={allocation.allocatedAmount}
                              onChange={(event) => updateAllocation(
                                program.program_id,
                                index,
                                "allocatedAmount",
                                event.target.value,
                              )}
                            />
                            <button
                              className="button button-secondary"
                              type="button"
                              onClick={() => removeAllocation(program, index)}
                              disabled={busy}
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                        <div className="staff-actions">
                          <button
                            className="button button-secondary"
                            type="button"
                            onClick={() => addAllocation(program)}
                            disabled={
                              busy ||
                              allocationsFor(program).length >= data.barangays.length
                            }
                          >
                            Add barangay
                          </button>
                          <button
                            className="button button-primary"
                            type="button"
                            onClick={() => saveAllocations(program)}
                            disabled={busy || allocationsFor(program).length === 0}
                          >
                            Save allocations
                          </button>
                        </div>
                      </div>
                    </div>
                    <button
                      className="button button-secondary"
                      type="button"
                      onClick={() => changeProgramStatus(program)}
                      disabled={busy || program.status === "closed"}
                      hidden={developerPreview}
                    >
                      {program.status === "active" ? "Pause" : "Activate"}
                    </button>
                  </article>
                ))}
              </div>
            )}
          </section>

          {!developerPreview && <section className="staff-panel">
            <h2>Create a program</h2>
            {data.fundingCycles.length === 0 ? (
              <p className="staff-empty">
                No active funding cycle is configured. Contact the database
                administrator before creating a program.
              </p>
            ) : (
              <form className="staff-form" onSubmit={createProgram}>
                <label>
                  Program name
                  <input
                    required
                    maxLength={200}
                    value={programForm.programName}
                    onChange={(event) => setProgramForm({
                      ...programForm,
                      programName: event.target.value,
                    })}
                  />
                </label>
                <label>
                  Funding cycle
                  <select
                    required
                    value={programForm.fundingCycleId}
                    onChange={(event) => setProgramForm({
                      ...programForm,
                      fundingCycleId: event.target.value,
                    })}
                  >
                    <option value="">Select a cycle</option>
                    {data.fundingCycles.map((cycle) => (
                      <option key={cycle.funding_cycle_id} value={cycle.funding_cycle_id}>
                        {cycle.cycle_code}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Total budget (PHP)
                  <input
                    required
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={programForm.totalBudget}
                    onChange={(event) => setProgramForm({
                      ...programForm,
                      totalBudget: event.target.value,
                    })}
                  />
                </label>
                <label>
                  Application opens
                  <input
                    type="date"
                    value={programForm.startDate}
                    onChange={(event) => setProgramForm({
                      ...programForm,
                      startDate: event.target.value,
                    })}
                  />
                </label>
                <label>
                  Application closes
                  <input
                    type="date"
                    value={programForm.endDate}
                    onChange={(event) => setProgramForm({
                      ...programForm,
                      endDate: event.target.value,
                    })}
                  />
                </label>
                <button className="button button-primary" disabled={busy}>
                  Create program
                </button>
              </form>
            )}
          </section>}

          <section className="staff-panel">
            <h2>Applications for your funding unit</h2>
            {data.applications.length === 0 ? (
              <p className="staff-empty">No applications are recorded for this unit.</p>
            ) : (
              <div className="staff-record-list">
                {data.applications.map((application) => (
                  <article className="staff-record" key={application.application_id}>
                    <div>
                      <strong>
                        {application.first_name} {application.last_name} ·{" "}
                        {application.program_name}
                      </strong>
                      <p>
                        {application.student_number} · {application.school_name} ·{" "}
                        {application.barangay_name}
                      </p>
                      <p>{displayStatus(application.application_status)}</p>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {data && portal.base !== "admin" && (
        <section className="staff-summary-grid" aria-label="Verification queue summary">
          <article className="staff-summary-card">
            <span>Pending verifications</span>
            <strong>{data.summary.pending_count}</strong>
          </article>
          <article className="staff-summary-card">
            <span>Needs information</span>
            <strong>{data.summary.needs_information_count}</strong>
          </article>
        </section>
      )}

      {data && (
        <section className="staff-panel">
          <h2>
            {portal.base === "admin"
              ? "Funding-unit application review"
              : "Verification queue"}
          </h2>
          {data.verifications.length === 0 ? (
            <p className="staff-empty">There are no verification tasks in your queue.</p>
          ) : (
            <div className="staff-record-list">
              {data.verifications.map((verification) => (
                <article className="staff-record staff-record-stacked" key={verification.verification_id}>
                  <div className="staff-record-heading">
                    <div>
                      <strong>
                        {verification.first_name} {verification.last_name} ·{" "}
                        {verification.program_name}
                      </strong>
                      <p>
                        {verification.student_number} · {verification.school_name}
                        {verification.barangay_name
                          ? ` · ${verification.barangay_name}`
                          : ""}
                      </p>
                      {verification.course && (
                        <p>{verification.course}{verification.year_level ? ` · ${verification.year_level}` : ""}</p>
                      )}
                      <p>
                        {displayStatus(verification.application_status)} ·{" "}
                        {displayStatus(verification.status)}
                      </p>
                    </div>
                    {portal.base === "registrar" && (
                      <button
                        className="button button-secondary"
                        type="button"
                        disabled={busy}
                        onClick={() => showRegistrarDetails(verification.verification_id)}
                      >
                        Academic details
                      </button>
                    )}
                  </div>
                  {portal.base === "registrar" &&
                    selectedDetail?.verification?.verification_id === verification.verification_id && (
                      <div className="staff-academic-records">
                        <strong>Grade reports</strong>
                        {selectedDetail.academicRecords.gradeReports.length === 0 ? (
                          <p>No grade reports are recorded.</p>
                        ) : selectedDetail.academicRecords.gradeReports.map((record, index) => (
                          <p key={`${record.school_year}-${record.semester}-${index}`}>
                            {record.school_year} · {record.semester} · GPA {record.gpa}
                            {record.remarks ? ` · ${record.remarks}` : ""}
                          </p>
                        ))}
                        <strong>Eligibility checks</strong>
                        {selectedDetail.academicRecords.eligibilityChecks.length === 0 ? (
                          <p>No eligibility checks are recorded.</p>
                        ) : selectedDetail.academicRecords.eligibilityChecks.map((record, index) => (
                          <p key={`${record.check_type}-${index}`}>
                            {record.check_type} · {displayStatus(record.result)}
                            {record.remarks ? ` · ${record.remarks}` : ""}
                          </p>
                        ))}
                        <form
                          className="staff-form staff-academic-form"
                          hidden={developerPreview}
                          onSubmit={(event) => {
                            event.preventDefault();
                            saveAcademicRecord(verification, "grade-report");
                          }}
                        >
                          <label>
                            School year
                            <input
                              required
                              maxLength={20}
                              value={academicForm.schoolYear}
                              onChange={(event) => setAcademicForm({
                                ...academicForm,
                                schoolYear: event.target.value,
                              })}
                            />
                          </label>
                          <label>
                            Semester
                            <input
                              required
                              maxLength={20}
                              value={academicForm.semester}
                              onChange={(event) => setAcademicForm({
                                ...academicForm,
                                semester: event.target.value,
                              })}
                            />
                          </label>
                          <label>
                            GPA
                            <input
                              required
                              type="number"
                              min="0"
                              max="99.99"
                              step="0.01"
                              value={academicForm.gpa}
                              onChange={(event) => setAcademicForm({
                                ...academicForm,
                                gpa: event.target.value,
                              })}
                            />
                          </label>
                          <label>
                            Grade report notes
                            <input
                              maxLength={2000}
                              value={academicForm.gradeRemarks}
                              onChange={(event) => setAcademicForm({
                                ...academicForm,
                                gradeRemarks: event.target.value,
                              })}
                            />
                          </label>
                          <button className="button button-secondary" disabled={busy}>
                            Record grade report
                          </button>
                        </form>
                        <form
                          className="staff-form staff-academic-form"
                          hidden={developerPreview}
                          onSubmit={(event) => {
                            event.preventDefault();
                            saveAcademicRecord(verification, "eligibility-check");
                          }}
                        >
                          <label>
                            Check type
                            <input
                              required
                              maxLength={50}
                              value={academicForm.checkType}
                              onChange={(event) => setAcademicForm({
                                ...academicForm,
                                checkType: event.target.value,
                              })}
                            />
                          </label>
                          <label>
                            Result
                            <select
                              value={academicForm.result}
                              onChange={(event) => setAcademicForm({
                                ...academicForm,
                                result: event.target.value,
                              })}
                            >
                              <option value="pending">Pending</option>
                              <option value="eligible">Eligible</option>
                              <option value="ineligible">Ineligible</option>
                            </select>
                          </label>
                          <label>
                            Eligibility notes
                            <input
                              maxLength={2000}
                              value={academicForm.eligibilityRemarks}
                              onChange={(event) => setAcademicForm({
                                ...academicForm,
                                eligibilityRemarks: event.target.value,
                              })}
                            />
                          </label>
                          <button className="button button-secondary" disabled={busy}>
                            Record eligibility check
                          </button>
                        </form>
                      </div>
                    )}
                  {!developerPreview && <label className="staff-field">
                    Review notes
                    <textarea
                      maxLength={2000}
                      value={remarks[verification.verification_id] || ""}
                      onChange={(event) => setRemarks({
                        ...remarks,
                        [verification.verification_id]: event.target.value,
                      })}
                    />
                  </label>}
                  {!developerPreview && portal.base === "admin" && (
                    <label className="staff-field staff-award-field">
                      Award amount (PHP, required to approve)
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={awardAmounts[verification.verification_id] || ""}
                        onChange={(event) => setAwardAmounts({
                          ...awardAmounts,
                          [verification.verification_id]: event.target.value,
                        })}
                      />
                    </label>
                  )}
                  {!developerPreview && <div className="staff-actions">
                    <button
                      className="button button-primary"
                      type="button"
                      disabled={
                        busy ||
                        (portal.base === "admin" &&
                          !(Number(awardAmounts[verification.verification_id]) > 0))
                      }
                      onClick={() => decideVerification(verification, "approved")}
                    >
                      {portal.base === "admin" ? "Approve and reserve award" : "Approve"}
                    </button>
                    <button
                      className="button button-secondary"
                      type="button"
                      disabled={busy}
                      onClick={() => decideVerification(verification, "needs_information")}
                    >
                      Request information
                    </button>
                    <button
                      className="button button-danger"
                      type="button"
                      disabled={busy}
                      onClick={() => decideVerification(verification, "rejected")}
                    >
                      Reject
                    </button>
                  </div>}
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      <div className="page-actions">
        <Link className="text-link" to="/portals">
          <ArrowLeft size={16} aria-hidden="true" />
          All portals
        </Link>
      </div>
    </div>
  );
}
