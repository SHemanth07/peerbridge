import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { HttpError, requireSession } from "@/lib/auth";
import { handle, intParam } from "@/lib/http";

/** Semantic peer matching: delegates to the stored function fn_find_peers(), then attaches free slots. */
export const GET = handle(async (_req, ctx) => {
  const s = await requireSession();
  const id = intParam((await ctx.params).id, "id");

  const d = (await query(s, "SELECT asker_id, status FROM doubts WHERE doubt_id = $1", [id]))[0];
  if (!d) throw new HttpError(404, "Doubt not found");
  if (d.asker_id !== s.userId && s.role !== "admin") throw new HttpError(403, "Only the asker can view matches");

  const peers = await query(s, "SELECT * FROM fn_find_peers($1, 5)", [id]);
  const ids = peers.map((p) => p.peer_id);
  const slots = ids.length
    ? await query(
        s,
        `SELECT slot_id, helper_id, start_time, end_time
         FROM availability_slots
         WHERE helper_id = ANY($1::int[]) AND NOT is_booked AND start_time > now()
         ORDER BY start_time`,
        [ids]
      )
    : [];
  return NextResponse.json({
    status: d.status,
    matches: peers.map((p) => ({ ...p, slots: slots.filter((sl) => sl.helper_id === p.peer_id).slice(0, 6) })),
  });
});
