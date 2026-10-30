import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, CheckCircle2, Eye, EyeOff, Lock } from "lucide-react";
import ModalDialog from "./ModalDialog.jsx";
import PasswordGuidance from "./PasswordGuidance.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { apiRequest } from "../services/api.js";
import { getNewPasswordError } from "../services/passwordPolicy.js";

const EMPTY_FORM = {
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
};

export default function ChangePasswordDialog({ isOpen, onClose }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [showPasswords, setShowPasswords] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const closeTimer = useRef(null);
  const { addToast } = useToast();

  // Start clean every time the dialog opens.
  useEffect(() => {
    if (isOpen) {
      setForm(EMPTY_FORM);
      setShowPasswords(false);
      setFieldErrors({});
      setError("");
      setSuccess("");
      setSaving(false);
    }
    return () => clearTimeout(closeTimer.current);
  }, [isOpen]);

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    if (fieldErrors[name])
      setFieldErrors((current) => ({ ...current, [name]: "" }));
    if (error) setError("");
  }

  function validate() {
    const errors = {};
    if (!form.currentPassword)
      errors.currentPassword = "Enter your current password.";
    const newError = getNewPasswordError(form.newPassword);
    if (newError) errors.newPassword = newError;
    else if (form.newPassword === form.currentPassword) {
      errors.newPassword =
        "New password must be different from your current password.";
    }
    if (!form.confirmPassword)
      errors.confirmPassword = "Confirm your new password.";
    else if (form.confirmPassword !== form.newPassword) {
      errors.confirmPassword = "Passwords do not match.";
    }
    return errors;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (saving || success) return;

    const errors = validate();
    setFieldErrors(errors);
    setError("");
    if (Object.keys(errors).length > 0) return;

    setSaving(true);
    try {
      const result = await apiRequest("auth/change-password", {
        method: "POST",
        body: JSON.stringify(form),
      });
      const successMessage = result?.message || "Password updated.";
      setForm(EMPTY_FORM);
      setSuccess(successMessage);
      addToast({
        variant: "success",
        title: "Password updated",
        message: successMessage,
      });
      closeTimer.current = setTimeout(onClose, 2000);
    } catch (requestError) {
      const apiErrors = {};
      for (const issue of requestError.fieldErrors || []) {
        if (issue?.field && issue?.message && !apiErrors[issue.field]) {
          apiErrors[issue.field] = issue.message;
        }
      }
      if (Object.keys(apiErrors).length > 0) setFieldErrors(apiErrors);
      setError(
        requestError.status === 429
          ? "Too many attempts. Please wait 15 minutes before trying again."
          : requestError.message || "Could not change your password.",
      );
    } finally {
      setSaving(false);
    }
  }

  const inputType = showPasswords ? "text" : "password";

  function renderField({ name, label, autoComplete }) {
    const message = fieldErrors[name];
    return (
      <div className="form-field">
        <label className="form-label" htmlFor={`change-${name}`}>
          {label}
        </label>
        <div className="input-with-icon">
          <Lock size={16} className="input-leading-icon" aria-hidden="true" />
          <input
            id={`change-${name}`}
            name={name}
            type={inputType}
            className={`form-input has-leading-icon has-trailing-action ${message ? "form-input-error" : ""}`}
            value={form[name]}
            onChange={handleChange}
            autoComplete={autoComplete}
            aria-invalid={Boolean(message)}
            aria-describedby={message ? `change-${name}-error` : undefined}
            disabled={saving || Boolean(success)}
            maxLength={128}
            required
          />
          <button
            type="button"
            className="password-toggle-btn"
            onClick={() => setShowPasswords((visible) => !visible)}
            aria-label={showPasswords ? "Hide passwords" : "Show passwords"}
            aria-pressed={showPasswords}
          >
            {showPasswords ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
          </button>
        </div>
        {message && (
          <p id={`change-${name}-error`} role="alert" className="field-error">
            {message}
          </p>
        )}
      </div>
    );
  }

  // Render into <body>: the top bar uses backdrop-filter, which would otherwise
  // trap this fixed-position modal inside the header and squash it.
  return createPortal(
    <ModalDialog
      isOpen={isOpen}
      onClose={saving ? () => {} : onClose}
      title="Change password"
      subtitle="Replace the password you were given with one only you know."
      maxWidth="max-w-md"
    >
      {success && (
        <div role="status" className="auth-banner auth-banner-success">
          <CheckCircle2 size={18} aria-hidden="true" />
          <div>
            <strong>Password changed</strong>
            <p>{success}</p>
          </div>
        </div>
      )}

      {error && (
        <div role="alert" className="auth-banner auth-banner-error">
          <AlertCircle size={18} aria-hidden="true" />
          <div>
            <strong>Unable to change password</strong>
            <p>{error}</p>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="auth-form" noValidate>
        {renderField({
          name: "currentPassword",
          label: "Current password",
          autoComplete: "current-password",
        })}
        {renderField({
          name: "newPassword",
          label: "New password",
          autoComplete: "new-password",
        })}
        <PasswordGuidance password={form.newPassword} />
        {renderField({
          name: "confirmPassword",
          label: "Confirm new password",
          autoComplete: "new-password",
        })}

        <button
          type="button"
          className="text-link"
          onClick={() => setShowPasswords((visible) => !visible)}
          aria-pressed={showPasswords}
        >
          {showPasswords ? (
            <EyeOff size={15} aria-hidden="true" />
          ) : (
            <Eye size={15} aria-hidden="true" />
          )}{" "}
          {showPasswords ? "Hide passwords" : "Show passwords"}
        </button>

        <div className="modal-actions">
          <button
            type="button"
            className="button button-outline"
            onClick={onClose}
            disabled={saving}
          >
            {success ? "Close" : "Cancel"}
          </button>
          <button
            type="submit"
            className="button button-primary"
            disabled={saving || Boolean(success)}
          >
            {saving ? "Saving..." : "Update password"}
          </button>
        </div>
      </form>
    </ModalDialog>,
    document.body,
  );
}
