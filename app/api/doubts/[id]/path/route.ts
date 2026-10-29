import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { HttpError, requireSession } from "@/lib/auth";
import { handle, intParam } from "@/lib/http";

/** Learning path: fn_learning_path() walks the concept-prerequisite graph with a RECURSIVE CTE. */
export const GET = handle(async (_req, ctx) => {
  const s = await requireSession();
  const id = intParam((await ctx.params).id, "id");
  const d = (await query(s, "SELECT asker_id FROM doubts WHERE doubt_id = $1", [id]))[0];
  if (!d) throw new HttpError(404, "Doubt not found");
  if (d.asker_id !== s.userId && s.role !== "admin") throw new HttpError(403, "Not allowed");
  const path = await query(s, "SELECT * FROM fn_learning_path($1)", [id]);
  return NextResponse.json({ path });
});
