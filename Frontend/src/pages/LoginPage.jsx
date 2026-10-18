import React from "react";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { Link } from "react-router-dom";
import FeatureUnavailable from "../components/FeatureUnavailable.jsx";
import PageHeading from "../components/PageHeading.jsx";

export default function LoginPage() {
  return (
    <div className="page-container information-page narrow-page">
      <PageHeading
        eyebrow="ACCOUNT ACCESS"
        title="Sign-in is not available yet."
        description="GrantWise is not connected to an authentication service. No password form is shown and this page does not create or verify accounts."
      />

      <div className="login-placeholder-mark">
        <LockKeyhole size={25} aria-hidden="true" />
      </div>
      <FeatureUnavailable
        title="Secure authentication is still required."
        description="The backend needs account registration and sign-in endpoints, secure session handling, and server-side permission checks before user accounts can be accessed here."
      />

      <div className="page-actions">
        <Link className="button button-primary" to="/portals">
          View portal previews
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
        <Link className="text-link" to="/">
          Return to home
        </Link>
      </div>
    </div>
  );
}
