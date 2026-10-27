"use client";
import { useCallback, useEffect, useState } from "react";
import { api, fmt } from "@/lib/client";

const toISO = (local: string) => new Date(local).toISOString();

export default function Expertise() {
  const [courses, setCourses] = useState<any[]>([]);
  const [mastery, setMastery] = useState<any[]>([]);
  const [slots, setSlots] = useState<any[]>([]);
  const [m, setM] = useState({ concept_id: "", score: 85, note: "" });
  const [s, setS] = useState({ start: "", end: "" });
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [c, ma, sl] = await Promise.all([api("/api/courses"), api("/api/mastery"), api("/api/slots")]);
    setCourses(c.courses.filter((x: any) => x.enrolled));
    setMastery(ma.mastery); setSlots(sl.slots);
  }, []);
  useEffect(() => { load().catch((e) => setErr(e.message)); }, [load]);

  async function addMastery(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setMsg(""); setBusy(true);
    try {
      await api("/api/mastery", { body: { concept_id: Number(m.concept_id), score: Number(m.score), note: m.note } });
      setMsg("Saved. Your note was (re-)embedded and is now searchable by meaning.");
      setM({ concept_id: "", score: 85, note: "" });
      await load();
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  }
  async function addSlot(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setMsg("");
    try {
      await api("/api/slots", { body: { start_time: toISO(s.start), end_time: toISO(s.end) } });
      setS({ start: "", end: "" }); setMsg("Slot added"); await load();
    } catch (e: any) { setErr(e.message); }
  }
  async function del(url: string) {
    setErr(""); setMsg("");
    try { await api(url, { method: "DELETE" }); await load(); } catch (e: any) { setErr(e.message); }
  }

  return (
    <>
      <h1>My expertise</h1>
      <p className="muted">Tell the platform what you recently mastered and when you can help.</p>
      {err && <div className="alert err">{err}</div>}
      {msg && <div className="alert ok">{msg}</div>}

      <div className="grid g2">
        <form className="card" onSubmit={addMastery}>
          <h2>I mastered a concept</h2>
          <label>Concept</label>
          <select value={m.concept_id} onChange={(e) => setM({ ...m, concept_id: e.target.value })} required>
            <option value="">Choose...</option>
            {courses.map((c) => (
              <optgroup key={c.course_id} label={`${c.code} - ${c.title}`}>
                {c.concepts.map((k: any) => <option key={k.concept_id} value={k.concept_id}>{k.name}</option>)}
              </optgroup>
            ))}
          </select>
          <label>Self-assessed score (70-100)</label>
          <input type="number" min={70} max={100} value={m.score} onChange={(e) => setM({ ...m, score: Number(e.target.value) })} />
          <label>In your own words, what clicked for you?</label>
          <textarea value={m.note} onChange={(e) => setM({ ...m, note: e.target.value })} required minLength={10} />
          <div style={{ marginTop: 12 }}><button disabled={busy}>{busy ? "Embedding..." : "Save mastery"}</button></div>
        </form>

        <form className="card" onSubmit={addSlot}>
          <h2>Offer a help slot</h2>
          <label>Start</label>
          <input type="datetime-local" value={s.start} onChange={(e) => setS({ ...s, start: e.target.value })} required />
          <label>End (max 2 hours)</label>
          <input type="datetime-local" value={s.end} onChange={(e) => setS({ ...s, end: e.target.value })} required />
          <div style={{ marginTop: 12 }}><button>Add slot</button></div>
          <p className="small muted">Overlapping slots are rejected by a PostgreSQL EXCLUDE constraint.</p>
        </form>
      </div>

      <div className="card">
        <h2>Concepts I have mastered</h2>
        <table>
          <thead><tr><th>Concept</th><th>Score</th><th>Mastered</th><th>Note</th><th></th></tr></thead>
          <tbody>
            {mastery.map((x) => (
              <tr key={x.concept_id}>
                <td>{x.concept_name} <span className="small muted">({x.course_code})</span></td>
                <td>{x.score}</td><td className="small">{fmt(x.mastered_at)}</td>
                <td className="small muted">{x.note}</td>
                <td>
                  <div className="row">
                    <button className="ghost" onClick={() => { setM({ concept_id: String(x.concept_id), score: x.score, note: x.note }); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Edit</button>
                    <button className="ghost" onClick={() => del(`/api/mastery?concept_id=${x.concept_id}`)}>Remove</button>
                  </div>
                </td>
              </tr>
            ))}
            {mastery.length === 0 && <tr><td colSpan={5} className="muted">Nothing recorded yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>My upcoming slots</h2>
        <table>
          <thead><tr><th>Start</th><th>End</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {slots.map((x) => (
              <tr key={x.slot_id}>
                <td>{fmt(x.start_time)}</td><td>{fmt(x.end_time)}</td>
                <td><span className={`badge ${x.is_booked ? "scheduled" : "open"}`}>{x.is_booked ? "booked" : "free"}</span></td>
                <td>{!x.is_booked && <button className="ghost" onClick={() => del(`/api/slots?slot_id=${x.slot_id}`)}>Delete</button>}</td>
              </tr>
            ))}
            {slots.length === 0 && <tr><td colSpan={4} className="muted">No slots yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
