import React from "react";
import { useState } from "react";
import { AlertCircle, CheckCircle2, LoaderCircle, Wifi } from "lucide-react";
import { getApiHealth } from "../services/api.js";

export default function StatusPage() {
  const [status, setStatus] = useState({ state: "idle", message: "" });

  async function checkConnection() {
    setStatus({ state: "loading", message: "" });

    try {
      const result = await getApiHealth();
      setStatus({
        state: "success",
        message: result.message || "The GrantWise API is reachable.",
      });
    } catch (error) {
      setStatus({
        state: "error",
        message: error.message || "Unable to reach the GrantWise API.",
      });
    }
  }

  const StatusIcon =
    status.state === "loading"
      ? LoaderCircle
      : status.state === "success"
        ? CheckCircle2
        : status.state === "error"
          ? AlertCircle
          : Wifi;

  return (
    <section className="status-page page-container">
      <p className="eyebrow">SERVICE INFORMATION</p>
      <h1>System status</h1>
      <p className="status-intro">
        Check whether the existing GrantWise API is reachable. This check does
        not test database health or sign in to an account.
      </p>

      <div className={`status-card status-${status.state}`} aria-live="polite">
        <span className="status-icon">
          <StatusIcon
            size={22}
            className={status.state === "loading" ? "spin" : ""}
            aria-hidden="true"
          />
        </span>
        <div className="status-copy">
          <strong>
            {status.state === "success"
              ? "API reachable"
              : status.state === "error"
                ? "API unavailable"
                : status.state === "loading"
                  ? "Checking connection"
                  : "Connection not checked"}
          </strong>
          <p>
            {status.message ||
              "The check uses the configured VITE_API_BASE_URL origin."}
          </p>
        </div>
      </div>

      <button
        className="button button-primary status-button"
        onClick={checkConnection}
        disabled={status.state === "loading"}
        type="button"
      >
        {status.state === "loading" ? "Checking..." : "Check API connection"}
      </button>

      <div className="capability-note">
        <strong>Current integration scope</strong>
        <p>
          This page checks only the existing API root. A database connectivity
          test route exists but is not called here. Authentication and
          application-management endpoints have not been implemented.
        </p>
      </div>
    </section>
  );
}
