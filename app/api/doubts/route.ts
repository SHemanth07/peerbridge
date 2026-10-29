import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { HttpError, requireSession } from "@/lib/auth";
import { embed, toVector } from "@/lib/embed";
import { MIN_SIM, autoTag } from "@/lib/semantic";
import { handle, intParam, json } from "@/lib/http";

/**
 * GET /api/doubts?scope=mine|open|all&q=...&mode=keyword|semantic
 *   mine : the caller's own doubts
 *   open : other students' open doubts
 *            no q           -> view v_open_doubts
 *            q, keyword     -> PostgreSQL full-text search (tsvector + GIN, ts_rank, ts_headline)
 *            q, semantic    -> pgvector: embed the query, nearest doubt embeddings by cosine distance (HNSW)
 *   all  : admin only
 */
export const GET = handle(async (req) => {
  const s = await requireSession();
  const sp = new URL(req.url).searchParams;
  const scope = sp.get("scope") ?? "mine";
  const q = (sp.get("q") ?? "").trim();
  const mode = sp.get("mode") === "semantic" ? "semantic" : "keyword";

  if (scope === "mine") {
    const rows = await query(
      s,
      `SELECT d.doubt_id, d.title, d.status, d.created_at, c.code AS course_code, k.name AS concept_name
       FROM doubts d
       JOIN courses c ON c.course_id = d.course_id
       LEFT JOIN concepts k ON k.concept_id = d.concept_id
       WHERE d.asker_id = $1
       ORDER BY d.created_at DESC`,
      [s.userId]
    );
    return NextResponse.json({ doubts: rows });
  }

  if (scope === "all") {
    await requireSession(["admin"]);
    const rows = await query(
      s,
      `SELECT d.doubt_id, d.title, d.status, d.created_at, c.code AS course_code, u.full_name AS asker_name
       FROM doubts d
       JOIN courses c ON c.course_id = d.course_id
       JOIN users u ON u.user_id = d.asker_id
       ORDER BY d.created_at DESC LIMIT 100`
    );
    return NextResponse.json({ doubts: rows });
  }

  // scope === "open"
  if (q && mode === "semantic") {
    const vec = toVector(await embed(q));
    const rows = await query(
      s,
      `SELECT d.doubt_id, d.title, c.code AS course_code, u.full_name AS asker_name, d.created_at,
              left(d.body, 160) AS snippet,
              1 - (d.embedding <=> $1::vector) AS similarity
       FROM doubts d
       JOIN courses c ON c.course_id = d.course_id
       JOIN users u ON u.user_id = d.asker_id
       WHERE d.status = 'open' AND d.asker_id <> $2 AND d.embedding IS NOT NULL
         AND 1 - (d.embedding <=> $1::vector) >= $3
       ORDER BY d.embedding <=> $1::vector
       LIMIT 20`,
      [vec, s.userId, MIN_SIM]
    );
    return NextResponse.json({ doubts: rows, mode: "semantic" });
  }
  if (q) {
    const rows = await query(
      s,
      `SELECT d.doubt_id, d.title, c.code AS course_code, u.full_name AS asker_name, d.created_at,
              ts_rank(d.search_tsv, query) AS rank,
              ts_headline('english', d.body, query,
                          'MaxWords=30, MinWords=12, StartSel=<<, StopSel=>>') AS snippet
       FROM doubts d
       JOIN courses c ON c.course_id = d.course_id
       JOIN users u ON u.user_id = d.asker_id,
            websearch_to_tsquery('english', $1) query
       WHERE d.status = 'open' AND d.asker_id <> $2 AND d.search_tsv @@ query
       ORDER BY rank DESC LIMIT 30`,
      [q, s.userId]
    );
    return NextResponse.json({ doubts: rows, mode: "keyword" });
  }
  const rows = await query(
    s,
    `SELECT doubt_id, title, course_code, asker_name, created_at, left(body, 160) AS snippet
     FROM v_open_doubts WHERE asker_id <> $1 ORDER BY created_at DESC LIMIT 30`,
    [s.userId]
  );
  return NextResponse.json({ doubts: rows });
});

/** POST /api/doubts : embed the doubt, auto-tag the nearest concept in its course, insert. */
export const POST = handle(async (req) => {
  const s = await requireSession(["student"]);
  const b = await json<{ course_id?: number; title?: string; body?: string; concept_id?: number | null }>(req);
  const courseId = intParam(b.course_id, "course_id");
  const title = (b.title ?? "").trim();
  const body = (b.body ?? "").trim();
  if (title.length < 8 || body.length < 20) {
    throw new HttpError(400, "Title needs 8+ characters and description 20+ characters");
  }

  const vec = toVector(await embed(`${title}. ${body}`));

  let conceptId: number | null = b.concept_id ? intParam(b.concept_id, "concept_id") : null;
  let autoTagged = false;
  if (!conceptId) {
    conceptId = await autoTag(s, vec, courseId);
    autoTagged = conceptId !== null;
  }

  const rows = await query(
    s,
    `INSERT INTO doubts (asker_id, course_id, concept_id, title, body, embedding)
     VALUES ($1, $2, $3, $4, $5, $6::vector)
     RETURNING doubt_id, concept_id`,
    [s.userId, courseId, conceptId, title, body, vec]
  );
  return NextResponse.json({ doubt: rows[0], autoTagged }, { status: 201 });
});
