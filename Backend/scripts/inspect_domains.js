const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const pool = require("../db");

async function checkDatabaseAccounts() {
  try {
    console.log("Querying database for candidate/blocked domains...");

    // 1. Query for candidate domains: ub.edu.ph, tcc.edu.ph, pmi-bohol.edu.ph
    const candidateQuery = `
      SELECT u.user_id, u.email, u.first_name, u.last_name, r.role_name, s.student_id, s.student_number, sch.school_name
      FROM "Users" u
      JOIN "Roles" r ON r.role_id = u.role_id
      LEFT JOIN "Students" s ON s.user_id = u.user_id
      LEFT JOIN "Schools" sch ON sch.school_id = s.school_id
      WHERE lower(u.email) LIKE '%@ub.edu.ph'
         OR lower(u.email) LIKE '%@tcc.edu.ph'
         OR lower(u.email) LIKE '%@pmi-bohol.edu.ph'
      ORDER BY u.user_id ASC;
    `;
    const candidateRes = await pool.query(candidateQuery);
    console.log("--- CANDIDATE/BLOCKED DOMAIN ACCOUNTS ---");
    console.log("Count:", candidateRes.rows.length);
    console.table(candidateRes.rows);

    // 2. Query all student accounts
    const allStudentsQuery = `
      SELECT u.user_id, u.email, u.first_name, u.last_name, s.student_id, s.student_number, sch.school_name,
             split_part(lower(u.email), '@', 2) as domain
      FROM "Users" u
      JOIN "Roles" r ON r.role_id = u.role_id
      LEFT JOIN "Students" s ON s.user_id = u.user_id
      LEFT JOIN "Schools" sch ON sch.school_id = s.school_id
      WHERE r.role_name = 'Scholar'
      ORDER BY domain, u.last_name;
    `;
    const allStudentsRes = await pool.query(allStudentsQuery);
    console.log("--- ALL SCHOLAR/STUDENT DOMAINS BREAKDOWN ---");
    const domainCounts = {};
    for (const row of allStudentsRes.rows) {
      domainCounts[row.domain] = (domainCounts[row.domain] || 0) + 1;
    }
    console.log("Domain Counts:", domainCounts);
    console.log("Total Students:", allStudentsRes.rows.length);

    // 3. Check for potential duplicate students (e.g. same student_number or same first/last name with different domains)
    const duplicatesQuery = `
      SELECT s.student_number, count(*) as count, array_agg(u.email) as emails, array_agg(u.user_id) as user_ids
      FROM "Students" s
      JOIN "Users" u ON u.user_id = s.user_id
      GROUP BY s.student_number
      HAVING count(*) > 1;
    `;
    const duplicatesRes = await pool.query(duplicatesQuery);
    console.log("--- DUPLICATE STUDENT NUMBERS ---");
    console.log("Count:", duplicatesRes.rows.length);
    if (duplicatesRes.rows.length > 0) {
      console.table(duplicatesRes.rows);
    }

    // Also check same first_name + last_name
    const nameDuplicatesQuery = `
      SELECT lower(u.first_name) as first_name, lower(u.last_name) as last_name, count(*) as count, array_agg(u.email) as emails
      FROM "Users" u
      JOIN "Roles" r ON r.role_id = u.role_id
      WHERE r.role_name = 'Scholar'
      GROUP BY lower(u.first_name), lower(u.last_name)
      HAVING count(*) > 1;
    `;
    const nameDuplicatesRes = await pool.query(nameDuplicatesQuery);
    console.log("--- DUPLICATE STUDENT NAMES ---");
    console.log("Count:", nameDuplicatesRes.rows.length);
    if (nameDuplicatesRes.rows.length > 0) {
      console.table(nameDuplicatesRes.rows);
    }

    // 4. Check School_Email_Domains table
    const schoolDomainsQuery = `
      SELECT d.domain_id, d.school_id, s.school_name, d.domain, d.domain_status, d.is_primary
      FROM "School_Email_Domains" d
      JOIN "Schools" s ON s.school_id = d.school_id
      ORDER BY d.school_id, d.is_primary DESC, d.domain;
    `;
    const schoolDomainsRes = await pool.query(schoolDomainsQuery);
    console.log("--- SCHOOL EMAIL DOMAINS IN DB ---");
    console.table(schoolDomainsRes.rows);

  } catch (err) {
    console.error("Error running query:", err);
  } finally {
    await pool.end();
  }
}

checkDatabaseAccounts();
