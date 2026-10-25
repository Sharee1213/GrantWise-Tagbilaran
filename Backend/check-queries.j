require("dotenv").config();
const pool = require("./db");

const tests = [
  ["Funding_Units", `SELECT funding_unit_id, funding_unit_name, funding_unit_code, status FROM "Funding_Units"`],
  ["Barangays", `SELECT barangay_id, barangay_name FROM "Barangays"`],
  ["Schools", `SELECT school_id, school_name, is_approved FROM "Schools"`],
  ["School_Email_Domains", `SELECT sd.domain_id, sd.school_id, s.school_name, sd.domain, sd.domain_status, sd.is_primary, sd.notes, sd.updated_at FROM "School_Email_Domains" sd JOIN "Schools" s ON s.school_id = sd.school_id`],
  ["LGU_Admins", `SELECT u.user_id, admin.funding_unit_id, admin.is_active FROM "Users" u JOIN "LGU_Admins" admin ON admin.user_id = u.user_id JOIN "Funding_Units" unit ON unit.funding_unit_id = admin.funding_unit_id`],
  ["Barangay_Coordinators", `SELECT c.barangay_id, c.is_current, c.term_start, c.term_end FROM "Barangay_Coordinators" c`],
  ["Registrars", `SELECT r.user_id, r.school_id, r.is_active FROM "Registrars" r`],
  ["Staff_Email_Authorizations", `SELECT sa.authorization_id, sa.email, sa.role_name, sa.funding_unit_id, sa.barangay_id, sa.school_id, sa.position_title, sa.lgu_permissions, sa.status, sa.expires_at, sa.authorized_by, sa.authorized_at, sa.activated_user_id, sa.activated_at, sa.revoked_by, sa.revoked_at, sa.revocation_reason, sa.notes, sa.updated_at FROM "Staff_Email_Authorizations" sa`],
  ["Audit_Logs", `SELECT * FROM "Audit_Logs" LIMIT 1`],
];

(async () => {
  for (const [name, sql] of tests) {
    try {
      await pool.query(sql);
      console.log("OK     ", name);
    } catch (e) {
      console.log("FAILED ", name, "->", e.message);
    }
  }
  await pool.end();
})();