import React, { useEffect, useState } from "react";
import { ArrowRight, CalendarDays, Landmark } from "lucide-react";
import { Link } from "react-router-dom";
import PageHeading from "../components/PageHeading.jsx";
import { apiRequest } from "../services/api.js";

function formatDate(value) {
  if (!value) return null;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

export default function ProgramsPage() {
  const [programs, setPrograms] = useState([]);
  const [applicationSubmissionEnabled, setApplicationSubmissionEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    apiRequest("programs")
      .then((data) => {
        if (!Array.isArray(data?.programs)) {
          throw new Error("The API returned an invalid program list.");
        }
        if (active) {
          setPrograms(data.programs);
          setApplicationSubmissionEnabled(data.applicationSubmissionEnabled === true);
        }
      })
      .catch((requestError) => {
        if (active) setError(requestError.message || "Could not load programs.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="page-container information-page">
      <PageHeading
        eyebrow="SCHOLARSHIP PROGRAMS"
        title="Find the right opportunity."
        description="Browse programs currently recorded by GrantWise. Confirm program-specific eligibility and required documents with the funding unit before applying."
      />

      {loading && <p role="status">Loading available programs...</p>}
      {error && <p role="alert" className="text-red-600">{error}</p>}
      {!loading && !error && programs.length === 0 && (
        <section className="access-principle" aria-live="polite">
          <strong>No programs are currently available.</strong>
          <p>
            There are no active, non-expired programs in the database right
            now. Check again later or follow official City announcements.
          </p>
        </section>
      )}

      {!loading && !error && programs.length > 0 && (
        <section className="pillar-grid" aria-label="Available programs">
          {programs.map((program) => {
            const start = formatDate(program.application_start_date);
            const end = formatDate(program.application_end_date);
            return (
              <article className="pillar-card" key={program.program_id}>
                <div className="pillar-card-top">
                  <span className="pillar-icon">
                    <Landmark size={20} aria-hidden="true" />
                  </span>
                  <span className="pillar-number">
                    {program.availability === "upcoming" ? "UPCOMING" : "OPEN"}
                  </span>
                </div>
                <h2>{program.program_name}</h2>
                {program.funding_unit_name && <p>{program.funding_unit_name}</p>}
                <p>
                  {(program.cycle_code || program.funding_cycle)
                    ? `Funding cycle ${program.cycle_code || program.funding_cycle}`
                    : "Funding cycle dates are not listed."}
                </p>
                <p className="program-dates">
                  <CalendarDays size={15} aria-hidden="true" />
                  {start || end
                    ? `${start || "Date not set"} – ${end || "No end date"}`
                    : "Application dates not specified"}
                </p>
                <p>
                  Program-specific eligibility details are not recorded in the
                  database. Confirm eligibility and required documents with
                  the funding unit.
                </p>
                {program.availability === "open" && applicationSubmissionEnabled ? (
                  <Link
                    className="text-link"
                    to={`/portal/student?programId=${program.program_id}`}
                  >
                    Apply for this program
                    <ArrowRight size={16} aria-hidden="true" />
                  </Link>
                ) : program.availability === "open" ? (
                  <p>Online applications are unavailable until the database workflow is updated.</p>
                ) : (
                  <p>Applications have not opened yet.</p>
                )}
              </article>
            );
          })}
        </section>
      )}

      <div className="page-callout">
        <p>
          {applicationSubmissionEnabled
            ? "Signed-in students can apply while a program is accepting applications."
            : "Online applications are unavailable until the required database workflow is installed."}{" "}
          Document uploads are not supported.
        </p>
        <Link className="text-link" to="/application-guide">
          Read application guidance
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
