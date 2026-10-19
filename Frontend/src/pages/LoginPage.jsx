import React, { useEffect, useState } from "react";
import { ArrowRight, Eye, EyeOff } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import PageHeading from "../components/PageHeading.jsx";
import { apiRequest } from "../services/api.js";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const programId = searchParams.get("programId");

  function destinationFor(user) {
    if (user.role !== "Scholar") return "/portals";
    return programId && /^\d+$/.test(programId)
      ? `/portal/student?programId=${encodeURIComponent(programId)}`
      : "/portal/student";
  }

  useEffect(() => {
    let active = true;
    apiRequest("auth/me")
      .then(({ user }) => {
        if (active) {
          navigate(destinationFor(user), { replace: true });
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
  }, [navigate, programId]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await apiRequest("auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      navigate(destinationFor(result.user));
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
        <div className="relative">
          <input
            className="border p-2 pr-12 w-full rounded"
            type={showPassword ? "text" : "password"}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
          <button
            className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-600"
            type="button"
            onClick={() => setShowPassword((visible) => !visible)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
          >
            {showPassword ? (
              <EyeOff size={18} aria-hidden="true" />
            ) : (
              <Eye size={18} aria-hidden="true" />
            )}
          </button>
        </div>
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