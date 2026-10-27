import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { HttpError, requireSession } from "@/lib/auth";
import { handle, intParam } from "@/lib/http";

// Either participant can cancel a scheduled session; a trigger frees the slot and re-opens the doubt.
export const POST = handle(async (_req, ctx) => {
  const s = await requireSession(["student"]);
  const id = intParam((await ctx.params).id, "id");
  const rows = await query(
    s,
    `UPDATE sessions SET status = 'cancelled'
     WHERE session_id = $1 AND status = 'scheduled' AND (asker_id = $2 OR helper_id = $2)
     RETURNING session_id`,
    [id, s.userId]
  );
  if (!rows[0]) throw new HttpError(404, "No cancellable session found");
  return NextResponse.json({ ok: true });
});
