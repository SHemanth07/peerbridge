import { NextResponse } from "next/server";
import { query, withTransaction } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { handle, intParam, json } from "@/lib/http";

export const GET = handle(async () => {
  const s = await requireSession();
  const rows = await query(
    s,
    `SELECT se.session_id, se.status, se.rating, se.feedback, se.asker_id, se.helper_id,
            d.doubt_id, d.title AS doubt_title,
            h.full_name AS helper_name, a.full_name AS asker_name,
            sl.start_time, sl.end_time
     FROM sessions se
     JOIN doubts d ON d.doubt_id = se.doubt_id
     JOIN users h ON h.user_id = se.helper_id
     JOIN users a ON a.user_id = se.asker_id
     JOIN availability_slots sl ON sl.slot_id = se.slot_id
     WHERE ($1::text = 'admin') OR se.asker_id = $2 OR se.helper_id = $2
     ORDER BY sl.start_time DESC`,
    [s.role, s.userId]
  );
  return NextResponse.json({ sessions: rows });
});

/**
 * Book a session - an explicit ACID transaction (BEGIN ... COMMIT) that calls the stored
 * procedure sp_book_session():  lock slot (FOR UPDATE) -> lock doubt -> INSERT session.
 * Two students racing for the same slot: the second waits on the row lock, then gets 409.
 * Triggers (trg_validate_session / trg_session_created) re-check rules and flip slot + doubt state.
 * The asker is the authenticated user taken from the DB session variable, not from the request body.
 */
export const POST = handle(async (req) => {
  const s = await requireSession(["student"]);
  const b = await json<{ doubt_id?: number; helper_id?: number; slot_id?: number }>(req);
  const doubtId = intParam(b.doubt_id, "doubt_id");
  const helperId = intParam(b.helper_id, "helper_id");
  const slotId = intParam(b.slot_id, "slot_id");

  const session = await withTransaction(s, async (c) => {
    const r = await c.query("CALL sp_book_session($1, $2, $3, NULL)", [doubtId, helperId, slotId]);
    return { session_id: r.rows[0].p_session_id, status: "scheduled" };
  });
  return NextResponse.json({ session }, { status: 201 });
});
