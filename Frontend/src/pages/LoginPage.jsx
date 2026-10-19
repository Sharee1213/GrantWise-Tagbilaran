import React, { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import PageHeading from "../components/PageHeading.jsx";
import { apiRequest } from "../services/api.js";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    apiRequest("auth/me")
      .then(() => {
        if (active) {
          navigate("/portals", { replace: true });
        }
      })
      .catch((requestError) => {
        if (active && requestError.status !== 401) {
          setError(requestError.message || "Unable to check the current session.");
        }
      });
    return () => {
      active = false;
    };
  }, [navigate]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await apiRequest("auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      navigate("/portals");
    } catch (requestError) {
      setError(requestError.message || "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-container information-page narrow-page">
      <PageHeading
        eyebrow="ACCOUNT ACCESS"
        title="Sign in to GrantWise."
        description="Use the email and password you registered with."
      />

      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <p role="alert" className="text-red-600">{error}</p>}
        <input
          className="border p-2 w-full rounded"
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className="border p-2 w-full rounded"
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <button className="button button-primary" disabled={loading}>
          {loading ? "Signing in..." : "Sign in"}
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </form>

      <div className="page-actions">
        <Link className="text-link" to="/signup">Create an account</Link>
        <Link className="text-link" to="/">Return to home</Link>
      </div>
    </div>
  );
}