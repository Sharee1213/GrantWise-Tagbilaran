import React from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileQuestion,
  FileText,
  HelpCircle,
  Landmark,
  School,
  Send,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from "lucide-react";

/**
 * Base Application Status Presentation Strategy
 */
export class ApplicationStatusStrategy {
  constructor({
    key,
    label,
    variant,
    icon: Icon,
    stepIndex,
    description,
    isTerminal = false,
  }) {
    this.key = key;
    this.label = label;
    this.variant = variant; // 'success' | 'warning' | 'danger' | 'info' | 'neutral'
    this.Icon = Icon;
    this.stepIndex = stepIndex;
    this.description = description;
    this.isTerminal = isTerminal;
  }

  getBadgeProps() {
    return {
      label: this.label,
      variant: this.variant,
      icon: this.Icon,
      description: this.description,
    };
  }
}

const APPLICATION_STATUS_MAP = {
  draft: new ApplicationStatusStrategy({
    key: "draft",
    label: "Draft",
    variant: "neutral",
    icon: FileText,
    stepIndex: 0,
    description: "Application is being drafted and has not yet been submitted.",
  }),
  submitted: new ApplicationStatusStrategy({
    key: "submitted",
    label: "Submitted",
    variant: "info",
    icon: Send,
    stepIndex: 1,
    description: "Application received. Waiting for verification pipeline to activate.",
  }),
  barangay_verification: new ApplicationStatusStrategy({
    key: "barangay_verification",
    label: "Barangay Verification",
    variant: "warning",
    icon: Clock,
    stepIndex: 2,
    description: "Assigned Barangay Coordinator is verifying residency and local credentials.",
  }),
  registrar_verification: new ApplicationStatusStrategy({
    key: "registrar_verification",
    label: "Registrar Verification",
    variant: "warning",
    icon: School,
    stepIndex: 3,
    description: "School Registrar is verifying enrollment, grades, and academic standing.",
  }),
  lgu_review: new ApplicationStatusStrategy({
    key: "lgu_review",
    label: "LGU Final Review",
    variant: "info",
    icon: Landmark,
    stepIndex: 4,
    description: "Authorized LGU Program Admin is performing final funding and award review.",
  }),
  approved: new ApplicationStatusStrategy({
    key: "approved",
    label: "Award Approved",
    variant: "success",
    icon: CheckCircle2,
    stepIndex: 5,
    description: "Application approved and grant funds committed to the scholar.",
    isTerminal: true,
  }),
  rejected: new ApplicationStatusStrategy({
    key: "rejected",
    label: "Application Not Approved",
    variant: "danger",
    icon: XCircle,
    stepIndex: -1,
    description: "Application did not meet program guidelines or available quotas.",
    isTerminal: true,
  }),
  withdrawn: new ApplicationStatusStrategy({
    key: "withdrawn",
    label: "Withdrawn",
    variant: "neutral",
    icon: AlertCircle,
    stepIndex: -1,
    description: "Application was withdrawn by the applicant or program administrator.",
    isTerminal: true,
  }),
};

export function getApplicationStatusPresenter(status) {
  const normalized = String(status || "").toLowerCase().trim();
  if (APPLICATION_STATUS_MAP[normalized]) {
    return APPLICATION_STATUS_MAP[normalized];
  }
  return new ApplicationStatusStrategy({
    key: normalized,
    label: normalized.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase()) || "Unknown",
    variant: "neutral",
    icon: HelpCircle,
    stepIndex: 0,
    description: "Status state is not recognized.",
  });
}

/**
 * Verification Task Status Strategy (Application_Verifications)
 */
export class VerificationStatusStrategy {
  constructor({ key, label, variant, icon: Icon, description }) {
    this.key = key;
    this.label = label;
    this.variant = variant;
    this.Icon = Icon;
    this.description = description;
  }
}

const VERIFICATION_STATUS_MAP = {
  pending: new VerificationStatusStrategy({
    key: "pending",
    label: "Pending Verification",
    variant: "warning",
    icon: Clock,
    description: "Awaiting staff review and decision.",
  }),
  approved: new VerificationStatusStrategy({
    key: "approved",
    label: "Verified & Endorsed",
    variant: "success",
    icon: CheckCircle2,
    description: "Staff reviewer has verified and endorsed this record.",
  }),
  rejected: new VerificationStatusStrategy({
    key: "rejected",
    label: "Verification Rejected",
    variant: "danger",
    icon: XCircle,
    description: "Staff reviewer rejected the applicant credentials.",
  }),
  needs_information: new VerificationStatusStrategy({
    key: "needs_information",
    label: "Needs Information",
    variant: "warning",
    icon: FileQuestion,
    description: "Additional supporting documentation or clarification required.",
  }),
};

export function getVerificationStatusPresenter(status) {
  const normalized = String(status || "").toLowerCase().trim();
  return (
    VERIFICATION_STATUS_MAP[normalized] ||
    new VerificationStatusStrategy({
      key: normalized,
      label: normalized.replaceAll("_", " "),
      variant: "neutral",
      icon: HelpCircle,
      description: "Unknown verification status.",
    })
  );
}

/**
 * Duplicate Scholarship Check Status Strategy (Funding_Duplicate_Checks)
 */
export class DuplicateCheckStrategy {
  constructor({ key, label, variant, icon: Icon, description, requiresAction }) {
    this.key = key;
    this.label = label;
    this.variant = variant;
    this.Icon = Icon;
    this.description = description;
    this.requiresAction = requiresAction;
  }
}

const DUPLICATE_CHECK_MAP = {
  no_duplicate: new DuplicateCheckStrategy({
    key: "no_duplicate",
    label: "No Duplicate Detected",
    variant: "success",
    icon: ShieldCheck,
    description: "Cross-unit check cleared. No overlapping active grants found for this cycle.",
    requiresAction: false,
  }),
  possible_duplicate: new DuplicateCheckStrategy({
    key: "possible_duplicate",
    label: "Possible Duplicate Detected",
    variant: "warning",
    icon: AlertTriangle,
    description: "Potential matching records in other funding units or external lists require review.",
    requiresAction: true,
  }),
  confirmed_duplicate: new DuplicateCheckStrategy({
    key: "confirmed_duplicate",
    label: "Confirmed Duplicate Grant",
    variant: "danger",
    icon: ShieldAlert,
    description: "Scholar has already received an authorized allocation in this cycle.",
    requiresAction: true,
  }),
};

export function getDuplicateCheckPresenter(result) {
  const normalized = String(result || "").toLowerCase().trim();
  return (
    DUPLICATE_CHECK_MAP[normalized] ||
    new DuplicateCheckStrategy({
      key: "not_checked",
      label: "Check Pending",
      variant: "neutral",
      icon: Clock,
      description: "Duplicate check has not been run for this application.",
      requiresAction: false,
    })
  );
}

/**
 * Disbursement Status Strategy
 */
const DISBURSEMENT_STATUS_MAP = {
  pending: { label: "Pending", variant: "neutral", icon: Clock },
  eligible: { label: "Eligible for Release", variant: "info", icon: CheckCircle2 },
  released: { label: "Funds Released", variant: "success", icon: CheckCircle2 },
  cancelled: { label: "Cancelled", variant: "danger", icon: XCircle },
};

export function getDisbursementStatusPresenter(status) {
  const normalized = String(status || "").toLowerCase().trim();
  return (
    DISBURSEMENT_STATUS_MAP[normalized] || {
      label: normalized.replaceAll("_", " "),
      variant: "neutral",
      icon: HelpCircle,
    }
  );
}
