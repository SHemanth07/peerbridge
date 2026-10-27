// API integration tests.  Start the app first (npm run dev), seed the DB, then:   npm run test:api
// Uses the real embedding model through the running server, so the semantic checks
// (auto-tagging, semantic search, re-embedding on edit) are real end-to-end tests.
const BASE = process.env.BASE_URL || "http://localhost:3000";
const results = [];
const record = (id, name, ok, detail = "") => {
  results.push({ id, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${id}  ${name}${detail ? "   [" + detail + "]" : ""}`);
};

class Client {
  cookie = "";
  async call(path, { method, body } = {}) {
    const res = await fetch(BASE + path, {
      method: method ?? (body !== undefined ? "POST" : "GET"),
      headers: { "Content-Type": "application/json", ...(this.cookie ? { Cookie: this.cookie } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
    const set = res.headers.get("set-cookie");
    if (set && set.includes("pb_session=")) this.cookie = set.split(";")[0];
    let data = {};
    try { data = await res.json(); } catch {}
    return { status: res.status, data };
  }
  async login(email, password) {
    const r = await this.call("/api/auth/login", { body: { email, password } });
    if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.status}`);
    return r;
  }
}
const stamp = Date.now();

// ------------------------------------------------------------------ authentication
console.log("=== Authentication & authorization ===");
{
  const c = new Client();
  record("A01", "Login with wrong password -> 401", (await c.call("/api/auth/login", { body: { email: "aarav@student.edu", password: "nope" } })).status === 401);
  record("A02", "API call without a session cookie -> 401", (await c.call("/api/doubts?scope=mine")).status === 401);
  const page = await fetch(BASE + "/dashboard", { redirect: "manual" });
  record("A03", "Protected page without cookie redirects to /login", [307, 308].includes(page.status) && (page.headers.get("location") || "").includes("/login"), `status ${page.status}`);
}
const aarav = new Client(), diya = new Client(), admin = new Client(), isha = new Client();
await aarav.login("aarav@student.edu", "Student@123");
await diya.login("diya@student.edu", "Student@123");
await isha.login("isha@student.edu", "Student@123");
await admin.login("admin@peerbridge.edu", "Admin@123");
{
  const me = await aarav.call("/api/auth/me");
  record("A04", "/api/auth/me returns the logged-in student (with e-mail from the signed session)", me.status === 200 && me.data.user.email === "aarav@student.edu" && me.data.user.role === "student");
  record("A05", "Student calling /api/admin/stats -> 403", (await aarav.call("/api/admin/stats")).status === 403);
  const st = await admin.call("/api/admin/stats");
  record("A06", "Admin /api/admin/stats -> 200 with stats, leaderboard, unserved doubts", st.status === 200 && st.data.stats && Array.isArray(st.data.leaderboard) && Array.isArray(st.data.unserved));
  record("A07", "Admin cannot create a doubt (database role has no INSERT) -> 403", (await admin.call("/api/doubts", { body: { course_id: 1, title: "admin trying to ask", body: "admin should not be able to ask doubts" } })).status === 403);
  record("A08", "Student calling admin prerequisites API -> 403", (await aarav.call("/api/admin/prerequisites")).status === 403);
  const reg = await new Client().call("/api/auth/register", { body: { email: `t${stamp}@student.edu`, password: "Secret@123", full_name: "Test User", role: "admin" } });
  record("A09", "Registration ignores a client-supplied role: new user is always 'student'", reg.status === 201 && reg.data.user.role === "student");
  const bad = await new Client().call("/api/auth/register", { body: { email: "bad-email", password: "Secret@123", full_name: "X Y" } });
  record("A10", "Registration with invalid e-mail -> 400 (database CHECK)", bad.status === 400, bad.data.error);
  const dup = await new Client().call("/api/auth/register", { body: { email: "aarav@student.edu", password: "Secret@123", full_name: "Dup User" } });
  record("A11", "Registration with an existing e-mail -> 409 (UNIQUE)", dup.status === 409);
}

