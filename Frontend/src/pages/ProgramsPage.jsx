import React from "react";
import { ArrowRight, CalendarDays, Landmark, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import FeatureUnavailable from "../components/FeatureUnavailable.jsx";
import PageHeading from "../components/PageHeading.jsx";

const supportedConcepts = [
  {
    icon: Landmark,
    title: "Funding units",
    description:
      "The schema supports programs associated with a funding unit. Program records are not currently served by a public API.",
  },
  {
    icon: CalendarDays,
    title: "Funding cycles",
    description:
      "Programs can be linked to funding cycles. No current cycle dates or open application windows are exposed.",
  },
  {
    icon: ShieldCheck,
    title: "Eligibility review",
    description:
      "Eligibility checks are part of the data model, but program-specific eligibility rules are not published by the API.",
  },
];

export default function ProgramsPage() {
  return (
    <div className="page-container information-page">
      <PageHeading
        eyebrow="SCHOLARSHIP PROGRAMS"
        title="Find the right opportunity."
        description="This page is prepared for the GrantWise program catalog. Published funding programs, schedules, budgets, and eligibility requirements are not available through the current backend APIs."
      />

      <FeatureUnavailable
        title="Live program listings are not available yet."
        description="No application-program endpoint has been implemented. This is an availability notice, not an indication that there are currently zero programs."
      />

      <section className="information-section">
        <div className="section-heading compact-heading">
          <div>
            <p className="eyebrow">HOW THE CATALOG IS DESIGNED</p>
            <h2>What the system is being prepared to show.</h2>
          </div>
        </div>
        <div className="pillar-grid">
          {supportedConcepts.map(({ icon: Icon, title, description }) => (
            <article className="pillar-card" key={title}>
              <div className="pillar-card-top">
                <span className="pillar-icon">
                  <Icon size={20} aria-hidden="true" />
                </span>
              </div>
              <h3>{title}</h3>
              <p>{description}</p>
            </article>
          ))}
        </div>
      </section>

      <div className="page-callout">
        <p>
          Check official City announcements for current programs and deadlines.
          GrantWise does not publish or accept program applications yet.
        </p>
        <Link className="text-link" to="/application-guide">
          Read application guidance
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
