"use client";
import { useCallback, useEffect, useState } from "react";
import { api, fmt } from "@/lib/client";
import { useMe } from "@/components/UserContext";

export default function Sessions() {
  const me = useMe();
  const [rows, setRows] = useState<any[]>([]);
  const [rating, setRating] = useState<Record<number, number>>({});
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => setRows((await api("/api/sessions")).sessions), []);
  useEffect(() => { load().catch((e) => setErr(e.message)); }, [load]);

  async function act(id: number, kind: "complete" | "cancel") {
    setErr(""); setMsg("");
    try {
      await api(`/api/sessions/${id}/${kind}`, { body: kind === "complete" ? { rating: rating[id] ?? 5 } : {} });
      setMsg(kind === "complete" ? "Session completed - helper earned reputation" : "Session cancelled - slot freed");
      await load();
    } catch (e: any) { setErr(e.message); }
  }

  return (
    <>
      <h1>{me.role === "admin" ? "All sessions" : "Sessions"}</h1>
      {err && <div className="alert err">{err}</div>}
      {msg && <div className="alert ok">{msg}</div>}
      <div className="card">
        <table>
          <thead><tr><th>When</th><th>Doubt</th><th>Asker</th><th>Helper</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.session_id}>
                <td className="small">{fmt(s.start_time)}</td>
                <td>{s.doubt_title}</td>
                <td>{s.asker_name}</td><td>{s.helper_name}</td>
                <td><span className={`badge ${s.status}`}>{s.status}</span>{s.rating && <> &middot; {s.rating}/5</>}</td>
                <td>
                  {me.role === "student" && s.status === "scheduled" && (
                    <div className="row">
                      {s.asker_id === me.user_id && (
                        <>
                          <select style={{ width: 70 }} value={rating[s.session_id] ?? 5}
                                  onChange={(e) => setRating({ ...rating, [s.session_id]: Number(e.target.value) })}>
                            {[5, 4, 3, 2, 1].map((n) => <option key={n}>{n}</option>)}
                          </select>
                          <button onClick={() => act(s.session_id, "complete")}>Mark resolved</button>
                        </>
                      )}
                      <button className="ghost" onClick={() => act(s.session_id, "cancel")}>Cancel</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="muted">No sessions yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
