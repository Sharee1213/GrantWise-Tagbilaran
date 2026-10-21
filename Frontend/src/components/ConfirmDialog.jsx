import React from "react";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import ModalDialog from "./ModalDialog.jsx";

export default function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "danger", // 'danger' | 'warning' | 'primary'
  busy = false,
  children,
}) {
  const Icon = variant === "danger" ? AlertTriangle : variant === "warning" ? AlertTriangle : Info;

  return (
    <ModalDialog
      isOpen={isOpen}
      onClose={busy ? () => {} : onClose}
      title={title}
      maxWidth="max-w-md"
    >
      <div className="confirm-dialog-body">
        <div className={`confirm-icon-wrapper confirm-icon-${variant}`}>
          <Icon size={24} aria-hidden="true" />
        </div>
        <div className="confirm-text">
          <p className="confirm-message">{message}</p>
          {children}
        </div>
      </div>

      <div className="modal-actions">
        <button
          type="button"
          className="button button-outline"
          onClick={onClose}
          disabled={busy}
        >
          {cancelText}
        </button>
        <button
          type="button"
          className={`button ${variant === "danger" ? "button-danger" : "button-primary"}`}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? "Processing..." : confirmText}
        </button>
      </div>
    </ModalDialog>
  );
}