// ------------------------------------------------------------------ vector CRUD on doubts
console.log("\n=== Vector data: create / read / update / delete ===");
let doubtId;
{
  const courses = (await aarav.call("/api/courses")).data.courses;
  const dbms = courses.find((c) => c.code === "CS301");
  const create = await aarav.call("/api/doubts", { body: { course_id: dbms.course_id, title: "Why can two transactions overwrite each other?", body: "Two users update the same balance at the same time and one update is lost. What mechanism stops lost updates?" } });
  doubtId = create.data.doubt?.doubt_id;
  record("V01", "CREATE: POST /api/doubts embeds the text, auto-tags a concept, inserts", create.status === 201 && !!doubtId && create.data.doubt.concept_id !== null, `concept_id=${create.data.doubt?.concept_id} autoTagged=${create.data.autoTagged}`);

  const matches = await aarav.call(`/api/doubts/${doubtId}/matches`);
  record("V02", "READ: peer matches via fn_find_peers (vector similarity + recency + reputation)", matches.status === 200 && matches.data.matches.length > 0 && matches.data.matches.every((m) => m.slots.length > 0), matches.data.matches.map((m) => `${m.peer_name} ${m.match_score.toFixed(2)}`).join(", "));
  record("V03", "Another student cannot read matches of my doubt -> 403/404", [403, 404].includes((await diya.call(`/api/doubts/${doubtId}/matches`)).status));

  const sem = await diya.call(`/api/doubts?scope=open&mode=semantic&q=${encodeURIComponent("concurrent updates overwriting each other lost update")}`);
  record("V04", "READ: semantic search (pgvector) finds the doubt by meaning", sem.status === 200 && sem.data.doubts.some((d) => d.doubt_id === doubtId), `${sem.data.doubts?.length} hits`);
  const kw = await diya.call(`/api/doubts?scope=open&mode=keyword&q=${encodeURIComponent("lost update")}`);
  record("V05", "READ: keyword search (full-text, ts_rank) finds the doubt", kw.status === 200 && kw.data.doubts.some((d) => d.doubt_id === doubtId));

  const sim = await aarav.call(`/api/doubts/${doubtId}/similar`);
  record("V06", "READ: similar open doubts by embedding distance", sim.status === 200 && Array.isArray(sim.data.similar));

  const before = (await aarav.call(`/api/doubts/${doubtId}/matches`)).data.matches.map((m) => m.peer_name).join(",");
  const upd = await aarav.call(`/api/doubts/${doubtId}`, { method: "PATCH", body: { title: "How do I find the shortest path between two nodes?", body: "I have a graph of friends and want the fewest hops between two people using breadth first search or depth first search." } });
  const after = (await aarav.call(`/api/doubts/${doubtId}/matches`)).data.matches.map((m) => m.peer_name).join(",");
  record("V07", "UPDATE: PATCH re-embeds the doubt, so the peer ranking changes", upd.status === 200 && before !== after, `before: ${before} | after: ${after}`);
  record("V08", "UPDATE: another student cannot edit my doubt -> 404", (await diya.call(`/api/doubts/${doubtId}`, { method: "PATCH", body: { title: "hijacked doubt title", body: "hijacked doubt description that is long enough" } })).status === 404);
  record("V09", "UPDATE: too-short text rejected -> 400", (await aarav.call(`/api/doubts/${doubtId}`, { method: "PATCH", body: { title: "short", body: "short" } })).status === 400);

  record("V10", "DELETE: another student cannot delete my doubt -> 404", (await diya.call(`/api/doubts/${doubtId}`, { method: "DELETE" })).status === 404);
  record("V11", "DELETE: owner deletes the doubt (row + embedding removed)", (await aarav.call(`/api/doubts/${doubtId}`, { method: "DELETE" })).status === 200);
  record("V12", "Deleted doubt is gone -> 404", (await aarav.call(`/api/doubts/${doubtId}`)).status === 404);
}

