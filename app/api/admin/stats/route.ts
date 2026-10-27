import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { handle } from "@/lib/http";

// Admin dashboard: everything comes from views + the audit table (pb_admin role only).
export const GET = handle(async () => {
  const s = await requireSession(["admin"]);
  const [stats, leaderboard, gaps, unserved, audit] = await Promise.all([
    query(s, "SELECT * FROM v_platform_stats"),
    query(s, "SELECT * FROM v_helper_leaderboard ORDER BY reputation DESC, sessions_done DESC LIMIT 10"),
    query(
      s,
      `SELECT * FROM v_concept_demand_supply
       WHERE open_doubts > 0 ORDER BY (open_doubts - helpers) DESC, open_doubts DESC LIMIT 10`
    ),
    query(s, "SELECT * FROM v_unserved_doubts ORDER BY created_at DESC LIMIT 10"),
    query(
      s,
      `SELECT log_id, table_name, action, row_id, changed_at,
              details ->> 'status' AS status, details ->> 'title' AS title
       FROM audit_log ORDER BY log_id DESC LIMIT 15`
    ),
  ]);
  return NextResponse.json({ stats: stats[0], leaderboard, gaps, unserved, audit });
});
