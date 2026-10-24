import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getNewPasswordError,
  getPasswordStrength,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "../src/services/passwordPolicy.js";

test("accepts passphrases with spaces and symbols without requiring character mixes", () => {
  assert.equal(getNewPasswordError("long passphrase!"), "");
});

test("requires 12 through 128 characters and rejects whitespace-only passwords", () => {
  assert.match(getNewPasswordError("short"), /at least 12 characters/);
  assert.match(
    getNewPasswordError("x".repeat(PASSWORD_MAX_LENGTH + 1)),
    /128 characters or fewer/,
  );
  assert.match(getNewPasswordError(" ".repeat(PASSWORD_MIN_LENGTH)), /whitespace/);
  assert.equal(getNewPasswordError("x".repeat(PASSWORD_MIN_LENGTH)), "");
});

test("provides a local, length-based strength estimate", () => {
  assert.equal(getPasswordStrength("").value, 0);
  assert.equal(getPasswordStrength("weak").label, "Weak");
  assert.equal(getPasswordStrength("x".repeat(16)).label, "Good");
  assert.equal(getPasswordStrength("x".repeat(24)).label, "Strong");
});
