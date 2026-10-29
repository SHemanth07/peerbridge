import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { HttpError, requireSession } from "@/lib/auth";
import { embed, toVector } from "@/lib/embed";
import { handle, intParam, json } from "@/lib/http";
import { autoTag } from "@/lib/semantic";

export const GET = handle(async (_req, ctx) => {
  const s = await requireSession();
  const id = intParam((await ctx.params).id, "id");
  // row-level security already hides other students' non-open doubts; the check below gives a clean 403/404
  const rows = await query(
    s,
    `SELECT d.doubt_id, d.asker_id, d.title, d.body, d.status, d.created_at,
            c.code AS course_code, c.title AS course_title, k.name AS concept_name
     FROM doubts d
     JOIN courses c ON c.course_id = d.course_id
     LEFT JOIN concepts k ON k.concept_id = d.concept_id
     WHERE d.doubt_id = $1`,
    [id]
  );
  const d = rows[0];
  if (!d) throw new HttpError(404, "Doubt not found");
  return NextResponse.json({ doubt: d });
});

/**
 * PATCH : the owner rewrites a doubt while it is still open.
 * VECTOR UPDATE: the text changed, so its embedding is recomputed and the concept re-tagged;
 * pgvector updates the HNSW index entry automatically. The audit trigger logs the change.
 */
export const PATCH = handle(async (req, ctx) => {
  const s = await requireSession(["student"]);
  const id = intParam((await ctx.params).id, "id");
  const b = await json<{ title?: string; body?: string }>(req);
  const title = (b.title ?? "").trim();
  const body = (b.body ?? "").trim();
  if (title.length < 8 || body.length < 20) {
    throw new HttpError(400, "Title needs 8+ characters and description 20+ characters");
  }
  const cur = (await query(s, "SELECT course_id FROM doubts WHERE doubt_id = $1 AND asker_id = $2", [id, s.userId]))[0];
  if (!cur) throw new HttpError(404, "Doubt not found or not yours");

  const vec = toVector(await embed(`${title}. ${body}`));
  const conceptId = await autoTag(s, vec, cur.course_id);
  const rows = await query(
    s,
    `UPDATE doubts SET title = $1, body = $2, concept_id = $3, embedding = $4::vector
     WHERE doubt_id = $5 AND asker_id = $6 AND status = 'open'
     RETURNING doubt_id, concept_id`,
    [title, body, conceptId, vec, id, s.userId]
  );
  if (!rows[0]) throw new HttpError(409, "Only open doubts can be edited");
  return NextResponse.json({ doubt: rows[0] });
});

// Owner (while still open) or admin can delete. RLS + the audit trigger enforce / record it.
// VECTOR DELETE: removing the row removes its embedding from the HNSW index.
export const DELETE = handle(async (_req, ctx) => {
  const s = await requireSession();
  const id = intParam((await ctx.params).id, "id");
  const rows =
    s.role === "admin"
      ? await query(s, "DELETE FROM doubts WHERE doubt_id = $1 RETURNING doubt_id", [id])
      : await query(
          s,
          "DELETE FROM doubts WHERE doubt_id = $1 AND asker_id = $2 AND status = 'open' RETURNING doubt_id",
          [id, s.userId]
        );
  if (!rows[0]) throw new HttpError(404, "Doubt not found, not yours, or no longer open");
  return NextResponse.json({ ok: true });
});
