import { NextRequest, NextResponse } from "next/server";
import { HttpError } from "./auth";

type Ctx = { params: Promise<Record<string, string>> };
type Handler = (req: NextRequest, ctx: Ctx) => Promise<Response>;

/** Postgres error codes -> HTTP status. The DB message is shown: validation lives in the DB. */
const PG_STATUS: Record<string, number> = {
  "23505": 409, // unique_violation
  "23P01": 409, // exclusion_violation (overlapping slot)
  "23514": 400, // check_violation
  "23503": 400, // foreign_key_violation
  "23502": 400, // not_null_violation
  "22P02": 400, // invalid_text_representation
  "P0001": 400, // RAISE EXCEPTION from triggers / procedures
  "42501": 403, // insufficient_privilege / row-level-security violation (database RBAC)
  "PB404": 404, // custom: not found (raised by stored procedures)
  "PB409": 409, // custom: conflict, e.g. slot already booked
};

function friendly(code: string, e: any): string {
  if (code === "23505") return "That record already exists (" + (e.constraint ?? "duplicate") + ")";
  if (code === "23P01") return "That time overlaps another slot you already have";
  if (code === "23514") return "Value rejected by database rule: " + (e.constraint ?? "check constraint");
  if (code === "23503") return "Referenced record does not exist";
  if (code === "42501") {
    const m: string = e.message ?? "";
    if (m.includes("row-level security")) return "Not allowed: that row is outside your access";
    if (m.includes("permission denied")) return "Not allowed: your database role lacks permission for this action";
    return m; // explicit message raised by a stored procedure
  }
  return e.message;
}

export function handle(fn: Handler): Handler {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (e: any) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
      const code = e?.code as string | undefined;
      if (code && PG_STATUS[code]) {
        return NextResponse.json({ error: friendly(code, e) }, { status: PG_STATUS[code] });
      }
      console.error(e);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  };
}

export async function json<T = any>(req: NextRequest): Promise<T> {
  try { return (await req.json()) as T; }
  catch { throw new HttpError(400, "Invalid JSON body"); }
}

export function intParam(v: unknown, name: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `${name} must be a positive integer`);
  return n;
}
