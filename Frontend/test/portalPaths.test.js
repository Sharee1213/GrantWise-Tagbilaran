import test from "node:test";
import assert from "node:assert/strict";
import { getPortalPathForRole } from "../src/services/portalPaths.js";

test("returns the student portal and preserves a numeric program ID", () => {
  assert.equal(
    getPortalPathForRole("Scholar", "12"),
    "/portal/student?programId=12",
  );
});

test("does not include a non-numeric program ID", () => {
  assert.equal(getPortalPathForRole("Scholar", "abc"), "/portal/student");
});

test("returns the correct portal for staff roles", () => {
  assert.equal(getPortalPathForRole("System Admin"), "/portal/system-admin");
  assert.equal(getPortalPathForRole("LGU Admin"), "/portal/lgu-admin");
  assert.equal(
    getPortalPathForRole("Barangay Coordinator"),
    "/portal/barangay-coordinator",
  );
  assert.equal(getPortalPathForRole("Registrar"), "/portal/school-registrar");
});

test("uses a valid dashboard path for other roles", () => {
  assert.equal(
    getPortalPathForRole("Other Role", null, "/portal/custom"),
    "/portal/custom",
  );
});

test("falls back to the portals page for an unknown role", () => {
  assert.equal(getPortalPathForRole("Other Role"), "/portals");
});
