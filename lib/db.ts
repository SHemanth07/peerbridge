import { Pool, PoolClient } from "pg";
import type { Session } from "./auth";

const g = globalThis as unknown as { __pgPool?: Pool };

function getPool(): Pool {
  if (!g.__pgPool) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set (see .env.example)");
    g.__pgPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
  }
  return g.__pgPool;
}

/** App role -> PostgreSQL role (whitelist; SET ROLE cannot take a bind parameter). */
const DB_ROLE = { student: "pb_student", admin: "pb_admin" } as const;

/**
 * Role-based access control lives in PostgreSQL (db/04_roles_rls.sql).
 * Every request runs in ONE transaction as the caller's database role:
 *
 *     BEGIN;
 *     SET LOCAL ROLE pb_student | pb_admin | pb_auth;
 *     SELECT set_config('app.user_id', '<id>', true);   -- read by RLS policies
 *     ... statements ...
 *     COMMIT;                                            -- SET LOCAL is undone automatically
 *
 * The connection user (pb_app) has no table privileges of its own, so a route
 * that forgets to pass a session simply gets "permission denied" from the database.
 */
export async function withTransaction<T>(
  who: Session | "auth",
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    if (who === "auth") {
      await client.query("SET LOCAL ROLE pb_auth");
    } else {
      await client.query(`SET LOCAL ROLE ${DB_ROLE[who.role]}`);
      await client.query("SELECT set_config('app.user_id', $1, true)", [String(who.userId)]);
    }
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** One statement as the logged-in user's database role (student or admin). */
export async function query<T = any>(who: Session, text: string, params: unknown[] = []): Promise<T[]> {
  return withTransaction(who, async (c) => (await c.query(text, params as any[])).rows as T[]);
}

/** One statement as pb_auth: only used by login / register, before a session exists. */
export async function queryAuth<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  return withTransaction("auth", async (c) => (await c.query(text, params as any[])).rows as T[]);
}
