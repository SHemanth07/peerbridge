"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, fmt } from "@/lib/client";

export default function Doubts() {
  const [courses, setCourses] = useState<any[]>([]);
  const [doubts, setDoubts] = useState<any[]>([]);
  const [f, setF] = useState({ course_id: "", title: "", body: "" });
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [c, d] = await Promise.all([api("/api/courses"), api("/api/doubts?scope=mine")]);
    setCourses(c.courses.filter((x: any) => x.enrolled));
    setDoubts(d.doubts);
  }, []);
  useEffect(() => { load().catch((e) => setErr(e.message)); }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(""); setMsg("");
    try {
      const r = await api("/api/doubts", { body: { ...f, course_id: Number(f.course_id) } });
      window.location.href = `/doubts/${r.doubt.doubt_id}`;
    } catch (e: any) { setErr(e.message); setBusy(false); }
  }

  async function remove(id: number) {
    setErr(""); setMsg("");
    try { await api(`/api/doubts/${id}`, { method: "DELETE" }); setMsg("Doubt deleted"); load(); }
    catch (e: any) { setErr(e.message); }
  }

  return (
    <>
      <h1>My doubts</h1>
      <p className="muted">Describe it in your own words. We embed the text and find peers by meaning.</p>

      <form className="card" onSubmit={submit}>
        <h2>Ask a new doubt</h2>
        <label>Course</label>
        <select value={f.course_id} onChange={(e) => setF({ ...f, course_id: e.target.value })} required>
          <option value="">Select an enrolled course...</option>
          {courses.map((c) => <option key={c.course_id} value={c.course_id}>{c.code} - {c.title}</option>)}
        </select>
        {courses.length === 0 && <div className="small muted">Enrol in a course on the dashboard first.</div>}
        <label>Title</label>
        <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} minLength={8} required />
        <label>What exactly are you stuck on?</label>
        <textarea value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} minLength={20} required />
        {err && <div className="alert err">{err}</div>}
        {msg && <div className="alert ok">{msg}</div>}
        <div style={{ marginTop: 12 }}><button disabled={busy}>{busy ? "Embedding and matching..." : "Find peers"}</button></div>
      </form>

      <div className="card">
        <table>
          <thead><tr><th>Doubt</th><th>Course</th><th>Concept (auto-tagged)</th><th>Status</th><th>Asked</th><th></th></tr></thead>
          <tbody>
            {doubts.map((d) => (
              <tr key={d.doubt_id}>
                <td><Link href={`/doubts/${d.doubt_id}`}>{d.title}</Link></td>
                <td>{d.course_code}</td>
                <td>{d.concept_name ?? <span className="muted">-</span>}</td>
                <td><span className={`badge ${d.status}`}>{d.status}</span></td>
                <td className="small">{fmt(d.created_at)}</td>
                <td>{d.status === "open" && <button className="ghost" onClick={() => remove(d.doubt_id)}>Delete</button>}</td>
              </tr>
            ))}
            {doubts.length === 0 && <tr><td colSpan={6} className="muted">No doubts yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
