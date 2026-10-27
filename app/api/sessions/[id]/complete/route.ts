import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { HttpError, requireSession } from "@/lib/auth";
import { handle, intParam, json } from "@/lib/http";

// The asker confirms the help they received and rates it (1-5).
// Calls the stored procedure; triggers resolve the doubt and award reputation to the helper.
export const POST = handle(async (req, ctx) => {
  const s = await requireSession(["student"]);
  const id = intParam((await ctx.params).id, "id");
  const b = await json<{ rating?: number; feedback?: string }>(req);

  const se = (await query(s, "SELECT asker_id FROM sessions WHERE session_id = $1", [id]))[0];
  if (!se) throw new HttpError(404, "Session not found");
  if (se.asker_id !== s.userId) throw new HttpError(403, "Only the student who asked can complete the session");

  const rating = Number(b.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new HttpError(400, "Rating must be a whole number from 1 to 5");
  await query(s, "CALL sp_complete_session($1, $2::smallint, $3)", [id, rating, b.feedback ?? null]);
  return NextResponse.json({ ok: true });
});
