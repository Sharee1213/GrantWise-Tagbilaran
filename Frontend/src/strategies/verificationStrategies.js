/**
 * Base Verification Action Strategy
 * Defines the contract that all role-specific verification workflows must fulfill.
 */
export class VerificationStrategy {
  constructor(roleName, verificationType, basePath) {
    this.roleName = roleName;
    this.verificationType = verificationType;
    this.basePath = basePath;
  }

  /**
   * Return allowed status choices for this verification role.
   */
  getAllowedDecisions() {
    return [
      { value: "approved", label: "Approve & Endorse", variant: "success" },
      { value: "needs_information", label: "Request Information", variant: "warning" },
      { value: "rejected", label: "Reject Application", variant: "danger" },
    ];
  }

  /**
   * Validate decision input client-side before dispatching to backend.
   */
  validateDecision(status, remarks, extraData = {}) {
    const errors = {};
    if (!status) {
      errors.status = "Please choose a decision.";
    }
    if ((status === "needs_information" || status === "rejected") && (!remarks || !remarks.trim())) {
      errors.remarks = `Remarks are required when selecting '${status.replaceAll("_", " ")}'.`;
    }
    return errors;
  }

  /**
   * Submit verification decision to the authoritative backend endpoint.
   */
  async submitDecision(apiRequest, verificationId, decision) {
    return apiRequest(`${this.basePath}/verifications/${verificationId}`, {
      method: "PATCH",
      body: JSON.stringify(decision),
    });
  }

  supportsAcademicRecords() {
    return false;
  }

  supportsAwardReservation() {
    return false;
  }
}

/**
 * Concrete Barangay Coordinator Verification Strategy
 * Scoped to applicant residency and local barangay certificates.
 */
export class BarangayVerificationStrategy extends VerificationStrategy {
  constructor() {
    super("Barangay Coordinator", "barangay", "coordinator");
  }

  getVerificationScopeNote() {
    return "Verify applicant residency within your assigned barangay and ensure authentic barangay clearance or certificate of indigency.";
  }
}

/**
 * Concrete School Registrar Verification Strategy
 * Scoped to student enrollment, GPA records, and academic standing.
 */
export class RegistrarVerificationStrategy extends VerificationStrategy {
  constructor() {
    super("Registrar", "registrar", "registrar");
  }

  supportsAcademicRecords() {
    return true;
  }

  getVerificationScopeNote() {
    return "Verify enrolled curriculum, GPA compliance, and official registration status at your assigned institution.";
  }

  async submitGradeReport(apiRequest, applicationId, gradeData) {
    return apiRequest(`registrar/applications/${applicationId}/grade-reports`, {
      method: "POST",
      body: JSON.stringify(gradeData),
    });
  }

  async submitEligibilityCheck(apiRequest, applicationId, checkData) {
    return apiRequest(`registrar/applications/${applicationId}/eligibility-checks`, {
      method: "POST",
      body: JSON.stringify(checkData),
    });
  }
}

/**
 * Concrete LGU Admin Verification Strategy
 * Scoped to funding unit programs, budget reservations, and award approvals.
 */
export class LguVerificationStrategy extends VerificationStrategy {
  constructor() {
    super("LGU Admin", "lgu", "admin");
  }

  supportsAwardReservation() {
    return true;
  }

  getVerificationScopeNote() {
    return "Perform final program validation, verify cross-unit duplicate check results, and commit authoritative scholarship award amount.";
  }

  validateDecision(status, remarks, extraData = {}) {
    const errors = super.validateDecision(status, remarks, extraData);
    if (status === "approved") {
      const amount = Number(extraData.awardAmount);
      if (!amount || amount <= 0 || Number.isNaN(amount)) {
        errors.awardAmount = "Award amount is required and must be greater than ₱0.";
      }
    }
    return errors;
  }

  async submitDecision(apiRequest, verificationId, { status, remarks, awardAmount }) {
    const payload = { status, remarks: remarks || null };
    if (status === "approved" && awardAmount) {
      payload.awardAmount = Number(awardAmount);
    }
    return apiRequest(`admin/verifications/${verificationId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  }
}

export function getVerificationStrategyForRole(role) {
  if (role === "Barangay Coordinator") return new BarangayVerificationStrategy();
  if (role === "Registrar" || role === "School Registrar") return new RegistrarVerificationStrategy();
  if (role === "LGU Admin") return new LguVerificationStrategy();
  return new VerificationStrategy(role, "unknown", "");
}
