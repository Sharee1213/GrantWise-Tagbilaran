const DEFAULT_DEVELOPER_ALLOWLIST = Object.freeze([
    "cuevas.sharee_angela@hnu.edu.ph",
    "medrina.nina_marie@hnu.edu.ph",
    "palaca.szarina@hnu.edu.ph"
]);

const EXACT_ROLE_EMAIL_LOGIN_EXCEPTIONS = Object.freeze({
    "admin.marie@gmail.com": "System Admin",
    "admin.ellaine@gmail.com": "System Admin",
    "admin.angela@gmail.com": "System Admin",
    "admin.tagbilarancitylgu@gmail.com": "LGU Admin",
    "registar.holynameuniversity@gmail.com": "Registrar",
    "registar.tagbilarancitycollege@gmail.com": "Registrar",
    "registar.boholislandstateuniv@gmail.com": "Registrar",
    "registar.universityofbohol@gmail.com": "Registrar"
});

const LGU_PERMISSION_CATEGORIES = Object.freeze([
    {
        key: "read_only_reports",
        label: "Read-only reports & summaries",
        description: "View funding-unit dashboard summaries, program lists, and application reports."
    },
    {
        key: "program_management",
        label: "Funding-program management",
        description: "Create programs, update program status/dates, and manage barangay allocations within the assigned funding unit."
    },
    {
        key: "application_review",
        label: "Application review",
        description: "Review applications and record LGU review decisions (needs information / reject) within the assigned funding unit."
    },
    {
        key: "award_approval",
        label: "Award approval",
        description: "Approve applications and reserve scholarship awards against the funding unit and barangay budget."
    },
    {
        key: "disbursement_release",
        label: "Disbursement release",
        description: "Authorize disbursement releases under the approved financial workflow."
    }
]);

const DEFAULT_LGU_PERMISSIONS = Object.freeze({
    read_only_reports: true,
    program_management: true,
    application_review: true,
    award_approval: true,
    disbursement_release: false
});

// IMPORTANT: These are proposed development configuration templates only.
// They are NOT verified mailboxes and are never automatically created as active accounts.
const PROPOSED_LGU_OFFICIALS_DIRECTORY = Object.freeze([
    {
        positionTitle: "City Mayor",
        officialName: "Jane Censoria C. Yap",
        proposedEmail: "mayor.janeyap@admin.com",
        suggestedFundingUnitName: "City Scholarship Office",
        recommendedPermissions: ["read_only_reports"],
        verificationNote: "Placeholder identifier only. Confirm authorized office contact and minimum necessary permissions before inviting."
    },
    {
        positionTitle: "City Vice Mayor",
        officialName: "Adam Relson L. Jala",
        proposedEmail: "vice.mayor.adamjala@admin.com",
        suggestedFundingUnitName: "Sangguniang Panlungsod / District Fund",
        recommendedPermissions: ["read_only_reports"],
        verificationNote: "Placeholder identifier only. Confirm authorized office contact and minimum necessary permissions before inviting."
    },
    {
        positionTitle: "Congressman, 1st District of Bohol",
        officialName: "John Geesnell \"Baba\" Yap II",
        proposedEmail: "congressman.babayap@admin.com",
        suggestedFundingUnitName: "Sangguniang Panlungsod / District Fund",
        recommendedPermissions: ["read_only_reports"],
        verificationNote: "Placeholder identifier only. Confirm authorized office contact and minimum necessary permissions before inviting."
    },
    {
        positionTitle: "City Administrator",
        officialName: "Alvin Luis O. Acuzar",
        proposedEmail: "cityadmin.alvinacuzar@admin.com",
        suggestedFundingUnitName: "City Scholarship Office",
        recommendedPermissions: ["read_only_reports", "application_review"],
        verificationNote: "Placeholder identifier only. Confirm authorized office contact and minimum necessary permissions before inviting."
    },
    {
        positionTitle: "Scholarship Office",
        officialName: "Office account",
        proposedEmail: "scholarship.office@admin.com",
        suggestedFundingUnitName: "City Scholarship Office",
        recommendedPermissions: [
            "read_only_reports",
            "program_management",
            "application_review",
            "award_approval"
        ],
        verificationNote: "Placeholder identifier only. Confirm official City Scholarship Office mailbox before inviting."
    }
]);

