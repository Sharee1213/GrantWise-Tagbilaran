import React from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import FeatureUnavailable from "../components/FeatureUnavailable.jsx";
import PageHeading from "../components/PageHeading.jsx";

const portalDetails = {
  "lgu-admin": {
    eyebrow: "LGU PROGRAM ADMIN",
    title: "Program oversight, within scope.",
    description:
      "A future workspace for permitted program, funding, and application review tasks.",
    missing:
      "The backend needs authenticated administrator identity, funding-unit-scoped reads and actions, program management endpoints, and authorized summaries.",
  },
  "barangay-coordinator": {
    eyebrow: "BARANGAY COORDINATOR",
    title: "Local verification, securely scoped.",
    description:
      "A future workspace for permitted barangay application verification and coordination.",
    missing:
      "The backend needs authenticated coordinator identity, barangay-scoped verification queues, and authorized review-action endpoints.",
  },
  "school-registrar": {
    eyebrow: "SCHOOL REGISTRAR",
    title: "Academic verification, by school.",
    description:
      "A future workspace for permitted enrollment and academic verification tasks.",
    missing:
      "The backend needs authenticated registrar identity, school-scoped student and verification APIs, and authorized review-action endpoints.",
  },
};

export default function PortalPlaceholderPage() {
  const { portalType } = useParams();
  const portal = portalDetails[portalType];

  if (!portal) {
    return (
      <section className="page-container information-page">
        <PageHeading
          eyebrow="PORTAL PREVIEW"
          title="This portal preview is not available."
          description="Choose one of the currently documented role previews."
        />
        <Link className="text-link" to="/portals">
          <ArrowLeft size={16} aria-hidden="true" />
          All portal previews
        </Link>
      </section>
    );
  }

  return (
    <div className="page-container information-page narrow-page">
      <PageHeading
        eyebrow={portal.eyebrow}
        title={portal.title}
        description={portal.description}
      />
      <FeatureUnavailable
        title="Protected dashboard APIs are not implemented."
        description={portal.missing}
      />
      <div className="access-principle">
        <strong>Role boundaries must be enforced by the backend.</strong>
        <p>
          This page does not authenticate users, check roles, or request
          restricted records. In particular, it cannot enforce funding-unit,
          barangay, school, or student ownership boundaries.
        </p>
      </div>
      <div className="page-actions">
        <Link className="text-link" to="/portals">
          <ArrowLeft size={16} aria-hidden="true" />
          All portal previews
        </Link>
        <Link className="text-link" to="/login">
          Sign-in information
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
