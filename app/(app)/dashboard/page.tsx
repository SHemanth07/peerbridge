"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client";
import { useMe } from "@/components/UserContext";

export default function Dashboard() {
  const me = useMe();
  const [courses, setCourses] = useState<any[]>([]);
  const [doubts, setDoubts] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [mastery, setMastery] = useState<any[]>([]);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    if (me.role === "admin") { window.location.href = "/admin"; return; }
    try {
      const [c, d, s, m] = await Promise.all([
        api("/api/courses"), api("/api/doubts?scope=mine"), api("/api/sessions"), api("/api/mastery"),
      ]);
      setCourses(c.courses); setDoubts(d.doubts); setSessions(s.sessions); setMastery(m.mastery);
    } catch (e: any) { setErr(e.message); }
  }, [me.role]);
  useEffect(() => { load(); }, [load]);

  async function toggle(c: any) {
    setErr("");
    try {
      if (c.enrolled) await api(`/api/enrolments?course_id=${c.course_id}`, { method: "DELETE" });
      else await api("/api/enrolments", { body: { course_id: c.course_id } });
      load();
    } catch (e: any) { setErr(e.message); }
  }

  const upcoming = sessions.filter((s) => s.status === "scheduled");
  return (
    <>
      <h1>Hi {me.full_name.split(" ")[0]}</h1>
      <p className="muted">Ask a doubt, or share what you recently mastered so others can find you.</p>
      {err && <div className="alert err">{err}</div>}

      <div className="grid g4" style={{ margin: "16px 0" }}>
        <div className="card stat"><div className="n">{doubts.filter((d) => d.status === "open").length}</div><div className="l">Open doubts</div></div>
        <div className="card stat"><div className="n">{upcoming.length}</div><div className="l">Upcoming sessions</div></div>
        <div className="card stat"><div className="n">{mastery.length}</div><div className="l">Concepts mastered</div></div>
        <div className="card stat"><div className="n">{me.reputation}</div><div className="l">Reputation</div></div>
      </div>

      <div className="card">
        <h2>My courses</h2>
        <p className="small muted">You can only post doubts and record mastery for courses you are enrolled in (enforced by a database trigger).</p>
        {courses.map((c) => (
          <div key={c.course_id} className="row between" style={{ padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
            <div><b>{c.code}</b> &nbsp;{c.title} <span className="small muted">({c.concepts.length} concepts)</span></div>
            <button className={c.enrolled ? "ghost" : ""} onClick={() => toggle(c)}>{c.enrolled ? "Unenrol" : "Enrol"}</button>
          </div>
        ))}
      </div>

      <div className="row">
        <Link className="btn" href="/doubts">Ask a doubt</Link>
        <Link className="btn" href="/expertise" style={{ background: "#fff", color: "var(--brand)", border: "1px solid var(--line)" }}>Add what I mastered</Link>
      </div>
    </>
  );
}
