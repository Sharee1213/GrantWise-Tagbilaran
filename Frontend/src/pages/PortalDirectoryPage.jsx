import React from "react";
import {
  ArrowRight,
  Building2,
  GraduationCap,
  Landmark,
  ShieldCheck,
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
      "Browse open programs, verify student email ownership, submit applications, and track verification status.",
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
  {
    path: "system-admin",
    icon: ShieldCheck,
    title: "Developer & Staff Access Control",
    role: "System Admin",
    description:
      "Developer-controlled staff email allowlist, role invitations, school domain configuration, and audit logs.",
  },
];

export default function PortalDirectoryPage() {
  return (
    <div className="page-container information-page">
      <PageHeading
        eyebrow="GRANTWISE PORTALS"
        title="A place for every role."
        description="Each portal uses the signed-in account's server-verified role and active organizational assignment."
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
              {path === "student" ? "Open student portal" : "Open staff portal"}
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </article>
        ))}
      </div>

      <div className="access-principle">
        <strong>Staff data stays within the assigned organization.</strong>
        <p>
          Staff endpoints derive funding-unit, barangay, and school scope from
          the authenticated database assignment. Invited staff members activate
          their accounts via{" "}
          <Link className="text-link" to="/staff-register">
            /staff-register
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
