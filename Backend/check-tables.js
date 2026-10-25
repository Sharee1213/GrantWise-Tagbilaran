const pool = require("./db");
require("dotenv").config();

const needed = [
  "Staff_Email_Authorizations",
  "School_Email_Domains",
  "Email_Verification_Tokens",
  "Audit_Logs",
  "Funding_Units",
  "LGU_Admins",
  "Barangay_Coordinators",
  "Registrars",
  "Schools",
  "Barangays",
];

(async () => {
  for (const t of needed) {
    const r = await pool.query("SELECT to_regclass($1) AS found", [`"${t}"`]);
    console.log(r.rows[0].found ? "OK      " : "MISSING ", t);
  }
  await pool.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
