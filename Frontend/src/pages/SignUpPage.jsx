import React, { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import PageHeading from "../components/PageHeading.jsx";
import { apiRequest } from "../services/api.js";

export default function SignUpPage() {
  const [form, setForm] = useState({
    firstName: "", lastName: "", email: "", password: "", phoneNumber: "",
    barangayId: "", schoolId: "", studentNumber: "", course: "", yearLevel: "",
  });
  const [barangays, setBarangays] = useState([]);
  const [schools, setSchools] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    apiRequest("lookups")
      .then((data) => {
        if (!Array.isArray(data?.barangays) || !Array.isArray(data?.schools)) {
          throw new Error("The API returned an invalid lookup response.");
        }
        if (active) {
          setBarangays(data.barangays);
          setSchools(data.schools);
        }
      })
      .catch((requestError) => {
        if (active) {
          setError(`Could not load barangays and schools. ${requestError.message}`);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const update = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await apiRequest("auth/register", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          barangayId: Number(form.barangayId),
          schoolId: Number(form.schoolId),
          phoneNumber: form.phoneNumber || null,
          yearLevel: form.yearLevel || null,
        }),
      });
      navigate("/login");
    } catch (requestError) {
      const details = requestError.payload?.errors
        ?.map((item) => `${item.field}: ${item.message}`)
        .join(", ");
      setError(details || requestError.message || "Registration failed.");
    } finally {
      setLoading(false);
    }
  }

  const input = "border p-2 w-full rounded";

  return (
    <div className="page-container information-page narrow-page">
      <PageHeading
        eyebrow="ACCOUNT ACCESS"
        title="Create your student account."
        description="Scholarship applicants register here. Passwords must be at least 12 characters."
      />

      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <p role="alert" className="text-red-600">{error}</p>}
        <input className={input} name="firstName" placeholder="First name" onChange={update} required />
        <input className={input} name="lastName" placeholder="Last name" onChange={update} required />
        <input className={input} name="email" type="email" placeholder="Email" onChange={update} required />
        <input className={input} name="password" type="password" placeholder="Password (12+ characters)" onChange={update} required />
        <input className={input} name="phoneNumber" placeholder="Phone number (optional)" onChange={update} />
        <select className={input} name="barangayId" value={form.barangayId} onChange={update} required>
          <option value="">Select your barangay</option>
          {barangays.map((b) => (
            <option key={b.barangay_id} value={b.barangay_id}>{b.barangay_name}</option>
          ))}
        </select>
        <select className={input} name="schoolId" value={form.schoolId} onChange={update} required>
          <option value="">Select your school</option>
          {schools.map((s) => (
            <option key={s.school_id} value={s.school_id}>{s.school_name}</option>
          ))}
        </select>
        <input className={input} name="studentNumber" placeholder="Student number" onChange={update} required />
        <input className={input} name="course" placeholder="Course" onChange={update} required />
        <input className={input} name="yearLevel" placeholder="Year level (optional)" onChange={update} />
        <button className="button button-primary" disabled={loading}>
          {loading ? "Creating..." : "Create account"}
        </button>
      </form>

      <div className="page-actions">
        <Link className="text-link" to="/login">Already have an account? Sign in</Link>
      </div>
    </div>
  );
}