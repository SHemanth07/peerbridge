import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { queryAuth } from "@/lib/db";
import { HttpError, setSessionCookie, signSession } from "@/lib/auth";
import { handle, json } from "@/lib/http";

export const POST = handle(async (req) => {
  const b = await json<{ email?: string; password?: string }>(req);
  const rows = await queryAuth(
    "SELECT user_id, email, full_name, role, password_hash FROM users WHERE email = $1",
    [(b.email ?? "").trim().toLowerCase()]
  );
  const u = rows[0];
  const ok = u && (await bcrypt.compare(b.password ?? "", u.password_hash));
  if (!ok) throw new HttpError(401, "Invalid email or password");

  const token = await signSession({ userId: u.user_id, role: u.role, name: u.full_name, email: u.email });
  const res = NextResponse.json({
    user: { user_id: u.user_id, email: u.email, full_name: u.full_name, role: u.role },
  });
  setSessionCookie(res, token);
  return res;
});
