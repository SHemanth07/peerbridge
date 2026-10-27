"use client";
import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client";

export default function Register() {
  const [f, setF] = useState({ full_name: "", email: "", password: "", semester: 3 });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setF({ ...f, [k]: v });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      await api("/api/auth/register", { body: f });
      window.location.href = "/dashboard";
    } catch (e: any) { setErr(e.message); setBusy(false); }
  }

  return (
    <div className="auth">
      <h1>Create account</h1>
      <form className="card" onSubmit={submit}>
        <label>Full name</label>
        <input value={f.full_name} onChange={(e) => set("full_name", e.target.value)} required />
        <label>Email</label>
        <input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} required />
        <label>Password (min 8 characters)</label>
        <input type="password" value={f.password} onChange={(e) => set("password", e.target.value)} required minLength={8} />
        <label>Semester</label>
        <select value={f.semester} onChange={(e) => set("semester", Number(e.target.value))}>
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        {err && <div className="alert err">{err}</div>}
        <div style={{ marginTop: 14 }}><button disabled={busy}>{busy ? "Creating..." : "Sign up"}</button></div>
      </form>
      <p className="small muted">Already registered? <Link href="/login">Log in</Link></p>
    </div>
  );
}
