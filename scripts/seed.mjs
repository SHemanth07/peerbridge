// Seeds demo data. Wipes existing rows first.   Run:  npm run seed
// Embeddings are computed locally with all-MiniLM-L6-v2 (first run downloads ~90 MB model).
import pg from "pg";
import bcrypt from "bcryptjs";
import { pipeline } from "@huggingface/transformers";

// The seed truncates tables and inserts as the schema OWNER (not the restricted pb_app role).
const url = process.env.OWNER_DATABASE_URL;
if (!url) {
  console.error("OWNER_DATABASE_URL missing - copy .env.example to .env first");
  process.exit(1);
}
const db = new pg.Client({ connectionString: url });
await db.connect();

console.log("Loading embedding model ...");
const extractor = await pipeline("feature-extraction", process.env.EMBEDDING_MODEL || "Xenova/all-MiniLM-L6-v2");
const vec = async (text) => {
  const out = await extractor(text, { pooling: "mean", normalize: true });
  return `[${Array.from(out.data).join(",")}]`;
};

await db.query(
  `TRUNCATE audit_log, sessions, availability_slots, doubts, mastery, enrolments, concept_prerequisites, concepts, courses, users
   RESTART IDENTITY CASCADE`
);

// ---------- users ----------
const ADMIN_PW = "Admin@123", STUDENT_PW = "Student@123";
const adminHash = await bcrypt.hash(ADMIN_PW, 10);
const studentHash = await bcrypt.hash(STUDENT_PW, 10);
await db.query(
  `INSERT INTO users (email, password_hash, full_name, role) VALUES ('admin@peerbridge.edu', $1, 'Platform Admin', 'admin')`,
  [adminHash]
);
const students = ["Aarav", "Diya", "Rohan", "Meera", "Kabir", "Ananya", "Vikram", "Isha", "Arjun", "Sneha"];
const uid = {};
for (const [i, n] of students.entries()) {
  const r = await db.query(
    `INSERT INTO users (email, password_hash, full_name, role, semester)
     VALUES ($1, $2, $3, 'student', $4) RETURNING user_id`,
    [`${n.toLowerCase()}@student.edu`, studentHash, n, 3 + (i % 3)]
  );
  uid[n] = r.rows[0].user_id;
}

// ---------- courses & concepts ----------
const catalogue = {
  "CS301": ["Database Management Systems", [
    ["Normalization", "Decomposing relations into 1NF, 2NF, 3NF and BCNF using functional dependencies to remove redundancy and update anomalies."],
    ["Transactions and ACID", "Atomicity, consistency, isolation and durability of transactions, commit and rollback, write-ahead logging and crash recovery."],
    ["Concurrency Control", "Two-phase locking, lost updates, serializable schedules, isolation levels and lock conflicts between concurrent transactions."],
    ["Indexing and B+ Trees", "Speeding up queries with B+ tree indexes, clustered versus non-clustered indexes, and when a full table scan is chosen."],
    ["SQL Joins", "Inner, left, right and full outer joins, join conditions and how unmatched rows are handled."],
    ["Query Optimization", "Query plans, cost estimation, join ordering and rewriting slow queries."],
  ]],
  "CS302": ["Operating Systems", [
    ["Deadlocks", "Circular wait between processes, Coffman conditions, resource allocation graphs, detection, prevention and the banker's algorithm."],
    ["CPU Scheduling", "FCFS, shortest job first, round robin and priority scheduling, turnaround and waiting time, starvation."],
    ["Paging and Virtual Memory", "Page tables, page faults, TLB, demand paging and page replacement algorithms such as LRU."],
    ["Process Synchronization", "Race conditions, critical sections, mutexes, semaphores and monitors for coordinating threads sharing data."],
    ["Threads versus Processes", "Differences in memory sharing, context switch cost and concurrency between threads and processes."],
  ]],
  "CS201": ["Data Structures and Algorithms", [
    ["Dynamic Programming", "Solving problems with overlapping subproblems and optimal substructure using memoization and tabulation."],
    ["Graph Traversal", "Breadth-first and depth-first search, shortest path in unweighted graphs, connected components."],
    ["Hashing", "Hash functions, collisions, chaining and open addressing, load factor and expected constant time lookup."],
    ["Binary Search Trees", "Insertion, deletion and search in BSTs, tree traversals, balancing with AVL and red-black trees."],
    ["Sorting Algorithms", "Quick sort, merge sort, heap sort, complexity analysis and best and worst cases."],
    ["Heaps and Priority Queues", "Binary heaps stored in arrays, heapify, insert and extract-min, and building priority queues in logarithmic time."],
  ]],
};
const cid = {}, kid = {};
for (const [code, [title, concepts]] of Object.entries(catalogue)) {
  const c = await db.query("INSERT INTO courses (code, title) VALUES ($1, $2) RETURNING course_id", [code, title]);
  cid[code] = c.rows[0].course_id;
  for (const [name, desc] of concepts) {
    const k = await db.query(
      "INSERT INTO concepts (course_id, name, description, embedding) VALUES ($1, $2, $3, $4::vector) RETURNING concept_id",
      [cid[code], name, desc, await vec(`${name}. ${desc}`)]
    );
    kid[name] = { id: k.rows[0].concept_id, desc };
  }
}

