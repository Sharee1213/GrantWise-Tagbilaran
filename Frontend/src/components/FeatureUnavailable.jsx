import React from "react";
import { CircleDashed } from "lucide-react";

export default function FeatureUnavailable({ title, description }) {
  return (
    <section className="feature-unavailable" aria-live="polite">
      <span className="feature-unavailable-icon">
        <CircleDashed size={21} aria-hidden="true" />
      </span>
      <div>
        <span className="feature-label">NOT CONNECTED</span>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </section>
  );
}
