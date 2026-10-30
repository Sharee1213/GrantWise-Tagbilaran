import React, { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { useToast } from "../context/ToastContext.jsx";

export function AnimatedCheckMark({ className = "" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={`animated-check ${className}`}
    >
      <path
        d="M5 12.5L9.2 16.7L19 6.9"
        stroke="currentColor"
        strokeWidth="2.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ToastItem({ toast, onClose }) {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!toast.duration || paused) return undefined;

    const timer = window.setTimeout(() => {
      onClose();
    }, toast.duration);

    return () => window.clearTimeout(timer);
  }, [onClose, paused, toast.duration]);

  const iconByVariant = {
    success: <AnimatedCheckMark className="toast-checkmark" />,
    error: <AlertCircle size={18} aria-hidden="true" />,
    info: <Info size={18} aria-hidden="true" />,
  };

  return (
    <div
      className={`toast toast-${toast.variant}`}
      role="status"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="toast-icon">{iconByVariant[toast.variant] || iconByVariant.info}</div>

      <div className="toast-copy">
        {toast.title && <strong className="toast-title">{toast.title}</strong>}
        {toast.message && <span className="toast-message">{toast.message}</span>}
      </div>

      <button
        type="button"
        className="toast-close-btn"
        onClick={onClose}
        aria-label="Dismiss notification"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

export default function ToastRegion() {
  const { toasts, dismissToast } = useToast();

  if (!toasts.length) return null;

  return (
    <div className="toast-region" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <ToastItem
          key={toast.id}
          toast={toast}
          onClose={() => dismissToast(toast.id)}
        />
      ))}
    </div>
  );
}
