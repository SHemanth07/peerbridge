import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { handle } from "@/lib/http";

// Courses with their concepts, prerequisites, and whether the caller is enrolled.
export const GET = handle(async () => {
  const s = await requireSession();
  const courses = await query(
    s,
    `SELECT c.course_id, c.code, c.title,
            EXISTS (SELECT 1 FROM enrolments e
                    WHERE e.course_id = c.course_id AND e.user_id = $1) AS enrolled
     FROM courses c ORDER BY c.code`,
    [s.userId]
  );
  const concepts = await query(s, "SELECT concept_id, course_id, name FROM concepts ORDER BY name");
  const prereqs = await query(s, "SELECT concept_id, prerequisite_id FROM concept_prerequisites");
  return NextResponse.json({
    courses: courses.map((c) => ({ ...c, concepts: concepts.filter((k) => k.course_id === c.course_id) })),
    prerequisites: prereqs,
  });
});
