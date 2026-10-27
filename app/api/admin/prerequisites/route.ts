import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { handle, intParam, json } from "@/lib/http";

// Admin curates the concept-prerequisite graph. Same-course and no-cycle rules are enforced by trg_validate_prereq.
export const GET = handle(async () => {
  const s = await requireSession(["admin"]);
  const rows = await query(
    s,
    `SELECT p.concept_id, p.prerequisite_id, c.name AS concept_name, r.name AS prerequisite_name, co.code AS course_code
     FROM concept_prerequisites p
     JOIN concepts c  ON c.concept_id = p.concept_id
     JOIN concepts r  ON r.concept_id = p.prerequisite_id
     JOIN courses  co ON co.course_id = c.course_id
     ORDER BY co.code, c.name, r.name`
  );
  return NextResponse.json({ prerequisites: rows });
});

export const POST = handle(async (req) => {
  const s = await requireSession(["admin"]);
  const b = await json<{ concept_id?: number; prerequisite_id?: number }>(req);
  await query(s, "INSERT INTO concept_prerequisites (concept_id, prerequisite_id) VALUES ($1, $2)", [
    intParam(b.concept_id, "concept_id"),
    intParam(b.prerequisite_id, "prerequisite_id"),
  ]);
  return NextResponse.json({ ok: true }, { status: 201 });
});

export const DELETE = handle(async (req) => {
  const s = await requireSession(["admin"]);
  const sp = new URL(req.url).searchParams;
  await query(s, "DELETE FROM concept_prerequisites WHERE concept_id = $1 AND prerequisite_id = $2", [
    intParam(sp.get("concept_id"), "concept_id"),
    intParam(sp.get("prerequisite_id"), "prerequisite_id"),
  ]);
  return NextResponse.json({ ok: true });
});
