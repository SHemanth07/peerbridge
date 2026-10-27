import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { queryAuth } from "@/lib/db";
import { HttpError, setSessionCookie, signSession } from "@/lib/auth";
import { handle, json } from "@/lib/http";

// Public registration always creates a 'student'. The pb_auth database role has no INSERT privilege on
// users.role / users.reputation (column-level GRANT) and an RLS policy requires role = 'student',
// so privilege escalation is impossible even if this code were changed. Admins are created only via seed/SQL.
export const POST = handle(async (req) => {
  const b = await json<{ email?: string; password?: string; full_name?: string; semester?: number }>(req);
  const email = (b.email ?? "").trim().toLowerCase();
  if (!b.password || b.password.length < 8) throw new HttpError(400, "Password must be at least 8 characters");
  const hash = await bcrypt.hash(b.password, 10);

  // format / length rules are enforced by DB CHECK constraints; errors surface via handle()
  const rows = await queryAuth(
    `INSERT INTO users (email, password_hash, full_name, semester)
     VALUES ($1, $2, $3, $4)
     RETURNING user_id, email, full_name, role`,
    [email, hash, (b.full_name ?? "").trim(), b.semester ?? null]
  );
  const u = rows[0];
  const token = await signSession({ userId: u.user_id, role: u.role, name: u.full_name, email: u.email });
  const res = NextResponse.json({ user: u }, { status: 201 });
  setSessionCookie(res, token);
  return res;
});
