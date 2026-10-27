import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { handle, intParam, json } from "@/lib/http";

export const POST = handle(async (req) => {
  const s = await requireSession(["student"]);
  const b = await json<{ course_id?: number }>(req);
  const rows = await query(
    s,
    `INSERT INTO enrolments (user_id, course_id) VALUES ($1, $2) RETURNING user_id, course_id`,
    [s.userId, intParam(b.course_id, "course_id")]
  );
  return NextResponse.json({ enrolment: rows[0] }, { status: 201 });
});

export const DELETE = handle(async (req) => {
  const s = await requireSession(["student"]);
  const course = intParam(new URL(req.url).searchParams.get("course_id"), "course_id");
  await query(s, "DELETE FROM enrolments WHERE user_id = $1 AND course_id = $2", [s.userId, course]);
  return NextResponse.json({ ok: true });
});
