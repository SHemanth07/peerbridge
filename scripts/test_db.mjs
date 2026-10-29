// Database test suite.  Run after `npm run seed`:   npm run test:db
//
// Connects EXACTLY like the app does: as the restricted login role pb_app, then
//   SET LOCAL ROLE pb_student | pb_admin | pb_auth  +  set_config('app.user_id', ...)
// so the tests exercise the real permission boundary (GRANTs + row-level security).
// An owner connection is used only to look up fixture ids and to clean up.
import pg from "pg";

const APP = process.env.DATABASE_URL;
const OWNER = process.env.OWNER_DATABASE_URL;
if (!APP || !OWNER) { console.error("DATABASE_URL / OWNER_DATABASE_URL missing (.env)"); process.exit(1); }

const owner = new pg.Client({ connectionString: OWNER });
await owner.connect();

const results = [];
function record(id, name, ok, detail = "") {
  results.push({ id, name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${id}  ${name}${detail ? "   [" + detail + "]" : ""}`);
}

/** open a pb_app connection acting as role (+ user id), BEGIN already issued */
async function actor(role, userId = null) {
  const c = new pg.Client({ connectionString: APP });
  await c.connect();
  await c.query("BEGIN");
  if (role) await c.query(`SET LOCAL ROLE ${role}`);
  if (userId !== null) await c.query("SELECT set_config('app.user_id', $1, true)", [String(userId)]);
  return c;
}
async function done(c) { await c.query("ROLLBACK").catch(() => {}); await c.end(); }

/** run fn(client) as an actor inside a transaction that is always rolled back */
async function as(role, userId, fn) {
  const c = await actor(role, userId);
  try { return await fn(c); } finally { await done(c); }
}
/** expect the statement to fail with one of the SQLSTATE codes */
async function expectFail(role, userId, sql, params, codes, id, name) {
  const c = await actor(role, userId);
  try {
    await c.query(sql, params);
    record(id, name, false, "statement unexpectedly succeeded");
  } catch (e) {
    record(id, name, codes.includes(e.code), `${e.code}: ${e.message.slice(0, 70)}`);
  } finally { await done(c); }
}
/** expect a statement to affect / return zero rows (RLS hides them) */
async function expectNoRows(role, userId, sql, params, id, name) {
  const c = await actor(role, userId);
  try {
    const r = await c.query(sql, params);
    record(id, name, r.rowCount === 0, `rows=${r.rowCount}`);
  } catch (e) { record(id, name, false, e.message); } finally { await done(c); }
}

const one = async (sql, p = []) => (await owner.query(sql, p)).rows[0];
const uid = async (n) => (await one("SELECT user_id FROM users WHERE email = $1", [`${n}@student.edu`])).user_id;
const cid = async (n) => (await one("SELECT concept_id FROM concepts WHERE name = $1", [n])).concept_id;

// ------------------------------------------------------------------ fixtures
const U = {};
for (const n of ["aarav", "diya", "rohan", "meera", "kabir", "isha", "arjun", "sneha", "vikram"]) U[n] = await uid(n);
const adminId = (await one("SELECT user_id FROM users WHERE role = 'admin'")).user_id;
const K = {};
for (const n of ["Deadlocks", "Process Synchronization", "Threads versus Processes", "Transactions and ACID", "Normalization", "Concurrency Control", "Dynamic Programming"])
  K[n] = await cid(n);
const aaravDoubt = (await one("SELECT doubt_id FROM doubts WHERE asker_id = $1 AND status = 'open' ORDER BY doubt_id LIMIT 1", [U.aarav])).doubt_id;
const slotOf = async (n) => (await one("SELECT slot_id FROM availability_slots WHERE helper_id = $1 AND NOT is_booked AND start_time > now() ORDER BY start_time LIMIT 1", [U[n]])).slot_id;

console.log("\n=== A. Constraints, keys and triggers (data integrity in the database) ===");
await expectFail("pb_student", U.aarav, "INSERT INTO mastery(user_id,concept_id,score,note) VALUES ($1,$2,40,'score too low here')", [U.aarav, K["Normalization"]], ["23514"], "T01", "Mastery score 40 rejected by CHECK (70-100)");
await expectFail("pb_student", U.kabir, "INSERT INTO mastery(user_id,concept_id,score,note) VALUES ($1,$2,80,'not enrolled in OS course')", [U.kabir, K["Deadlocks"]], ["P0001"], "T02", "Mastery for a course the student is not enrolled in rejected by trigger");
{
  const s = await one("SELECT helper_id, start_time, end_time FROM availability_slots LIMIT 1");
  await expectFail("pb_student", s.helper_id, "INSERT INTO availability_slots(helper_id,start_time,end_time) VALUES ($1, $2::timestamptz + interval '10 min', $3::timestamptz + interval '10 min')", [s.helper_id, s.start_time, s.end_time], ["23P01"], "T03", "Overlapping slot rejected by EXCLUDE constraint");
  await expectFail("pb_student", s.helper_id, "INSERT INTO availability_slots(helper_id,start_time,end_time) VALUES ($1, now() + interval '30 days', now() + interval '30 days 3 hours')", [s.helper_id], ["23514"], "T04", "Slot longer than 2 hours rejected by CHECK");
}
await expectFail("pb_auth", null, "INSERT INTO users(email,password_hash,full_name) VALUES ('not-an-email','x','Test User')", [], ["23514"], "T05", "Invalid e-mail format rejected by CHECK");
{
  // owner-level so the CHECK itself is what fires (not RBAC)
  const c = new pg.Client({ connectionString: OWNER }); await c.connect(); await c.query("BEGIN");
  try {
    await c.query("INSERT INTO sessions(doubt_id,helper_id,asker_id,slot_id) VALUES (1,$1,$1,1)", [U.aarav]);
    record("T06", "Session with helper = asker rejected", false);
  } catch (e) { record("T06", "Session with helper = asker rejected (CHECK or trigger)", ["23514", "P0001"].includes(e.code), e.code); }
  await c.query("ROLLBACK"); await c.end();
}
{
  const c = new pg.Client({ connectionString: OWNER }); await c.connect(); await c.query("BEGIN");
  try {
    await c.query("UPDATE sessions SET rating = 9 WHERE session_id = (SELECT session_id FROM sessions WHERE status='completed' LIMIT 1)");
    record("T07", "Rating 9 rejected by CHECK", false);
  } catch (e) { record("T07", "Rating 9 rejected by CHECK (1-5)", e.code === "23514", e.code); }
  await c.query("ROLLBACK"); await c.end();
}
await expectFail("pb_admin", adminId, "INSERT INTO concept_prerequisites VALUES ($1, $2)", [K["Threads versus Processes"], K["Deadlocks"]], ["P0001"], "T08", "Prerequisite CYCLE (Threads -> Deadlocks closes a loop) rejected by recursive-CTE trigger");
await expectFail("pb_admin", adminId, "INSERT INTO concept_prerequisites VALUES ($1, $2)", [K["Deadlocks"], K["Normalization"]], ["P0001"], "T09", "Cross-course prerequisite rejected by trigger");
await expectFail("pb_admin", adminId, "INSERT INTO concept_prerequisites VALUES ($1, $1)", [K["Deadlocks"]], ["23514"], "T10", "Self-prerequisite rejected by CHECK");

console.log("\n=== B. Role-based access control inside PostgreSQL (GRANT + row-level security) ===");
await expectFail(null, null, "SELECT count(*) FROM users", [], ["42501"], "T11", "pb_app without SET ROLE has no table privileges");
await expectFail("pb_student", U.aarav, "SELECT password_hash FROM users", [], ["42501"], "T12", "Student cannot read users.password_hash (column privilege)");
await expectFail("pb_student", U.aarav, "SELECT email FROM users", [], ["42501"], "T13", "Student cannot read other users' e-mail (column privilege)");
await expectFail("pb_student", U.aarav, "SELECT * FROM audit_log", [], ["42501"], "T14", "Student cannot read audit_log");
{
  // pick a student who really has sessions, so the comparison is not 0 = 0
  const who = (await one("SELECT helper_id AS u FROM sessions GROUP BY helper_id ORDER BY count(*) DESC LIMIT 1")).u;
  await as("pb_student", who, async (c) => {
    const mine = (await c.query("SELECT count(*)::int n FROM sessions")).rows[0].n;
    const expected = (await owner.query("SELECT count(*)::int n FROM sessions WHERE asker_id = $1 OR helper_id = $1", [who])).rows[0].n;
    const total = (await owner.query("SELECT count(*)::int n FROM sessions")).rows[0].n;
    record("T15", "Student sees only the sessions he participates in (RLS)", mine === expected && mine > 0 && mine < total, `visible=${mine} expected=${expected} total=${total}`);
  });
}
await as("pb_student", U.aarav, async (c) => {
  const others = (await c.query("SELECT count(*)::int n FROM doubts WHERE asker_id <> $1 AND status <> 'open'", [U.aarav])).rows[0].n;
  record("T16", "Student cannot see other students' non-open doubts (RLS)", others === 0, `visible=${others}`);
});
await expectFail("pb_student", U.aarav, "UPDATE doubts SET status = 'resolved' WHERE asker_id = $1", [U.aarav], ["42501"], "T17", "Student cannot set doubts.status directly (column privilege)");
await expectFail("pb_student", U.aarav, "UPDATE availability_slots SET is_booked = true WHERE helper_id = $1", [U.aarav], ["42501"], "T18", "Student cannot flip availability_slots.is_booked (column privilege)");
await expectFail("pb_student", U.aarav, "INSERT INTO sessions(doubt_id,helper_id,asker_id,slot_id) VALUES (1,2,3,1)", [], ["42501"], "T19", "Student cannot INSERT sessions directly (must use sp_book_session)");
await expectFail("pb_student", U.aarav, "INSERT INTO mastery(user_id,concept_id,score,note) VALUES ($1,$2,90,'pretending to be someone else')", [U.diya, K["Normalization"]], ["42501", "P0001"], "T20", "Student cannot record mastery for another user (rejected by RLS / enrolment trigger)");
await expectNoRows("pb_student", U.aarav, "UPDATE mastery SET score = 100 WHERE user_id = $1 RETURNING user_id", [U.diya], "T20b", "Student cannot UPDATE another student's mastery row (RLS hides it)");
await expectNoRows("pb_student", U.aarav, "DELETE FROM doubts WHERE asker_id <> $1 RETURNING doubt_id", [U.aarav], "T21", "Student cannot delete another student's doubts (RLS hides rows)");
await expectFail("pb_student", U.aarav, "INSERT INTO concept_prerequisites VALUES (1, 2)", [], ["42501"], "T22", "Student cannot edit the prerequisite graph");
await expectFail("pb_admin", adminId, "INSERT INTO doubts(asker_id,course_id,title,body) VALUES (1,1,'admin cannot ask','admin cannot ask doubts')", [], ["42501"], "T23", "Admin role has no INSERT on doubts");
await expectFail("pb_admin", adminId, "SELECT password_hash FROM users", [], ["42501"], "T24", "Admin cannot read password hashes either");
await as("pb_admin", adminId, async (c) => {
  const a = (await c.query("SELECT count(*)::int n FROM audit_log")).rows[0].n;
  const v = (await c.query("SELECT * FROM v_platform_stats")).rows[0];
  const sess = (await c.query("SELECT count(*)::int n FROM sessions")).rows[0].n;
  record("T25", "Admin can read audit_log, platform view and ALL sessions", a > 0 && v.students > 0 && sess > 0, `audit=${a} students=${v.students} sessions=${sess}`);
});
await expectFail("pb_auth", null, "SELECT * FROM doubts", [], ["42501"], "T26", "pb_auth (login role) cannot read doubts");
{
  const se = (await owner.query("SELECT session_id, asker_id, helper_id FROM sessions WHERE status='completed' LIMIT 1")).rows[0];
  const outsider = [U.aarav, U.isha, U.sneha, U.vikram, U.meera, U.kabir].find((x) => x !== se.asker_id && x !== se.helper_id);
  await expectNoRows("pb_student", outsider, "UPDATE sessions SET feedback = 'tamper' WHERE session_id = $1 RETURNING session_id", [se.session_id], "T27", "Non-participant cannot modify someone else's session (RLS hides the row)");
}

console.log("\n=== C. Business rules, procedures, concurrency ===");
await as("pb_student", U.aarav, async (c) => {
  const slot = await slotOf("meera");
  await c.query("CALL sp_book_session($1,$2,$3,NULL)", [aaravDoubt, U.meera, slot]);
  const sl = (await c.query("SELECT is_booked FROM availability_slots WHERE slot_id = $1", [slot])).rows[0];
  const d = (await c.query("SELECT status FROM doubts WHERE doubt_id = $1", [aaravDoubt])).rows[0];
  record("T28", "sp_book_session: trigger sets slot is_booked and doubt 'matched'", sl.is_booked === true && d.status === "matched", `slot=${sl.is_booked} doubt=${d.status}`);
});
await expectFail("pb_student", U.isha, "CALL sp_book_session($1,$2,$3,NULL)", [aaravDoubt, U.meera, await slotOf("meera")], ["42501"], "T29", "Booking someone else's doubt rejected ('Not your doubt')");
{
  // CONCURRENCY: two students race for ONE slot. Second blocks on the row lock, then loses with PB409.
  const slot = await slotOf("meera");
  const isha = (await one("SELECT doubt_id FROM doubts WHERE asker_id = $1 AND status='open' LIMIT 1", [U.isha])).doubt_id;
  const a = await actor("pb_student", U.aarav);
  const b = await actor("pb_student", U.isha);
  let sessionId = null, outcome = "";
  try {
    const r1 = await a.query("CALL sp_book_session($1,$2,$3,NULL)", [aaravDoubt, U.meera, slot]); // A holds the row lock
    sessionId = r1.rows[0].p_session_id;
    let settled = false;
    const p2 = b.query("CALL sp_book_session($1,$2,$3,NULL)", [isha, U.meera, slot]).then(() => "second succeeded", (e) => e.code).finally(() => { settled = true; });
    await new Promise((r) => setTimeout(r, 400));
    const blocked = !settled;                       // B must still be waiting for A's lock
    await a.query("COMMIT");                        // release the lock
    outcome = await p2;
    record("T30", "Two concurrent bookings of the SAME slot: second one waits for the lock, then gets conflict PB409", blocked && outcome === "PB409", `blocked=${blocked} second=${outcome}`);
  } catch (e) { record("T30", "Concurrent booking test", false, e.message); }
  finally {
    await done(a); await done(b);
    if (sessionId) await owner.query("UPDATE sessions SET status='cancelled' WHERE session_id = $1", [sessionId]); // trigger frees slot + reopens doubt
  }
  const chk = await one("SELECT (SELECT is_booked FROM availability_slots WHERE slot_id=$1) b, (SELECT status FROM doubts WHERE doubt_id=$2) s", [slot, aaravDoubt]);
  record("T31", "Cancelling a session frees the slot and re-opens the doubt (trigger)", chk.b === false && chk.s === "open", `is_booked=${chk.b} doubt=${chk.s}`);
}
{
  // complete a session: rating -> doubt resolved + helper reputation 10 + 2*rating
  const slot = await slotOf("diya");
  const before = (await one("SELECT reputation FROM users WHERE user_id = $1", [U.diya])).reputation;
  const c = await actor("pb_student", U.aarav);
  try {
    const r = await c.query("CALL sp_book_session($1,$2,$3,NULL)", [aaravDoubt, U.diya, slot]);
    const sid = r.rows[0].p_session_id;
    // the helper (not the asker) must NOT be able to complete it: same transaction, caller switched to Diya
    await c.query("SAVEPOINT as_helper");
    await c.query("SELECT set_config('app.user_id', $1, true)", [String(U.diya)]);
    try { await c.query("CALL sp_complete_session($1, 5::smallint, 'self rating')", [sid]); record("T32", "Helper cannot complete (rate) his own session", false); }
    catch (e) { record("T32", "Helper cannot complete (rate) his own session (trigger)", e.message.includes("Only the student who asked"), e.message.slice(0, 60)); }
    await c.query("ROLLBACK TO SAVEPOINT as_helper");
    await c.query("SELECT set_config('app.user_id', $1, true)", [String(U.aarav)]);
    await c.query("CALL sp_complete_session($1, 5::smallint, 'great')", [sid]);
    const d = (await c.query("SELECT status FROM doubts WHERE doubt_id = $1", [aaravDoubt])).rows[0];
    const rep = (await c.query("SELECT reputation FROM users WHERE user_id = $1", [U.diya])).rows[0].reputation;
    record("T33", "Completing with rating 5: doubt 'resolved', helper reputation +20 (trigger)", d.status === "resolved" && rep === before + 20, `doubt=${d.status} rep ${before}->${rep}`);
  } finally { await done(c); }
}

console.log("\n=== D. Advanced queries: recursive CTE, correlated subquery, views, full-text, vector ===");
await as("pb_student", U.aarav, async (c) => {
  const ins = await c.query(
    `INSERT INTO doubts (asker_id, course_id, concept_id, title, body, embedding)
     SELECT $1, course_id, concept_id, 'Threads waiting on each other forever', 'My program hangs because two threads each hold one lock and want the other.', (SELECT embedding FROM doubts LIMIT 1)
     FROM concepts WHERE concept_id = $2 RETURNING doubt_id`, [U.aarav, K["Deadlocks"]]);
  const p = (await c.query("SELECT concept_name, depth, already_mastered FROM fn_learning_path($1)", [ins.rows[0].doubt_id])).rows;
  const ok = p.length === 2 && p[0].concept_name === "Threads versus Processes" && p[0].depth === 2 && p[1].concept_name === "Process Synchronization" && p[1].depth === 1;
  record("T34", "fn_learning_path (RECURSIVE CTE): Deadlocks -> Process Synchronization -> Threads, deepest first", ok, p.map((x) => `${x.concept_name}@${x.depth}`).join(" , "));
});
await as("pb_admin", adminId, async (c) => {
  const r = (await c.query("SELECT title, concept_name FROM v_unserved_doubts")).rows;
  record("T35", "v_unserved_doubts (correlated NOT EXISTS) lists the doubt nobody can serve", r.some((x) => x.concept_name === "Heaps and Priority Queues"), r.map((x) => x.concept_name).join(", "));
});
await as("pb_student", U.aarav, async (c) => {
  const r = (await c.query("SELECT peer_name, match_score, next_slot, similarity FROM fn_find_peers($1, 5)", [aaravDoubt])).rows;
  const sorted = r.every((x, i) => i === 0 || r[i - 1].match_score >= x.match_score);
  const slots = r.every((x) => x.next_slot);
  record("T36", "fn_find_peers (CTE + vector search): ranked, only peers with a free slot", r.length > 0 && sorted && slots, r.map((x) => `${x.peer_name} ${Number(x.match_score).toFixed(2)}`).join(", "));
  record("T37", "Seeded ACID doubt: Meera (mastered ACID 3 days ago) is in the top 3", r.slice(0, 3).some((x) => x.peer_name === "Meera"));
});
await expectFail("pb_student", U.isha, "SELECT * FROM fn_find_peers($1, 5)", [aaravDoubt], ["P0001"], "T38", "fn_find_peers refuses a caller who is not the asker");
await as("pb_student", U.aarav, async (c) => {
  await c.query("SET LOCAL enable_seqscan = off");
  const plan = (await c.query("EXPLAIN SELECT user_id FROM mastery ORDER BY embedding <=> (SELECT embedding FROM doubts LIMIT 1) LIMIT 5")).rows.map((r) => r["QUERY PLAN"]).join("\n");
  record("T39", "Vector similarity query uses the HNSW index", plan.includes("idx_mastery_embedding"));
});
await as("pb_student", U.aarav, async (c) => {
  const r = (await c.query("SELECT doubt_id FROM doubts WHERE search_tsv @@ websearch_to_tsquery('english', 'deadlock OR threads')")).rowCount;
  record("T40", "Full-text search (tsvector + GIN) finds matching doubts", r > 0, `hits=${r}`);
});
await as("pb_admin", adminId, async (c) => {
  const r = (await c.query(`SELECT k.name, count(*) helpers FROM mastery m JOIN concepts k ON k.concept_id = m.concept_id GROUP BY k.name HAVING count(*) >= 2 ORDER BY helpers DESC`)).rows;
  record("T41", "JOIN + GROUP BY + HAVING + ORDER BY", r.length > 0, `${r.length} concepts with >= 2 helpers`);
});

console.log("\n=== E. Audit trail and DDL ===");
{
  const c = await actor("pb_admin", adminId);
  try {
    const before = (await c.query("SELECT count(*)::int n FROM audit_log WHERE action='DELETE'")).rows[0].n;
    const d = (await c.query("SELECT doubt_id FROM doubts WHERE status = 'open' LIMIT 1")).rows[0];
    await c.query("DELETE FROM doubts WHERE doubt_id = $1", [d.doubt_id]);
    const after = (await c.query("SELECT count(*)::int n FROM audit_log WHERE action='DELETE'")).rows[0].n;
    record("T42", "Admin deletes a doubt: trigger writes an audit_log DELETE entry", after === before + 1, `${before}->${after}`);
  } finally { await done(c); }
}
{
  const fs = await import("node:fs");
  const ddl = fs.readFileSync(new URL("../db/demo/ddl_demo.sql", import.meta.url), "utf8");
  try {
    await owner.query("BEGIN");
    await owner.query(ddl);
    const gone = (await owner.query("SELECT to_regclass('doubt_tags') t")).rows[0].t === null;
    await owner.query("ROLLBACK");
    record("T43", "DDL demo (CREATE / ALTER / DROP) executes without errors", gone);
  } catch (e) { await owner.query("ROLLBACK"); record("T43", "DDL demo (CREATE / ALTER / DROP) executes without errors", false, e.message); }
}

// ------------------------------------------------------------------ summary
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} database tests passed`);
await owner.end();
process.exit(failed.length ? 1 : 0);