// ---------- concept prerequisites (a DAG; walked by a recursive CTE) ----------
const prereqs = [
  ["Concurrency Control", "Transactions and ACID"],
  ["Query Optimization", "Indexing and B+ Trees"],
  ["Query Optimization", "SQL Joins"],
  ["Deadlocks", "Process Synchronization"],
  ["Process Synchronization", "Threads versus Processes"],
  ["CPU Scheduling", "Threads versus Processes"],
  ["Dynamic Programming", "Hashing"],
];
for (const [c, p] of prereqs)
  await db.query("INSERT INTO concept_prerequisites (concept_id, prerequisite_id) VALUES ($1, $2)", [kid[c].id, kid[p].id]);

// ---------- enrolments ----------
const enrol = {
  Aarav: ["CS301", "CS302"], Diya: ["CS301", "CS201"], Rohan: ["CS302", "CS201"],
  Meera: ["CS301", "CS302", "CS201"], Kabir: ["CS301"], Ananya: ["CS302"],
  Vikram: ["CS201", "CS301"], Isha: ["CS301", "CS302"], Arjun: ["CS201"], Sneha: ["CS302", "CS201"],
};
for (const [n, codes] of Object.entries(enrol))
  for (const code of codes)
    await db.query("INSERT INTO enrolments (user_id, course_id) VALUES ($1, $2)", [uid[n], cid[code]]);

