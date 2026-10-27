"use client";
import { useCallback, useEffect, useState } from "react";
import { api, fmt } from "@/lib/client";

export default function Admin() {
  const [data, setData] = useState<any>(null);
  const [doubts, setDoubts] = useState<any[]>([]);
  const [pre, setPre] = useState<any[]>([]);
  const [courses, setCourses] = useState<any[]>([]);
  const [pf, setPf] = useState({ concept_id: "", prerequisite_id: "" });
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const [s, d, p, c] = await Promise.all([
      api("/api/admin/stats"), api("/api/doubts?scope=all"), api("/api/admin/prerequisites"), api("/api/courses"),
    ]);
    setData(s); setDoubts(d.doubts); setPre(p.prerequisites); setCourses(c.courses);
  }, []);

  async function addPre(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setMsg("");
    try {
      await api("/api/admin/prerequisites", { body: { concept_id: Number(pf.concept_id), prerequisite_id: Number(pf.prerequisite_id) } });
      setMsg("Prerequisite added"); setPf({ concept_id: "", prerequisite_id: "" }); await load();
    } catch (e: any) { setErr(e.message); }
  }
  async function delPre(c: number, p: number) {
    setErr(""); setMsg("");
    try { await api(`/api/admin/prerequisites?concept_id=${c}&prerequisite_id=${p}`, { method: "DELETE" }); await load(); }
    catch (e: any) { setErr(e.message); }
  }
  useEffect(() => { load().catch((e) => setErr(e.message)); }, [load]);

  async function remove(id: number) {
    setErr("");
    try { await api(`/api/doubts/${id}`, { method: "DELETE" }); await load(); } catch (e: any) { setErr(e.message); }
  }

  if (!data) return err ? <div className="alert err">{err}</div> : <div className="muted">Loading...</div>;
  const st = data.stats;
  const stat = (n: any, l: string) => <div className="card stat"><div className="n">{n ?? "-"}</div><div className="l">{l}</div></div>;

  return (
    <>
      <h1>Admin dashboard</h1>
      <p className="muted">Everything here is read from SQL views (v_platform_stats, v_helper_leaderboard, v_concept_demand_supply, v_unserved_doubts) and the trigger-fed audit log, through the pb_admin database role.</p>
      {err && <div className="alert err">{err}</div>}
      {msg && <div className="alert ok">{msg}</div>}
      <div className="grid g4" style={{ margin: "14px 0" }}>
        {stat(st.students, "Students")}{stat(st.open_doubts, "Open doubts")}
        {stat(st.completed_sessions, "Sessions completed")}{stat(st.avg_rating, "Average rating")}
      </div>

      <div className="grid g2">
        <div className="card">
          <h2>Top helpers</h2>
          <table>
            <thead><tr><th>Student</th><th>Rep</th><th>Mastered</th><th>Sessions</th><th>Avg</th></tr></thead>
            <tbody>
              {data.leaderboard.map((r: any) => (
                <tr key={r.user_id}><td>{r.full_name}</td><td>{r.reputation}</td><td>{r.concepts_mastered}</td><td>{r.sessions_done}</td><td>{r.avg_rating ?? "-"}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2>Supply gaps</h2>
          <p className="small muted">Concepts with open doubts, most under-served first.</p>
          <table>
            <thead><tr><th>Concept</th><th>Open doubts</th><th>Helpers</th></tr></thead>
            <tbody>
              {data.gaps.map((r: any) => (
                <tr key={r.concept_id}><td>{r.concept_name} <span className="small muted">{r.course_code}</span></td><td>{r.open_doubts}</td><td>{r.helpers}</td></tr>
              ))}
              {data.gaps.length === 0 && <tr><td colSpan={3} className="muted">No open doubts.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Unserved doubts</h2>
        <p className="small muted">Open doubts whose concept has no other student with a free slot (view v_unserved_doubts, correlated NOT EXISTS).</p>
        <table>
          <thead><tr><th>Doubt</th><th>Concept</th><th>Asker</th></tr></thead>
          <tbody>
            {data.unserved.map((d: any) => (
              <tr key={d.doubt_id}><td>{d.title}</td><td>{d.concept_name} <span className="small muted">{d.course_code}</span></td><td>{d.asker_name}</td></tr>
            ))}
            {data.unserved.length === 0 && <tr><td colSpan={3} className="muted">Every open doubt has an available helper.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Concept prerequisites</h2>
        <p className="small muted">Edges of the prerequisite graph. A trigger rejects cross-course edges and cycles (recursive CTE check).</p>
        <form className="row" onSubmit={addPre} style={{ marginBottom: 10 }}>
          <select value={pf.concept_id} onChange={(e) => setPf({ ...pf, concept_id: e.target.value })} required style={{ flex: 1 }}>
            <option value="">Concept...</option>
            {courses.map((c) => <optgroup key={c.course_id} label={c.code}>{c.concepts.map((k: any) => <option key={k.concept_id} value={k.concept_id}>{k.name}</option>)}</optgroup>)}
          </select>
          <span className="small muted">requires</span>
          <select value={pf.prerequisite_id} onChange={(e) => setPf({ ...pf, prerequisite_id: e.target.value })} required style={{ flex: 1 }}>
            <option value="">Prerequisite...</option>
            {courses.map((c) => <optgroup key={c.course_id} label={c.code}>{c.concepts.map((k: any) => <option key={k.concept_id} value={k.concept_id}>{k.name}</option>)}</optgroup>)}
          </select>
          <button>Add</button>
        </form>
        <table>
          <thead><tr><th>Course</th><th>Concept</th><th>Requires</th><th></th></tr></thead>
          <tbody>
            {pre.map((p) => (
              <tr key={`${p.concept_id}-${p.prerequisite_id}`}>
                <td>{p.course_code}</td><td>{p.concept_name}</td><td>{p.prerequisite_name}</td>
                <td><button className="ghost" onClick={() => delPre(p.concept_id, p.prerequisite_id)}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Moderate doubts</h2>
        <table>
          <thead><tr><th>Doubt</th><th>Asker</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {doubts.slice(0, 12).map((d) => (
              <tr key={d.doubt_id}>
                <td>{d.title}</td><td>{d.asker_name}</td><td><span className={`badge ${d.status}`}>{d.status}</span></td>
                <td><button className="danger" onClick={() => remove(d.doubt_id)}>Delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Audit log (latest)</h2>
        <table>
          <thead><tr><th>When</th><th>Table</th><th>Action</th><th>Row</th><th>Detail</th></tr></thead>
          <tbody>
            {data.audit.map((a: any) => (
              <tr key={a.log_id}>
                <td className="small">{fmt(a.changed_at)}</td><td>{a.table_name}</td><td>{a.action}</td><td>{a.row_id}</td>
                <td className="small muted">{a.title ?? a.status ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