const PROPOSED_BARANGAY_COORDINATOR_DIRECTORY = Object.freeze([
    { barangayName: "Taloto", proposedEmail: "coordinator.taloto@admin.com" },
    { barangayName: "Bool", proposedEmail: "coordinator.bool@admin.com" },
    { barangayName: "Booy", proposedEmail: "coordinator.booy@admin.com" },
    { barangayName: "Cabawan", proposedEmail: "coordinator.cabawan@admin.com" },
    { barangayName: "Cogon", proposedEmail: "coordinator.cogon@admin.com" },
    { barangayName: "Dao", proposedEmail: "coordinator.dao@admin.com" },
    { barangayName: "Dampas", proposedEmail: "coordinator.dampas@admin.com" },
    { barangayName: "Manga", proposedEmail: "coordinator.manga@admin.com" },
    { barangayName: "Mansasa", proposedEmail: "coordinator.mansasa@admin.com" },
    { barangayName: "Poblacion I", proposedEmail: "coordinator.poblacion1@admin.com" },
    { barangayName: "Poblacion II", proposedEmail: "coordinator.poblacion2@admin.com" },
    { barangayName: "Poblacion III", proposedEmail: "coordinator.poblacion3@admin.com" },
    { barangayName: "San Isidro", proposedEmail: "coordinator.sanisidro@admin.com" },
    { barangayName: "Tiptip", proposedEmail: "coordinator.tiptip@admin.com" },
    { barangayName: "Ubujan", proposedEmail: "coordinator.ubujan@admin.com" }
]);

const BLOCKED_CANDIDATE_SCHOOL_DOMAINS = Object.freeze(
    new Set(["ub.edu.ph", "tcc.edu.ph", "pmi-bohol.edu.ph"])
);

const CANDIDATE_DOMAIN_ERROR =
    "Your email domain is not an accepted official domain for this institution. Please use your school's approved institutional email address or contact the system administrator.";

const PROPOSED_SCHOOL_REGISTRAR_DIRECTORY = Object.freeze([
    {
        dbSchoolName: "Holy Name University",
        displayName: "Holy Name University (HNU)",
        proposedEmail: "registrar@hnu.edu.ph",
        candidateDomain: "hnu.edu.ph",
        defaultDomainStatus: "verified",
        intendedAccess: "HNU students only"
    },
    {
        dbSchoolName: "BISU-Tagbilaran",
        displayName: "Bohol Island State University (BISU), Tagbilaran",
        proposedEmail: "registrar@bisu.edu.ph",
        candidateDomain: "bisu.edu.ph",
        defaultDomainStatus: "verified",
        intendedAccess: "BISU students only"
    },
    {
        dbSchoolName: "University of Bohol",
        displayName: "University of Bohol (UB)",
        proposedEmail: "registrar@universityofbohol.edu.ph",
        candidateDomain: "universityofbohol.edu.ph",
        defaultDomainStatus: "verified",
        intendedAccess: "UB students only"
    },
    {
        dbSchoolName: "Tagbilaran City College",
        displayName: "Tagbilaran City College (TCC)",
        proposedEmail: "registrar@tagbilarancitycollege.edu.ph",
        candidateDomain: "tagbilarancitycollege.edu.ph",
        defaultDomainStatus: "verified",
        intendedAccess: "TCC students only"
    },
    {
        dbSchoolName: "PMI Colleges Main Branch",
        displayName: "PMI Colleges–Bohol",
        proposedEmail: "registrar@pmicollegesbohol.edu.ph",
        candidateDomain: "pmicollegesbohol.edu.ph",
        defaultDomainStatus: "verified",
        intendedAccess: "PMI students only"
    }
]);

const DEFAULT_SCHOOL_DOMAIN_BY_ID = Object.freeze({
    1: ["hnu.edu.ph"],
    2: ["bisu.edu.ph"],
    3: ["universityofbohol.edu.ph"],
    4: ["tagbilarancitycollege.edu.ph"],
    5: ["pmicollegesbohol.edu.ph"]
});

const DEFAULT_SCHOOL_DOMAIN_BY_NAME = Object.freeze({
    "holy name university": { domain: ["hnu.edu.ph"], status: "verified" },
    "bisu-tagbilaran": { domain: ["bisu.edu.ph"], status: "verified" },
    "university of bohol": { domain: ["universityofbohol.edu.ph"], status: "verified" },
    "tagbilaran city college": { domain: ["tagbilarancitycollege.edu.ph"], status: "verified" },
    "pmi colleges main branch": { domain: ["pmicollegesbohol.edu.ph"], status: "verified" }
});

module.exports = {
    DEFAULT_DEVELOPER_ALLOWLIST,
    EXACT_ROLE_EMAIL_LOGIN_EXCEPTIONS,
    LGU_PERMISSION_CATEGORIES,
    DEFAULT_LGU_PERMISSIONS,
    PROPOSED_LGU_OFFICIALS_DIRECTORY,
    PROPOSED_BARANGAY_COORDINATOR_DIRECTORY,
    PROPOSED_SCHOOL_REGISTRAR_DIRECTORY,
    DEFAULT_SCHOOL_DOMAIN_BY_ID,
    DEFAULT_SCHOOL_DOMAIN_BY_NAME,
    BLOCKED_CANDIDATE_SCHOOL_DOMAINS,
    CANDIDATE_DOMAIN_ERROR
};