// ---------- mastery  [student, concept, score, note, days ago] ----------
const mastery = [
  ["Meera", "Transactions and ACID", 92, "Understood how atomicity works through the write-ahead log and rollback, and how durability comes from flushing the log to disk before commit.", 3],
  ["Meera", "Normalization", 88, "Breaking tables into BCNF so that repeated customer data and update anomalies disappear.", 20],
  ["Meera", "Deadlocks", 85, "Spotting circular wait with a wait-for graph and breaking it by ordering lock acquisition.", 5],
  ["Diya", "Indexing and B+ Trees", 90, "Why a B+ tree index turns a full scan of millions of rows into a few page reads, and when the optimizer ignores the index.", 6],
  ["Diya", "SQL Joins", 95, "Difference between inner and left joins and why NULL rows appear for unmatched keys.", 40],
  ["Diya", "Dynamic Programming", 80, "Writing recurrences for overlapping subproblems and memoizing them.", 10],
  ["Kabir", "Concurrency Control", 86, "Lost update problem, two-phase locking and why concurrent transactions must be serializable.", 2],
  ["Kabir", "Transactions and ACID", 78, "Commit and rollback behaviour and the four ACID guarantees.", 60],
  ["Isha", "Query Optimization", 82, "Reading EXPLAIN plans and rewriting a slow query so the planner picks an index scan.", 9],
  ["Isha", "Normalization", 91, "Functional dependencies and decomposition to 3NF and BCNF without losing information.", 1],
  ["Rohan", "Deadlocks", 89, "Four Coffman conditions, resource allocation graphs and the banker's algorithm for avoidance.", 2],
  ["Rohan", "CPU Scheduling", 84, "Round robin versus priority scheduling, time quantum, starvation and aging.", 12],
  ["Rohan", "Graph Traversal", 87, "BFS finds the shortest number of hops in an unweighted graph; DFS explores depth first.", 7],
  ["Ananya", "Paging and Virtual Memory", 90, "Page tables, page faults and how the OS uses disk as extra RAM with demand paging and LRU replacement.", 4],
  ["Ananya", "Process Synchronization", 83, "Race conditions on shared counters and fixing them with mutexes and semaphores.", 15],
  ["Vikram", "Dynamic Programming", 93, "Turning exponential recursion into polynomial time by caching overlapping subproblem results.", 1],
  ["Vikram", "Hashing", 88, "Collision handling with chaining and open addressing and load factor.", 25],
  ["Vikram", "Indexing and B+ Trees", 79, "Clustered versus non-clustered index and range queries on B+ trees.", 30],
  ["Arjun", "Binary Search Trees", 91, "Insertion and deletion in BSTs and how AVL rotations keep the tree balanced.", 8],
  ["Arjun", "Sorting Algorithms", 85, "Quick sort partitioning and its worst case on already sorted input.", 18],
  ["Arjun", "Graph Traversal", 80, "DFS using a stack and BFS using a queue, detecting connected components.", 45],
  ["Sneha", "Process Synchronization", 88, "Using semaphores and monitors to protect critical sections between threads.", 3],
  ["Sneha", "Threads versus Processes", 82, "Threads share memory so context switches are cheaper than between processes.", 22],
  ["Sneha", "Hashing", 77, "Hash tables, hash functions and collision resolution.", 70],
  ["Aarav", "SQL Joins", 84, "Writing joins across three tables and choosing between inner and outer joins.", 14],
];
for (const [n, concept, score, note, days] of mastery) {
  const k = kid[concept];
  await db.query(
    `INSERT INTO mastery (user_id, concept_id, score, note, embedding, mastered_at)
     VALUES ($1, $2, $3, $4, $5::vector, now() - ($6 || ' days')::interval)`,
    [uid[n], k.id, score, note, await vec(`${concept}. ${k.desc}. ${note}`), String(days)]
  );
}

// ---------- availability slots: every student offers 3 one-hour slots ----------
const hourFor = { Aarav: 9, Diya: 10, Rohan: 11, Meera: 12, Kabir: 14, Ananya: 15, Vikram: 16, Isha: 17, Arjun: 18, Sneha: 19 };
const slotAt = (daysAhead, hour) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysAhead);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
};
for (const n of students)
  for (const day of [1, 2, 3]) {
    const s = slotAt(day, hourFor[n]);
    await db.query(
      "INSERT INTO availability_slots (helper_id, start_time, end_time) VALUES ($1, $2, $3)",
      [uid[n], s, new Date(s.getTime() + 3600_000)]
    );
  }

