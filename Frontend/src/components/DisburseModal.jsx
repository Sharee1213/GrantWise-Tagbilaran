import React from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import ModalDialog from "./ModalDialog.jsx";
import { AnimatedCheckMark } from "./ToastRegion.jsx";
import { formatPhp } from "../services/format.js";

export default function DisburseModal({
  grant,
  notes,
  onNotesChange,
  error,
  busy,
  onClose,
  onConfirm,
}) {
  if (!grant) return null;

  return (
    <ModalDialog
      isOpen={Boolean(grant)}
      onClose={onClose}
      title="Disburse Cash Assistance"
      subtitle={`${grant.first_name} ${grant.last_name} · ${grant.program_name}`}
    >
      <div className="space-y-4">
        <div className="disburse-confirmation-badge" aria-hidden="true">
          <AnimatedCheckMark className="disburse-confirmation-check" />
        </div>
        <div className="p-4 rounded-xl bg-muted/40 border border-border space-y-2">
          <div className="flex justify-between items-center text-sm">
            <span className="text-muted">Student Name</span>
            <strong>{grant.first_name} {grant.last_name}</strong>
          </div>
          <div className="flex justify-between items-center text-sm">
            <span className="text-muted">School / Student ID</span>
            <span>{grant.school_name} ({grant.student_number || "N/A"})</span>
          </div>
          <div className="flex justify-between items-center text-sm">
            <span className="text-muted">Barangay Territory</span>
            <span className="font-medium">Brgy. {grant.barangay_name}</span>
          </div>
          <div className="border-t border-border pt-2 flex justify-between items-center">
            <span className="text-sm font-semibold">Grant Cash Amount</span>
            <span className="text-lg font-bold text-emerald-600">{formatPhp(grant.award_amount)}</span>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold">Verification & Identity Checklist</label>
          <div className="space-y-1 text-xs text-muted">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={14} className="text-emerald-500" />
              <span>Valid School Student ID or Government ID presented</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 size={14} className="text-emerald-500" />
              <span>Confirmed resident of Brgy. {grant.barangay_name}</span>
            </div>
          </div>
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="disburse-notes">
            Transaction / Acknowledgment Receipt Notes
          </label>
          <textarea
            id="disburse-notes"
            rows={3}
            placeholder="e.g. Student presented valid ID. Acknowledgment receipt signed."
            value={notes}
            onChange={(e) => onNotesChange(e.target.value)}
            className="form-input"
          />
        </div>

        {error && (
          <div className="staff-notice staff-notice-error" role="alert">
            <AlertCircle size={18} aria-hidden="true" />
            <div>
              <strong>{error.title}</strong>
              <p>{error.message}</p>
            </div>
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="button button-outline" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="button button-primary" onClick={onConfirm} disabled={busy}>
            {busy ? "Recording Handover..." : "Confirm Cash Handover"}
          </button>
        </div>
      </div>
    </ModalDialog>
  );
}
