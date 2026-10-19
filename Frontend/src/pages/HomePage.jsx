import React from "react";
import {
  ArrowRight,
  BadgeCheck,
  BookOpenCheck,
  CalendarDays,
  ClipboardList,
  GraduationCap,
  Landmark,
  UsersRound,
} from "lucide-react";
import { Link } from "react-router-dom";

const programFeatures = [
  {
    icon: Landmark,
    title: "City and partner funding",
    description: "Browse currently active programs from their respective funding units.",
  },
  {
    icon: CalendarDays,
    title: "Funding-cycle information",
    description: "Program listings show their funding-cycle and application dates where recorded.",
  },
  {
    icon: BadgeCheck,
    title: "Clear review stages",
    description:
      "Applications are designed for barangay, school registrar, and LGU review stages.",
  },
];

const applicationSteps = [
  {
    icon: BookOpenCheck,
    number: "01",
    title: "Review the official program",
    description:
      "Check the active program notice for its eligibility rules, schedule, and required documents.",
  },
  {
    icon: ClipboardList,
    number: "02",
    title: "Prepare your information",
    description:
      "Gather accurate student, school, and barangay details. Required documents depend on the program.",
  },
  {
    icon: UsersRound,
    number: "03",
    title: "Submit when applications open",
    description:
      "Submit only when a program is open and the student portal confirms online submission is available.",
  },
];

export default function HomePage() {
  return (
    <div className="page-container">
      <section className="hero">
        <div className="hero-content">
          <p className="eyebrow">
            <span className="eyebrow-rule" />
            TAGBILARAN CITY · SCHOLARSHIP SUPPORT
          </p>
          <h1>
            Opportunity for learners.
            <br />
            <span>Progress for our city.</span>
          </h1>
          <p className="hero-description">
            A scholarship and educational grant portal in development for
            Tagbilaran City students, schools, barangays, and program teams.
          </p>
          <div className="hero-actions">
            <Link className="button button-primary" to="/programs">
              Explore programs
              <ArrowRight size={17} aria-hidden="true" />
            </Link>
            <Link className="button button-outline" to="/application-guide">
              Application guide
            </Link>
          </div>
        </div>
        <div className="hero-seal" aria-hidden="true">
          <div className="seal-ring">
            <Landmark size={47} strokeWidth={1.1} />
            <span>TAGBILARAN</span>
          </div>
        </div>
        <div className="hero-caption">
          <span className="caption-dot" />
          Built around local scholarship workflows
        </div>
      </section>

      <section
        className="intro-section program-section"
        aria-labelledby="program-heading"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">PROGRAM INFORMATION</p>
            <h2 id="program-heading">Support shaped around local needs.</h2>
          </div>
          <p>
            GrantWise displays active program information from the funding
            program database. Program-specific eligibility details should be
            confirmed with the responsible funding unit.
          </p>
        </div>

        <div className="pillar-grid">
          {programFeatures.map(({ icon: Icon, title, description }, index) => (
            <article className="pillar-card" key={title}>
              <div className="pillar-card-top">
                <span className="pillar-icon">
                  <Icon size={20} strokeWidth={1.8} aria-hidden="true" />
                </span>
                <span className="pillar-number">0{index + 1}</span>
              </div>
              <h3>{title}</h3>
              <p>{description}</p>
            </article>
          ))}
        </div>
        <div className="section-action">
          <Link className="text-link" to="/programs">
            View program information
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
          <span className="preview-label">Live program catalog</span>
        </div>
      </section>

      <section className="guide-section" aria-labelledby="guide-heading">
        <div className="guide-heading">
          <p className="eyebrow">APPLICATION GUIDANCE</p>
          <h2 id="guide-heading">
            A considered process, from preparation to review.
          </h2>
          <p>
            Submit applications to open programs through the student portal.
            Always follow the official program notice for current requirements.
          </p>
        </div>
        <div className="steps-grid">
          {applicationSteps.map(
            ({ icon: Icon, number, title, description }) => (
              <article className="step-card" key={number}>
                <div className="step-card-top">
                  <span className="step-icon">
                    <Icon size={19} aria-hidden="true" />
                  </span>
                  <span>{number}</span>
                </div>
                <h3>{title}</h3>
                <p>{description}</p>
              </article>
            ),
          )}
        </div>
        <Link className="text-link guide-link" to="/application-guide">
          Read application instructions
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </section>

      <section
        className="eligibility-section"
        aria-labelledby="eligibility-heading"
      >
        <div className="eligibility-icon">
          <GraduationCap size={26} aria-hidden="true" />
        </div>
        <div className="eligibility-copy">
          <p className="eyebrow">ELIGIBILITY INFORMATION</p>
          <h2 id="eligibility-heading">Check each program’s requirements.</h2>
          <p>
            Eligibility criteria are program-specific and are not published by
            the current API. Application records are designed to include details
            such as school, course, year level, and barangay; these are not
            universal eligibility rules. Confirm requirements with the official
            program notice before applying.
          </p>
        </div>
        <Link className="button button-light" to="/application-guide">
          What to prepare
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </section>

      <section className="closing-cta" aria-labelledby="cta-heading">
        <div>
          <p className="eyebrow">STAY INFORMED</p>
          <h2 id="cta-heading">Check your student application status.</h2>
          <p>
            Sign in to review your submissions. New applications can be sent
            only when the student portal confirms submission is available.
          </p>
        </div>
        <div className="closing-actions">
          <Link className="button button-primary" to="/login">
            Student sign in
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
          <Link className="text-link" to="/portals">
            View portal previews
          </Link>
        </div>
      </section>
    </div>
  );
}