// ------------------------------------------------------------------ mastery (vector upsert)
console.log("\n=== Mastery embeddings ===");
{
  const courses = (await diya.call("/api/courses")).data.courses;
  const k = courses.find((c) => c.code === "CS201").concepts.find((x) => x.name === "Sorting Algorithms");
  const up = await diya.call("/api/mastery", { body: { concept_id: k.concept_id, score: 88, note: "Merge sort splits the array and merges sorted halves in n log n time." } });
  record("M01", "CREATE/UPDATE: POST /api/mastery embeds the note and upserts", up.status === 201);
  const again = await diya.call("/api/mastery", { body: { concept_id: k.concept_id, score: 92, note: "Heap sort builds a heap then repeatedly extracts the maximum element." } });
  const list = (await diya.call("/api/mastery")).data.mastery.find((m) => m.concept_id === k.concept_id);
  record("M02", "UPDATE: second POST refreshes score + note (embedding recomputed)", again.status === 201 && list.score === 92 && list.note.startsWith("Heap sort"));
  record("M03", "Score 40 rejected -> 400 (database CHECK)", (await diya.call("/api/mastery", { body: { concept_id: k.concept_id, score: 40, note: "far too low a score here" } })).status === 400);
  const otherCourse = courses.find((c) => c.code === "CS302").concepts[0];
  record("M04", "Mastery in a course the student is not enrolled in -> 400 (trigger)", (await diya.call("/api/mastery", { body: { concept_id: otherCourse.concept_id, score: 80, note: "not enrolled in this course" } })).status === 400);
  record("M05", "DELETE: remove mastery (row + embedding)", (await diya.call(`/api/mastery?concept_id=${k.concept_id}`, { method: "DELETE" })).status === 200);
}

// ------------------------------------------------------------------ booking, sessions
console.log("\n=== Booking, sessions, transactions ===");
{
  const mine = (await aarav.call("/api/doubts?scope=mine")).data.doubts.filter((d) => d.status === "open");
  const dId = mine[0].doubt_id;
  const m = (await aarav.call(`/api/doubts/${dId}/matches`)).data.matches;
  const peer = m[0], slot = peer.slots[0];
  const b1 = await aarav.call("/api/sessions", { body: { doubt_id: dId, helper_id: peer.peer_id, slot_id: slot.slot_id } });
  record("B01", "Book a slot (transaction + sp_book_session) -> 201", b1.status === 201, `session ${b1.data.session?.session_id}`);
  const d = (await aarav.call(`/api/doubts/${dId}`)).data.doubt;
  record("B02", "After booking the doubt is 'matched' (trigger)", d.status === "matched");
  const dup = await aarav.call("/api/sessions", { body: { doubt_id: dId, helper_id: peer.peer_id, slot_id: slot.slot_id } });
  record("B03", "Booking the same slot / doubt again -> 409", dup.status === 409, dup.data.error);
  // another student (not the helper, not the asker) tries to grab the same slot / cancel the session
  const outsider = [["Diya", diya], ["Isha", isha]].find(([n]) => n !== peer.peer_name)[1];
  const oDoubt = (await outsider.call("/api/doubts?scope=mine")).data.doubts.find((x) => x.status === "open");
  const steal = await outsider.call("/api/sessions", { body: { doubt_id: oDoubt.doubt_id, helper_id: peer.peer_id, slot_id: slot.slot_id } });
  record("B04", "A different student booking the SAME slot -> 409", steal.status === 409, steal.data.error);
  const sid = b1.data.session.session_id;
  const helper = new Client();
  await helper.login(`${peer.peer_name.toLowerCase()}@student.edu`, "Student@123");
  record("B05", "Helper (not the asker) cannot complete the session -> 403", (await helper.call(`/api/sessions/${sid}/complete`, { body: { rating: 5 } })).status === 403);
  record("B06", "Outsider cannot cancel someone else's session -> 404", (await outsider.call(`/api/sessions/${sid}/cancel`, { body: {} })).status === 404);
  record("B07", "Rating 9 -> 400", (await aarav.call(`/api/sessions/${sid}/complete`, { body: { rating: 9 } })).status === 400);
  const repBefore = (await helper.call("/api/auth/me")).data.user.reputation;
  record("B08", "Asker completes with rating 5 -> 200 (stored procedure)", (await aarav.call(`/api/sessions/${sid}/complete`, { body: { rating: 5 } })).status === 200);
  const repAfter = (await helper.call("/api/auth/me")).data.user.reputation;
  record("B09", "Helper earned 10 + 2 x 5 = 20 reputation (trigger)", repAfter === repBefore + 20, `${repBefore} -> ${repAfter}`);
  const meId = (await aarav.call("/api/auth/me")).data.user.user_id;
  const list = (await aarav.call("/api/sessions")).data.sessions;
  record("B10", "Student's session list contains only sessions he takes part in (RLS)", list.length > 0 && list.every((x) => x.asker_id === meId || x.helper_id === meId), `${list.length} sessions`);
  const all = (await admin.call("/api/sessions")).data.sessions;
  record("B11", "Admin's session list contains everyone's sessions", all.length > list.length);
}

