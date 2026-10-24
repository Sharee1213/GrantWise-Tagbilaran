const assert = require("node:assert/strict");
const { test } = require("node:test");

const { formatFieldErrors, createApiError } = require("../lib/responseHelpers");

test("formatFieldErrors converts validation issues into a keyed object", () => {
  const result = formatFieldErrors([
    { field: "email", message: "Email is required." },
    { field: "password", message: "Password is required." },
    { field: "email", message: "Email is invalid." },
  ]);

  assert.deepEqual(result, {
    email: "Email is required.",
    password: "Password is required.",
  });
});

test("createApiError preserves structured validation payloads", () => {
  const result = createApiError("Validation failed.", 400, [
    { field: "email", message: "Email is required." },
  ]);

  assert.equal(result.status, 400);
  assert.equal(result.payload.message, "Validation failed.");
  assert.deepEqual(result.payload.errors, [
    { field: "email", message: "Email is required." },
  ]);
});
