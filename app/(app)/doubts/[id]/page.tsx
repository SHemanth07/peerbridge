"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, fmt } from "@/lib/client";
import { useMe } from "@/components/UserContext";

export default function DoubtDetail() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const [doubt, setDoubt] = useState<any>(null);
  const [matches, setMatches] = useState<any[]>([]);
  const [path, setPath] = useState<any[]>([]);
  const [similar, setSimilar] = useState<any[]>([]);
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({ title: "", body: "" });
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const d = await api(`/api/doubts/${id}`);
    setDoubt(d.doubt);
    setF({ title: d.doubt.title, body: d.doubt.body });
    if (d.doubt.asker_id === me.user_id || me.role === "admin") {
      const [m, p, s] = await Promise.all([
        api(`/api/doubts/${id}/matches`), api(`/api/doubts/${id}/path`), api(`/api/doubts/${id}/similar`),
      ]);
      setMatches(m.matches); setPath(p.path); setSimilar(s.similar);
    }
  }, [id, me.user_id, me.role]);
  useEffect(() => { load().catch((e) => setErr(e.message)); }, [load]);

  async function book(helperId: number, slotId: number) {
    setErr(""); setMsg("");
    try {
      await api("/api/sessions", { body: { doubt_id: Number(id), helper_id: helperId, slot_id: slotId } });
      setMsg("Session booked!");
      await load();
    } catch (e: any) { setErr(e.message); load().catch(() => {}); }
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setMsg(""); setBusy(true);
    try {
      await api(`/api/doubts/${id}`, { method: "PATCH", body: f });
      setMsg("Saved. The doubt was re-embedded and the peer ranking refreshed.");
      setEditing(false);
      await load();
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  }

  if (!doubt) return err ? <div className="alert err">{err}</div> : <div className="muted">Loading...</div>;
  const mine = doubt.asker_id === me.user_id;

  return (
    <>
      <p className="small"><Link href="/doubts">&larr; My doubts</Link></p>
      <div className="card">
        <div className="row between">
          <h1>{doubt.title}</h1>
          <span className={`badge ${doubt.status}`}>{doubt.status}</span>
        </div>
        <div className="small muted">{doubt.course_code} - {doubt.course_title}
          {doubt.concept_name && <> &nbsp;|&nbsp; concept: <b>{doubt.concept_name}</b></>}</div>
        {!editing && <p style={{ whiteSpace: "pre-wrap" }}>{doubt.body}</p>}
        {mine && doubt.status === "open" && !editing && (
          <button className="ghost" onClick={() => setEditing(true)}>Edit doubt</button>
        )}
        {editing && (
          <form onSubmit={saveEdit}>
            <label>Title</label>
            <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} minLength={8} required />
            <label>Description</label>
            <textarea value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} minLength={20} required />
            <div className="row" style={{ marginTop: 12 }}>
              <button disabled={busy}>{busy ? "Re-embedding..." : "Save and re-match"}</button>
              <button type="button" className="ghost" onClick={() => setEditing(false)}>Cancel</button>
            </div>
            <p className="small muted">Saving recomputes the vector embedding and re-tags the concept.</p>
          </form>
        )}
      </div>

      {err && <div className="alert err">{err}</div>}
      {msg && <div className="alert ok">{msg} <Link href="/sessions">View sessions</Link></div>}

      {(mine || me.role === "admin") && path.length > 0 && (
        <div className="card">
          <h2>Learning path</h2>
          <p className="small muted">
            Foundations of <b>{doubt.concept_name}</b>, found by a recursive query over the prerequisite graph. Study in this order.
          </p>
          <table>
            <thead><tr><th>Level</th><th>Prerequisite</th><th>You</th><th>Peers who mastered it</th></tr></thead>
            <tbody>
              {path.map((p) => (
                <tr key={p.concept_id}>
                  <td>{p.depth}</td><td>{p.concept_name}</td>
                  <td>{p.already_mastered ? <span className="badge resolved">mastered</span> : <span className="badge">not yet</span>}</td>
                  <td>{p.helpers}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {mine && doubt.status === "open" && (
        <>
          <h2>Best peers for this doubt</h2>
          <p className="small muted">
            Ranked by <b>70% semantic similarity</b> (cosine, pgvector) + <b>20% recency</b> of mastery + <b>10% reputation</b>.
            Only peers with a free slot are shown.
          </p>
          {matches.length === 0 && <div className="card muted">No available peers found yet. Check back later.</div>}
          {matches.map((m) => (
            <div className="card" key={m.peer_id}>
              <div className="row between">
                <h3>{m.peer_name} <span className="muted small">- {m.peer_reputation} rep</span></h3>
                <b>{Math.round(m.match_score * 100)}% match</b>
              </div>
              <div className="bar" style={{ margin: "8px 0" }}><span style={{ width: `${Math.round(m.match_score * 100)}%` }} /></div>
              <div className="small">
                Mastered <b>{m.matched_concept}</b> on {fmt(m.mastered_at)} &middot; similarity {m.similarity.toFixed(2)} &middot; recency {m.recency.toFixed(2)}
              </div>
              <p className="small muted" style={{ margin: "6px 0" }}>&ldquo;{m.mastery_note}&rdquo;</p>
              <div>
                {m.slots.map((sl: any) => (
                  <button key={sl.slot_id} className="chip" onClick={() => book(m.peer_id, sl.slot_id)}>
                    Book {fmt(sl.start_time)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </>
      )}

      {(mine || me.role === "admin") && similar.length > 0 && (
        <div className="card">
          <h2>Others asking something similar</h2>
          <p className="small muted">Nearest open doubts by embedding (pgvector cosine similarity).</p>
          {similar.map((x) => (
            <div key={x.doubt_id} className="row between" style={{ padding: "6px 0" }}>
              <span><Link href={`/doubts/${x.doubt_id}`}>{x.title}</Link> <span className="small muted">{x.course_code}</span></span>
              <span className="small">{Math.round(x.similarity * 100)}% similar</span>
            </div>
          ))}
        </div>
      )}

      {mine && doubt.status !== "open" && (
        <div className="card muted">This doubt is {doubt.status}. See <Link href="/sessions">Sessions</Link> for details.</div>
      )}
      {!mine && me.role !== "admin" && (
        <div className="card muted">This is another student&rsquo;s open doubt. If you have mastered this topic, add it under <Link href="/expertise">My expertise</Link> and keep a slot open - the matcher will find you.</div>
      )}
    </>
  );
}