// ---------- doubts (worded differently from the mastery notes on purpose) ----------
const doubts = [
  ["Aarav", "CS301", "My bank transfer stopped half way when the server crashed - why is no money lost?",
   "I debit account A and the server crashes before account B is credited. After restart both balances are correct. How does the database guarantee all-or-nothing behaviour and survive a power failure?"],
  ["Aarav", "CS302", "Two threads waiting on each other forever - how do I detect and avoid this?",
   "Thread 1 holds lock A and wants lock B while thread 2 holds B and wants A, so my program hangs. How is this situation found and what are the ways to stop it happening?"],
  ["Diya", "CS201", "How do I solve a problem where the same smaller calculations repeat again and again?",
   "My recursive Fibonacci style solution is exponentially slow because it recomputes the same subproblems. What technique makes it fast and how do I define the recurrence?"],
  ["Kabir", "CS301", "My table repeats the customer address in every row - how should I restructure it?",
   "Changing a customer's address means updating dozens of rows and sometimes I miss one. What is the proper way to split this table to avoid these anomalies?"],
  ["Rohan", "CS302", "How can my laptop run programs bigger than its RAM and what is a page fault?",
   "I read that the OS uses the hard disk as extra memory when RAM is full. I do not understand how addresses are translated or what happens on a page fault."],
  ["Arjun", "CS201", "Shortest number of hops between two nodes of an unweighted network?",
   "I have a social network graph and need the minimum number of friend-of-friend steps between two people. Which traversal should I use and why does it give the shortest path?"],
  ["Isha", "CS301", "A query on millions of rows is slow even though I filter on one column",
   "SELECT with WHERE on a single column takes several seconds on a table with ten million rows. What can I add to the database to make lookups fast, and why does it help?"],
  ["Meera", "CS201", "How does a priority queue always give me the smallest element quickly?",
   "I need to repeatedly remove the minimum item from a growing collection. Someone said to use a heap stored in an array, but I do not see how insertion and removal stay logarithmic."],
  ["Sneha", "CS302", "Which process gets the CPU first when many are ready to run?",
   "I am confused how the operating system picks between processes - round robin versus priority. What happens to low priority processes and how is waiting time computed?"],
];
const doubtId = {};
for (const [n, code, title, body] of doubts) {
  const d = await db.query(
    `INSERT INTO doubts (asker_id, course_id, title, body, embedding)
     VALUES ($1, $2, $3, $4, $5::vector) RETURNING doubt_id`,
    [uid[n], cid[code], title, body, await vec(`${title}. ${body}`)]
  );
  doubtId[title] = d.rows[0].doubt_id;
  // tag with the nearest concept of that course, as the API does
  await db.query(
    `UPDATE doubts SET concept_id = (
        SELECT concept_id FROM concepts WHERE course_id = $2 ORDER BY embedding <=> $1::vector LIMIT 1)
     WHERE doubt_id = $3`,
    [await vec(`${title}. ${body}`), cid[code], d.rows[0].doubt_id]
  );
}

// ---------- history: two completed sessions (exercises booking + completion triggers) ----------
async function history(asker, code, title, body, helper, hour, rating, feedback) {
  const d = await db.query(
    `INSERT INTO doubts (asker_id, course_id, title, body, embedding) VALUES ($1,$2,$3,$4,$5::vector) RETURNING doubt_id`,
    [uid[asker], cid[code], title, body, await vec(`${title}. ${body}`)]
  );
  const s0 = slotAt(4, hour);
  const sl = await db.query(
    "INSERT INTO availability_slots (helper_id, start_time, end_time) VALUES ($1,$2,$3) RETURNING slot_id",
    [uid[helper], s0, new Date(s0.getTime() + 3600_000)]
  );
  const se = await db.query(
    "INSERT INTO sessions (doubt_id, helper_id, asker_id, slot_id) VALUES ($1,$2,$3,$4) RETURNING session_id",
    [d.rows[0].doubt_id, uid[helper], uid[asker], sl.rows[0].slot_id]
  );
  await db.query("CALL sp_complete_session($1, $2::smallint, $3)", [se.rows[0].session_id, rating, feedback]);
}
await history("Kabir", "CS301", "Confused about LEFT JOIN versus INNER JOIN results",
  "Some rows vanish when I use INNER JOIN but appear with NULLs in LEFT JOIN. I want to understand exactly when each happens.",
  "Diya", 8, 5, "Clear walkthrough with examples");
await history("Arjun", "CS201", "Why is quicksort slow on an already sorted array?",
  "My quicksort takes quadratic time when the input is already sorted. How does pivot choice cause this?",
  "Rohan", 9, 4, "Helpful, a bit rushed");

console.log("\nSeed complete.");
console.log("  admin   : admin@peerbridge.edu  /", ADMIN_PW);
console.log("  student : aarav@student.edu (and diya, rohan, meera, kabir, ananya, vikram, isha, arjun, sneha) /", STUDENT_PW);
await db.end();
