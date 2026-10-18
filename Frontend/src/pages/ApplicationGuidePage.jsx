import React from "react";
import { ArrowRight, Check, FileText, Info, School } from "lucide-react";
import { Link } from "react-router-dom";
import FeatureUnavailable from "../components/FeatureUnavailable.jsx";
import PageHeading from "../components/PageHeading.jsx";

const preparationItems = [
  "Read the official notice for the specific scholarship or grant.",
  "Confirm the published eligibility rules, application dates, and document list.",
  "Prepare accurate student and school information required by that program.",
  "Keep copies of documents requested in the official notice.",
];

export default function ApplicationGuidePage() {
  return (
    <div className="page-container information-page">
      <PageHeading
        eyebrow="APPLICATION INSTRUCTIONS"
        title="Prepare with confidence."
        description="Use the current official program notice as the source of truth. This guide is informational only; online applications and document uploads are not available in GrantWise yet."
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

      <FeatureUnavailable
        title="Online submission is not connected."
        description="The backend does not yet provide registration, login, application creation, document-upload, or application-status endpoints. Do not send personal documents through this preview."
      />

      <div className="page-actions">
        <Link className="button button-primary" to="/programs">
          Program information
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
        <Link className="text-link" to="/login">
          Sign-in availability
          <FileText size={15} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
