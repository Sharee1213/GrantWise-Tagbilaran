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

const WORKFLOW_STEPS = [
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
  {
    key: "barangay_verification",
    label: "Barangay Verification",
    description: "Barangay Coordinator verifies applicant residency.",
    icon: Clock,
  },
  {
    key: "registrar_verification",
    label: "Registrar Verification",
    description: "School Registrar verifies academic enrollment and standing.",
    icon: School,
  },
  {
    key: "lgu_review",
    label: "LGU Final Review",
    description: "LGU Admin verifies duplicate grant checks and quota limits.",
    icon: Landmark,
  },
  {
    key: "approved",
    label: "Award Approved & Reserved",
    description: "Scholarship approved; fund allocation committed.",
    icon: CheckCircle2,
  },
];

function getActiveStepIndex(status) {
  const norm = String(status || "").toLowerCase().trim();
  switch (norm) {
    case "draft":
      return 0;
    case "submitted":
      return 1;
    case "barangay_verification":
      return 2;
    case "registrar_verification":
      return 3;
    case "lgu_review":
      return 4;
    case "approved":
      return 5;
    case "rejected":
    case "withdrawn":
      return -1;
    default:
      return 1;
  }
}

export default function ApplicationTimeline({
  status = "draft",
  submittedAt,
  reviewedAt,
  remarks,
  verifications = [],
  className = "",
}) {
  const activeStep = getActiveStepIndex(status);
  const isRejected = status === "rejected";
  const isWithdrawn = status === "withdrawn";

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
        {WORKFLOW_STEPS.map((step, idx) => {
          const isCompleted = activeStep > idx || activeStep === 5;
          const isCurrent = activeStep === idx;
          const StepIcon = step.icon;

          let stepStateClass = "is-upcoming";
          if (isCompleted) stepStateClass = "is-completed";
          else if (isCurrent) stepStateClass = "is-current";

          if (isRejected && activeStep === -1 && idx === 4) {
            stepStateClass = "is-rejected";
          }

          return (
            <div key={step.key} className={`timeline-step ${stepStateClass}`}>
              <div className="timeline-step-indicator">
                <span className="timeline-step-circle">
                  {isCompleted ? (
                    <CheckCircle2 size={16} aria-hidden="true" />
                  ) : (
                    <StepIcon size={15} aria-hidden="true" />
                  )}
                </span>
                {idx < WORKFLOW_STEPS.length - 1 && <span className="timeline-step-connector" />}
              </div>

              <div className="timeline-step-details">
                <strong className="timeline-step-label">{step.label}</strong>
                <p className="timeline-step-desc">{step.description}</p>
                {step.key === "submitted" && submittedAt && (
                  <span className="timeline-timestamp">
                    Submitted: {new Date(submittedAt).toLocaleDateString("en-PH")}
                  </span>
                )}
                {step.key === "approved" && reviewedAt && isCompleted && (
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
