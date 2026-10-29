import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { HttpError, requireSession } from "@/lib/auth";
import { handle, intParam } from "@/lib/http";

/** VECTOR READ: other students' open doubts closest in meaning to this one (cosine, HNSW index). */
export const GET = handle(async (_req, ctx) => {
  const s = await requireSession();
  const id = intParam((await ctx.params).id, "id");
  const d = (await query(s, "SELECT asker_id, embedding::text AS emb FROM doubts WHERE doubt_id = $1", [id]))[0];
  if (!d) throw new HttpError(404, "Doubt not found");
  if (d.asker_id !== s.userId && s.role !== "admin") throw new HttpError(403, "Not allowed");

  const rows = await query(
    s,
    `SELECT o.doubt_id, o.title, c.code AS course_code, 1 - (o.embedding <=> $1::vector) AS similarity
     FROM doubts o JOIN courses c ON c.course_id = o.course_id
     WHERE o.doubt_id <> $2 AND o.status = 'open' AND o.asker_id <> $3 AND o.embedding IS NOT NULL
     ORDER BY o.embedding <=> $1::vector
     LIMIT 3`,
    [d.emb, id, d.asker_id]
  );
  return NextResponse.json({ similar: rows });
});
