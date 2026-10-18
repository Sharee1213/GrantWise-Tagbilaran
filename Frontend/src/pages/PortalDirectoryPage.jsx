import React from "react";
import {
  ArrowRight,
  Building2,
  GraduationCap,
  Landmark,
  UserRound,
} from "lucide-react";
import { Link } from "react-router-dom";
import PageHeading from "../components/PageHeading.jsx";

const portals = [
  {
    path: "student",
    icon: GraduationCap,
    title: "Student application portal",
    role: "Scholar / applicant",
    description:
      "Profile, program discovery, application tracking, documents, awards, and disbursement history.",
  },
  {
    path: "lgu-admin",
    icon: Landmark,
    title: "LGU program admin",
    role: "LGU Admin",
    description:
      "Program and funding-unit administration with application review and authorized funding summaries.",
  },
  {
    path: "barangay-coordinator",
    icon: Building2,
    title: "Barangay coordinator",
    role: "Barangay Coordinator",
    description:
      "Barangay-scoped application verification and authorized coordination tasks.",
  },
  {
    path: "school-registrar",
    icon: UserRound,
    title: "School registrar",
    role: "Registrar",
    description:
      "School-scoped enrollment and academic verification tasks.",
  },
];

export default function PortalDirectoryPage() {
  return (
    <div className="page-container information-page">
      <PageHeading
        eyebrow="GRANTWISE PORTALS"
        title="A place for every role."
        description="These previews describe the intended portal areas based on the database roles. They are not sign-in or protected dashboards; the backend must authorize every request."
      />

      <div className="portal-grid">
        {portals.map(({ path, icon: Icon, title, role, description }) => (
          <article className="portal-card" key={path}>
            <span className="portal-icon">
              <Icon size={21} aria-hidden="true" />
            </span>
            <p className="eyebrow">{role}</p>
            <h2>{title}</h2>
            <p>{description}</p>
            <Link className="text-link" to={`/portal/${path}`}>
              View placeholder
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </article>
        ))}
      </div>

      <div className="access-principle">
        <strong>Access is not granted by this website.</strong>
        <p>
          Funding-unit, barangay, school, and student record access must be
          enforced by authenticated backend APIs. These preview routes do not
          apply client-side role checks and do not reveal records.
        </p>
      </div>
    </div>
  );
}
