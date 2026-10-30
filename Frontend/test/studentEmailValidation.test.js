import test from "node:test";
import assert from "node:assert/strict";
import {
  isAllowedStudentEmail,
  BLOCKED_CANDIDATE_DOMAINS,
  APPROVED_SCHOOL_DOMAINS,
  CANDIDATE_DOMAIN_ERROR,
} from "../src/services/studentEmailPolicy.js";

test("isAllowedStudentEmail accepts 5 official institutional domains and personal gmail", () => {
  const allowed = [
    "student@hnu.edu.ph",
    "scholar@bisu.edu.ph",
    "student@universityofbohol.edu.ph",
    "student@tagbilarancitycollege.edu.ph",
    "student@pmicollegesbohol.edu.ph",
    "student@gmail.com",
    "STUDENT@HNU.EDU.PH",
    "  scholar@bisu.edu.ph  ",
  ];

  for (const email of allowed) {
    assert.equal(isAllowedStudentEmail(email), true, `Expected ${email} to be allowed`);
  }
});

test("isAllowedStudentEmail strictly rejects candidate domains and generic edu domains", () => {
  const rejected = [
    "student@ub.edu.ph",
    "student@tcc.edu.ph",
    "student@pmi-bohol.edu.ph",
    "student@yahoo.com",
    "student@outlook.com",
    "student@somewhere.edu.ph",
    "student@othercollege.edu",
    "student@hnu.edu.ph.attacker.com",
    "student@tagbilaran.gov.ph",
  ];

  for (const email of rejected) {
    assert.equal(isAllowedStudentEmail(email), false, `Expected ${email} to be rejected`);
  }
});

test("BLOCKED_CANDIDATE_DOMAINS contains ub.edu.ph, tcc.edu.ph, and pmi-bohol.edu.ph", () => {
  assert.equal(BLOCKED_CANDIDATE_DOMAINS.has("ub.edu.ph"), true);
  assert.equal(BLOCKED_CANDIDATE_DOMAINS.has("tcc.edu.ph"), true);
  assert.equal(BLOCKED_CANDIDATE_DOMAINS.has("pmi-bohol.edu.ph"), true);
  assert.equal(BLOCKED_CANDIDATE_DOMAINS.size, 3);
});

test("CANDIDATE_DOMAIN_ERROR matches exact required security prompt message", () => {
  assert.equal(
    CANDIDATE_DOMAIN_ERROR,
    "Your email domain is not an accepted official domain for this institution. Please use your school's approved institutional email address or contact the system administrator.",
  );
});
