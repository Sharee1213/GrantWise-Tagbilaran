import React, { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export default function ModalDialog({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  maxWidth = "max-w-2xl",
  className = "",
}) {
  const modalRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const [isClosing, setIsClosing] = useState(false);

  // Keep the latest onClose without re-running the focus effect on every render.
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      setIsClosing(false);
      return undefined;
    }

    setIsClosing(true);
    const closeTimer = window.setTimeout(() => {
      setIsClosing(false);
    }, 160);

    return () => clearTimeout(closeTimer);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const previouslyFocused = document.activeElement;
    const dialog = modalRef.current;

    // Move focus into the dialog (first focusable control, else the dialog itself).
    const focusables = dialog ? dialog.querySelectorAll(FOCUSABLE_SELECTOR) : [];
    const firstContentControl = Array.from(focusables).find(
      (el) => !el.classList.contains("modal-close-btn"),
    );
    (firstContentControl || focusables[0] || dialog)?.focus();

    function handleKeyDown(e) {
      if (e.key === "Escape") {
        onCloseRef.current?.();
        return;
      }
      if (e.key !== "Tab" || !dialog) return;

      const items = Array.from(dialog.querySelectorAll(FOCUSABLE_SELECTOR));
      if (items.length === 0) {
        e.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (!dialog.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      // Return focus to whatever opened the dialog.
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, [isOpen]);

  if (!isOpen && !isClosing) return null;

  return (
    <div
      className={`modal-backdrop ${isClosing ? "is-closing" : ""}`}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal-dialog ${maxWidth} ${className} ${isClosing ? "is-closing" : ""}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={modalRef}
      >
        <div className="modal-header">
          <div>
            <h2 id={titleId} className="modal-title">
              {title}
            </h2>
            {subtitle && <p className="modal-subtitle">{subtitle}</p>}
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="modal-content">{children}</div>
      </div>
    </div>
  );
}