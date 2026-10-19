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
      "Browse open programs, submit applications, and track verification status.",
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
        description="The student portal supports applications and status tracking. Staff portal links remain previews and do not grant access."
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
              {path === "student" ? "Open student portal" : "View placeholder"}
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </article>
        ))}
      </div>

      <div className="access-principle">
        <strong>Staff access is not granted by these previews.</strong>
        <p>
          Funding-unit, barangay, and school access remains enforced by
          authenticated backend APIs. The student portal also checks the
          server-authenticated role before showing personal application data.
        </p>
      </div>
    </div>
  );
}
