import React from "react";
import {
  CheckCircle2,
  Clock,
  FileCheck,
  FileText,
  Landmark,
  School,
  XCircle,
} from "lucide-react";
import StatusBadge from "./StatusBadge.jsx";
import { AnimatedCheckMark } from "./ToastRegion.jsx";

const VERIFICATION_STAGES = [
  {
    key: "barangay_verification",
    verificationType: "barangay",
    label: "Barangay Verification",
    description: "Barangay Coordinator verifies applicant residency.",
    icon: Clock,
  },
  {
    key: "registrar_verification",
    verificationType: "registrar",
    label: "Registrar Verification",
    description: "School Registrar verifies academic enrollment and standing.",
    icon: School,
  },
  {
    key: "lgu_review",
    verificationType: "lgu",
    label: "LGU Final Review",
    description: "LGU Admin verifies duplicate grant checks and quota limits.",
    icon: Landmark,
  },
];

const APPLICATION_STEPS = [
  {
    key: "draft",
    label: "Draft Application",
    description: "Applicant enters student, school, and residency details.",
    icon: FileText,
  },
  {
    key: "submitted",
    label: "Application Submitted",
    description: "Online submission confirmed and queued for municipal verification.",
    icon: FileCheck,
  },
  ...VERIFICATION_STAGES,
  {
    key: "approved",
    label: "Award Approved & Reserved",
    description: "Scholarship approved; fund allocation committed.",
    icon: CheckCircle2,
  },
];

const STATUS_STEP_INDEX = {
  draft: 0,
  submitted: 1,
  barangay_verification: 2,
  registrar_verification: 3,
  lgu_review: 4,
  approved: 5,
  rejected: -1,
  withdrawn: -1,
};

function resolveStageKey(verificationType) {
  const normalized = String(verificationType || "").trim().toLowerCase();
  if (normalized === "barangay") return "barangay_verification";
  if (normalized === "registrar") return "registrar_verification";
  if (normalized === "lgu") return "lgu_review";
  return normalized;
}

function getVerificationStatusMap(verifications = []) {
  return verifications.reduce((acc, verification) => {
    const type = String(verification?.verification_type || "").trim().toLowerCase();
    if (!type) return acc;
    acc[type] = String(verification?.status || "pending").trim().toLowerCase();
    return acc;
  }, {});
}

export default function ApplicationTimeline({
  status = "draft",
  submittedAt,
  reviewedAt,
  remarks,
  verifications = [],
  claimStatus,
  className = "",
}) {
  const normalizedStatus = String(status || "").trim().toLowerCase();
  const verificationStatusMap = getVerificationStatusMap(verifications);
  const infoRequestedStage = verifications.find(
    (verification) => String(verification?.status || "").trim().toLowerCase() === "needs_information",
  )?.verification_type;
  const isRejected = normalizedStatus === "rejected";
  const isWithdrawn = normalizedStatus === "withdrawn";
  const isClaimed = String(claimStatus || "").trim().toLowerCase() === "claimed";

  const currentStepKey = (() => {
    if (isRejected || isWithdrawn) return "rejected";
    if (normalizedStatus === "approved") return "approved";
    if (infoRequestedStage) return resolveStageKey(infoRequestedStage);
    if (normalizedStatus in STATUS_STEP_INDEX) return normalizedStatus;
    return "submitted";
  })();

  const steps = APPLICATION_STEPS.map((step, index) => {
    const isFinalStep = step.key === "approved";
    const isVerificationStep = step.key.includes("verification") || step.key === "lgu_review";
    const verificationState = isVerificationStep
      ? verificationStatusMap[step.key.replace("_verification", "").replace("_review", "")]
      : null;

    const completionIndex = STATUS_STEP_INDEX[normalizedStatus] ?? 1;
    const isCompleted =
      (isFinalStep && normalizedStatus === "approved") ||
      (!isRejected && !isWithdrawn && completionIndex > index) ||
      (verificationState === "approved" && index < APPLICATION_STEPS.length - 1) ||
      (verificationState === "rejected" && isVerificationStep && index === APPLICATION_STEPS.length - 2);
    const isInfoRequested =
      !isRejected &&
      !isWithdrawn &&
      Boolean(infoRequestedStage) &&
      step.key === `${infoRequestedStage}_verification`;
    const isCurrent = currentStepKey === step.key;
    const isClaimedStep = isClaimed && isFinalStep;

    return {
      ...step,
      isCompleted,
      isCurrent,
      isInfoRequested,
      isClaimedStep,
    };
  });

  return (
    <div className={`application-timeline-card ${className}`}>
      <div className="timeline-header">
        <div>
          <span className="timeline-eyebrow">VERIFICATION PIPELINE</span>
          <h4 className="timeline-title">Application Lifecycle Progress</h4>
        </div>
        <StatusBadge status={status} />
      </div>

      <div className="timeline-steps-container">
        {steps.map((step, idx) => {
          const StepIcon = step.icon;

          let stepStateClass = "is-upcoming";
          if (step.isClaimedStep) stepStateClass = "is-claimed";
          else if (step.isCompleted) stepStateClass = "is-completed";
          else if (step.isInfoRequested) stepStateClass = "is-info-requested";
          else if (step.isCurrent) stepStateClass = "is-current";

          if (isRejected && idx === APPLICATION_STEPS.length - 2) {
            stepStateClass = "is-rejected";
          }

          return (
            <div key={step.key} className={`timeline-step ${stepStateClass}`}>
              <div className="timeline-step-indicator">
                <span className="timeline-step-circle">
                  {step.isClaimedStep ? (
                    <AnimatedCheckMark className="timeline-checkmark" />
                  ) : step.isCompleted || (isRejected && idx === APPLICATION_STEPS.length - 2) ? (
                    <CheckCircle2 size={16} aria-hidden="true" />
                  ) : (
                    <StepIcon size={15} aria-hidden="true" />
                  )}
                </span>
                {idx < steps.length - 1 && <span className="timeline-step-connector" />}
              </div>

              <div className="timeline-step-details">
                <strong className="timeline-step-label">{step.label}</strong>
                <p className="timeline-step-desc">{step.description}</p>
                {step.key === "submitted" && submittedAt && (
                  <span className="timeline-timestamp">
                    Submitted: {new Date(submittedAt).toLocaleDateString("en-PH")}
                  </span>
                )}
                {step.key === "approved" && reviewedAt && (step.isCompleted || step.isClaimedStep) && (
                  <span className="timeline-timestamp">
                    Approved: {new Date(reviewedAt).toLocaleDateString("en-PH")}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {remarks && (
        <div className="timeline-remarks-box">
          <strong>Reviewer Remarks:</strong>
          <p>{remarks}</p>
        </div>
      )}

      {verifications && verifications.length > 0 && (
        <div className="timeline-verifications-list">
          <h5 className="verifications-list-heading">Stage Verifications</h5>
          <div className="verifications-chips">
            {verifications.map((v) => (
              <div key={v.verification_type} className="verification-chip">
                <span className="chip-type">
                  {v.verification_type === "barangay"
                    ? "Barangay Residency"
                    : v.verification_type === "registrar"
                      ? "School Registrar"
                      : "LGU Admin"}
                </span>
                <StatusBadge status={v.status} type="verification" />
                {v.remarks && <small className="chip-remarks">"{v.remarks}"</small>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
