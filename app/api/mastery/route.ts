import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { HttpError, requireSession } from "@/lib/auth";
import { embed, toVector } from "@/lib/embed";
import { handle, intParam, json } from "@/lib/http";

export const GET = handle(async () => {
  const s = await requireSession(["student"]);
  const rows = await query(
    s,
    `SELECT m.concept_id, k.name AS concept_name, c.code AS course_code,
            m.score, m.note, m.mastered_at
     FROM mastery m
     JOIN concepts k ON k.concept_id = m.concept_id
     JOIN courses  c ON c.course_id  = k.course_id
     WHERE m.user_id = $1 ORDER BY m.mastered_at DESC`,
    [s.userId]
  );
  return NextResponse.json({ mastery: rows });
});

// VECTOR CREATE / UPDATE: record (or refresh) "I mastered this concept". Refreshing recomputes the embedding and resets the recency clock.
export const POST = handle(async (req) => {
  const s = await requireSession(["student"]);
  const b = await json<{ concept_id?: number; score?: number; note?: string }>(req);
  const conceptId = intParam(b.concept_id, "concept_id");
  const note = (b.note ?? "").trim();

  const k = (await query(s, "SELECT name, description FROM concepts WHERE concept_id = $1", [conceptId]))[0];
  if (!k) throw new HttpError(404, "Concept not found");
  if (note.length < 10) throw new HttpError(400, "Describe what you learned in at least 10 characters");

  // embedding text = concept + the helper's own words -> peers are matched on how they understood it
  const vec = toVector(await embed(`${k.name}. ${k.description}. ${note}`));
  await query(
    s,
    `INSERT INTO mastery (user_id, concept_id, score, note, embedding)
     VALUES ($1, $2, $3, $4, $5::vector)
     ON CONFLICT (user_id, concept_id)
     DO UPDATE SET score = EXCLUDED.score, note = EXCLUDED.note,
                   embedding = EXCLUDED.embedding, mastered_at = now()`,
    [s.userId, conceptId, b.score, note, vec]
  );
  return NextResponse.json({ ok: true }, { status: 201 });
});

// VECTOR DELETE: the row and its embedding (and HNSW entry) disappear together.
export const DELETE = handle(async (req) => {
  const s = await requireSession(["student"]);
  const id = intParam(new URL(req.url).searchParams.get("concept_id"), "concept_id");
  await query(s, "DELETE FROM mastery WHERE user_id = $1 AND concept_id = $2", [s.userId, id]);
  return NextResponse.json({ ok: true });
});
