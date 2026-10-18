import React from "react";
import { Link } from "react-router-dom";

export default function NotFoundPage() {
  return (
    <section className="not-found page-container">
      <p className="eyebrow">404 · PAGE NOT FOUND</p>
      <h1>This page isn’t available.</h1>
      <p>Check the address or return to the GrantWise home page.</p>
      <Link className="button button-primary" to="/">
        Go to home
      </Link>
    </section>
  );
}
