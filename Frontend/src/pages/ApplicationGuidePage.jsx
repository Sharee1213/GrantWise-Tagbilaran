import React, { useEffect, useState } from "react";
import { ArrowRight, Check, FileText, Info, School } from "lucide-react";
import { Link } from "react-router-dom";
import PageHeading from "../components/PageHeading.jsx";
import { apiRequest } from "../services/api.js";

const preparationItems = [
  "Read the official notice for the specific scholarship or grant.",
  "Confirm the published eligibility rules, application dates, and document list.",
  "Prepare accurate student and school information required by that program.",
  "Keep copies of documents requested in the official notice.",
];

export default function ApplicationGuidePage() {
  const [submissionState, setSubmissionState] = useState({
    status: "loading",
    message: "",
  });

  useEffect(() => {
    let active = true;
    apiRequest("programs")
      .then((data) => {
        if (active) {
          setSubmissionState({
            status: data.applicationSubmissionEnabled ? "available" : "unavailable",
            message: "",
          });
        }
      })
      .catch((error) => {
        if (active) {
          setSubmissionState({
            status: "error",
            message: error.message || "Could not check application availability.",
          });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="page-container information-page">
      <PageHeading
        eyebrow="APPLICATION INSTRUCTIONS"
        title="Prepare with confidence."
        description="Use the current official program notice as the source of truth. Application availability depends on an open program and a ready submission workflow."
      />

      <div className="guide-callout">
        <Info size={20} aria-hidden="true" />
        <p>
          Requirements, deadlines, and required documents vary by program.
          GrantWise does not currently publish the authoritative requirements
          for any specific program.
        </p>
      </div>

      <section className="instruction-layout" aria-labelledby="prepare-heading">
        <div className="instruction-main">
          <p className="eyebrow">BEFORE YOU APPLY</p>
          <h2 id="prepare-heading">A practical preparation checklist.</h2>
          <ul className="checklist">
            {preparationItems.map((item) => (
              <li key={item}>
                <span>
                  <Check size={15} aria-hidden="true" />
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>
        <aside className="instruction-aside">
          <span className="aside-icon">
            <School size={21} aria-hidden="true" />
          </span>
          <h3>Information may be requested</h3>
          <p>
            The application data model includes student, school, course,
            year-level, and barangay details. This does not mean every program
            uses the same eligibility criteria.
          </p>
        </aside>
      </section>

      <div className="guide-callout">
        <Info size={20} aria-hidden="true" />
        <p>
          {submissionState.status === "loading"
            ? "Checking whether online submission is available..."
            : submissionState.status === "available"
              ? "Online submission is available for programs marked open. GrantWise does not support document uploads or store program-specific eligibility rules."
              : submissionState.status === "error"
                ? `Could not check online submission availability. ${submissionState.message}`
                : "Online submission is unavailable for the currently configured database. No application can be submitted until its required workflow is installed."}{" "}
          Confirm program requirements with the funding unit.
        </p>
      </div>

      <div className="page-actions">
        <Link className="button button-primary" to="/programs">
          View open programs
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
        <Link className="text-link" to="/login">
          Student sign in
          <FileText size={15} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
