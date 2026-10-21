import React, { useEffect, useRef, useState } from "react";
import { Check, Laptop, Moon, Sun } from "lucide-react";
import { useTheme } from "../context/ThemeContext.jsx";

const THEME_OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Laptop },
];

export default function ThemeToggle({ className = "", compact = false }) {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const CurrentIcon = resolvedTheme === "dark" ? Moon : Sun;

  if (compact) {
    // Quick toggle between light & dark, or cycle
    return (
      <button
        type="button"
        className={`theme-toggle-btn ${className}`}
        onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        title={`Current mode: ${theme} (${resolvedTheme}). Click to toggle.`}
        aria-label={`Switch to ${resolvedTheme === "dark" ? "light" : "dark"} mode`}
      >
        <CurrentIcon size={16} aria-hidden="true" />
      </button>
    );
  }

  return (
    <div className={`theme-toggle-container ${className}`} ref={containerRef}>
      <button
        type="button"
        className="theme-toggle-btn"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={`Select theme, current theme is ${theme}`}
        title={`Theme: ${theme}`}
      >
        <CurrentIcon size={16} aria-hidden="true" />
        <span className="theme-toggle-label">{theme}</span>
      </button>

      {isOpen && (
        <div className="theme-dropdown-menu" role="listbox" aria-label="Theme options">
          {THEME_OPTIONS.map(({ value, label, icon: Icon }) => {
            const isSelected = theme === value;
            return (
              <button
                key={value}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`theme-dropdown-item ${isSelected ? "is-selected" : ""}`}
                onClick={() => {
                  setTheme(value);
                  setIsOpen(false);
                }}
              >
                <Icon size={15} aria-hidden="true" />
                <span>{label}</span>
                {isSelected && <Check size={14} className="theme-check-icon" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
