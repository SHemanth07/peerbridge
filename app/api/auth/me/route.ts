import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { handle } from "@/lib/http";

export const GET = handle(async () => {
  const s = await requireSession();
  // runs as the caller's DB role; the email is not a readable column for students, so it comes from the signed session
  const rows = await query(
    s,
    "SELECT user_id, full_name, role, semester, reputation FROM users WHERE user_id = $1",
    [s.userId]
  );
  if (!rows[0]) return NextResponse.json({ error: "Account no longer exists" }, { status: 401 });
  return NextResponse.json({ user: { ...rows[0], email: s.email } });
});