// ------------------------------------------------------------------ learning path + admin graph
console.log("\n=== Recursive learning path & admin prerequisite graph ===");
{
  const courses = (await aarav.call("/api/courses")).data.courses;
  const os = courses.find((c) => c.code === "CS302");
  const dl = os.concepts.find((x) => x.name === "Deadlocks");
  const mk = await aarav.call("/api/doubts", { body: { course_id: os.course_id, concept_id: dl.concept_id, title: "Two threads hang waiting for each other", body: "Thread one holds lock A and wants lock B while thread two holds B and wants A so everything freezes." } });
  const path = await aarav.call(`/api/doubts/${mk.data.doubt.doubt_id}/path`);
  record("R01", "Learning path walks prerequisites recursively (Deadlocks -> Sync -> Threads)", path.status === 200 && path.data.path.length === 2 && path.data.path[0].concept_name === "Threads versus Processes", path.data.path.map((p) => `${p.concept_name}@${p.depth}`).join(", "));
  await aarav.call(`/api/doubts/${mk.data.doubt.doubt_id}`, { method: "DELETE" });
  const th = os.concepts.find((x) => x.name === "Threads versus Processes");
  const cyc = await admin.call("/api/admin/prerequisites", { body: { concept_id: th.concept_id, prerequisite_id: dl.concept_id } });
  record("R02", "Admin adding a cyclic prerequisite -> 400 (recursive-CTE trigger)", cyc.status === 400, cyc.data.error);
  const dbmsC = courses.find((c) => c.code === "CS301").concepts[0];
  const cross = await admin.call("/api/admin/prerequisites", { body: { concept_id: dl.concept_id, prerequisite_id: dbmsC.concept_id } });
  record("R03", "Admin adding a cross-course prerequisite -> 400", cross.status === 400, cross.data.error);
  const nm = os.concepts.find((x) => x.name === "Paging and Virtual Memory");
  const ok = await admin.call("/api/admin/prerequisites", { body: { concept_id: nm.concept_id, prerequisite_id: th.concept_id } });
  record("R04", "Admin adds a valid prerequisite -> 201", ok.status === 201);
  await admin.call(`/api/admin/prerequisites?concept_id=${nm.concept_id}&prerequisite_id=${th.concept_id}`, { method: "DELETE" });
}

// ------------------------------------------------------------------ moderation + audit
console.log("\n=== Admin moderation & audit ===");
{
  const open = (await admin.call("/api/doubts?scope=all")).data.doubts.find((d) => d.status === "open");
  const before = (await admin.call("/api/admin/stats")).data.audit.length;
  const del = await admin.call(`/api/doubts/${open.doubt_id}`, { method: "DELETE" });
  const audit = (await admin.call("/api/admin/stats")).data.audit;
  record("D01", "Admin deletes a doubt; the audit trigger logs it", del.status === 200 && audit[0].action === "DELETE" && audit[0].table_name === "doubts", `latest audit: ${audit[0].action} ${audit[0].table_name}`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} API tests passed`);
process.exit(failed.length ? 1 : 0);
