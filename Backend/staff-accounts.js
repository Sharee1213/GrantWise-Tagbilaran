const STAFF_ACCOUNTS = Object.freeze([
  // ---- System Admins -> /portal/system-admin
  {
    email: "admin.marie@gmail.com",
    role: "System Admin",
    firstName: "Marie",
    lastName: "System Admin",
  },
  {
    email: "admin.ellaine@gmail.com",
    role: "System Admin",
    firstName: "Ellaine",
    lastName: "System Admin",
  },
  {
    email: "admin.angela@gmail.com",
    role: "System Admin",
    firstName: "Angela",
    lastName: "System Admin",
  },

  // ---- LGU Program Admin -> /portal/lgu-admin
  {
    email: "admin.tagbilarancitylgu@gmail.com",
    role: "LGU Admin",
    firstName: "Tagbilaran City LGU",
    lastName: "Program Admin",
    positionTitle: "LGU Program Administrator",
    scope: { name: "City Scholarship Office" },
  },

  // ---- Barangay Coordinators -> /portal/barangay-coordinator
  {
    email: "coordinator.barangaybool@gmail.com",
    role: "Barangay Coordinator",
    firstName: "Brgy. Bool",
    lastName: "Coordinator",
    positionTitle: "Barangay Education Coordinator",
    scope: { name: "Bool" },
  },
  {
    email: "coordinator.barangaycabawan@gmail.com",
    role: "Barangay Coordinator",
    firstName: "Brgy. Cabawan",
    lastName: "Coordinator",
    positionTitle: "Barangay Education Coordinator",
    scope: { name: "Cabawan" },
  },
  {
    email: "coordinator.barangaymanga@gmail.com",
    role: "Barangay Coordinator",
    firstName: "Brgy. Manga",
    lastName: "Coordinator",
    positionTitle: "Barangay Education Coordinator",
    scope: { name: "Manga" },
  },

  // ---- School Registrars -> /portal/school-registrar
  {
    email: "registar.holynameuniversity@gmail.com",
    role: "Registrar",
    firstName: "Holy Name University",
    lastName: "Registrar",
    positionTitle: "University Registrar",
    scope: { name: "Holy Name University" },
  },
  {
    email: "registar.tagbilarancitycollege@gmail.com",
    role: "Registrar",
    firstName: "Tagbilaran City College",
    lastName: "Registrar",
    positionTitle: "College Registrar",
    scope: { name: "Tagbilaran City College" },
  },
  {
    email: "registar.boholislandstateuniv@gmail.com",
    role: "Registrar",
    firstName: "BISU-Tagbilaran",
    lastName: "Registrar",
    positionTitle: "University Registrar",
    scope: { name: "BISU-Tagbilaran" },
  },
  {
    email: "registar.universityofbohol@gmail.com",
    role: "Registrar",
    firstName: "University of Bohol",
    lastName: "Registrar",
    positionTitle: "University Registrar",
    scope: { name: "University of Bohol" },
  },
]);

const STAFF_BY_EMAIL = new Map(
  STAFF_ACCOUNTS.map((account) => [account.email.toLowerCase(), account]),
);

function normalizeStaffEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function getStaffAccount(email) {
  return STAFF_BY_EMAIL.get(normalizeStaffEmail(email)) || null;
}

// True only when this exact email is whitelisted for exactly this role.
function isWhitelistedStaff(email, role) {
  const account = getStaffAccount(email);
  return Boolean(account && account.role === role);
}

const SYSTEM_ADMIN_EMAILS = Object.freeze(
  STAFF_ACCOUNTS.filter((a) => a.role === "System Admin").map((a) => a.email),
);

module.exports = {
  STAFF_ACCOUNTS,
  SYSTEM_ADMIN_EMAILS,
  getStaffAccount,
  isWhitelistedStaff,
  normalizeStaffEmail,
};
