"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, fmt, highlight } from "@/lib/client";

export default function Browse() {
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<"keyword" | "semantic">("keyword");
  const [rows, setRows] = useState<any[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const search = useCallback(async (term: string, m: "keyword" | "semantic") => {
    setErr(""); setBusy(true);
    try {
      const r = await api(`/api/doubts?scope=open&mode=${m}&q=${encodeURIComponent(term)}`);
      setRows(r.doubts);
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  }, []);
  useEffect(() => { search("", "keyword"); }, [search]);

  return (
    <>
      <h1>Browse open doubts</h1>
      <p className="muted">
        <b>Keyword</b> uses PostgreSQL full-text search (tsvector + GIN, ranked with ts_rank).
        <b> Semantic</b> embeds your query and finds doubts closest in meaning (pgvector cosine similarity), even with different words.
      </p>
      <form className="row" onSubmit={(e) => { e.preventDefault(); search(q, mode); }} style={{ marginBottom: 14 }}>
        <select style={{ width: 130 }} value={mode} onChange={(e) => setMode(e.target.value as any)}>
          <option value="keyword">Keyword</option>
          <option value="semantic">Semantic</option>
        </select>
        <input style={{ flex: 1 }}
               placeholder={mode === "keyword" ? 'e.g. deadlock, "page fault", index -hash' : "describe what you can help with, in your own words"}
               value={q} onChange={(e) => setQ(e.target.value)} />
        <button disabled={busy}>{busy ? "Searching..." : "Search"}</button>
      </form>
      {err && <div className="alert err">{err}</div>}
      {rows.map((d) => (
        <div className="card" key={d.doubt_id}>
          <div className="row between">
            <h3><Link href={`/doubts/${d.doubt_id}`}>{d.title}</Link></h3>
            <span className="badge">{d.course_code}</span>
          </div>
          <p className="small" style={{ margin: "6px 0" }}>
            {highlight(d.snippet).map((p, i) => p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>)}
            {d.snippet.length >= 160 && !q ? "..." : ""}
          </p>
          <div className="small muted">
            {d.asker_name} &middot; {fmt(d.created_at)}
            {d.rank !== undefined && <> &middot; rank {Number(d.rank).toFixed(3)}</>}
            {d.similarity !== undefined && <> &middot; {Math.round(Number(d.similarity) * 100)}% similar</>}
          </div>
        </div>
      ))}
      {rows.length === 0 && <div className="card muted">No open doubts match.</div>}
    </>
  );
}
