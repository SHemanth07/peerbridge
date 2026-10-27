import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { HttpError, requireSession } from "@/lib/auth";
import { handle, intParam, json } from "@/lib/http";

export const GET = handle(async () => {
  const s = await requireSession(["student"]);
  const rows = await query(
    s,
    `SELECT slot_id, start_time, end_time, is_booked
     FROM availability_slots WHERE helper_id = $1 AND end_time > now()
     ORDER BY start_time`,
    [s.userId]
  );
  return NextResponse.json({ slots: rows });
});

// Ordering, max length (2h) and no-overlap are enforced by DB constraints (incl. the EXCLUDE constraint).
export const POST = handle(async (req) => {
  const s = await requireSession(["student"]);
  const b = await json<{ start_time?: string; end_time?: string }>(req);
  if (!b.start_time || !b.end_time) throw new HttpError(400, "start_time and end_time are required");
  const rows = await query(
    s,
    `INSERT INTO availability_slots (helper_id, start_time, end_time)
     VALUES ($1, $2, $3) RETURNING slot_id`,
    [s.userId, b.start_time, b.end_time]
  );
  return NextResponse.json({ slot: rows[0] }, { status: 201 });
});

export const DELETE = handle(async (req) => {
  const s = await requireSession(["student"]);
  const id = intParam(new URL(req.url).searchParams.get("slot_id"), "slot_id");
  const rows = await query(
    s,
    "DELETE FROM availability_slots WHERE slot_id = $1 AND helper_id = $2 AND NOT is_booked RETURNING slot_id",
    [id, s.userId]
  );
  if (!rows[0]) throw new HttpError(404, "Slot not found, or already booked");
  return NextResponse.json({ ok: true });
});
