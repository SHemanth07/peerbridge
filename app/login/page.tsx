"use client";
import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      await api("/api/auth/login", { body: { email, password } });
      window.location.href = "/dashboard";
    } catch (e: any) { setErr(e.message); setBusy(false); }
  }

  return (
    <div className="auth">
      <h1>Log in</h1>
      <p className="muted">Welcome back to PeerBridge.</p>
      <form className="card" onSubmit={submit}>
        <label>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {err && <div className="alert err">{err}</div>}
        <div style={{ marginTop: 14 }}><button disabled={busy}>{busy ? "Signing in..." : "Log in"}</button></div>
      </form>
      <p className="small muted">New here? <Link href="/register">Create an account</Link></p>
    </div>
  );
}
