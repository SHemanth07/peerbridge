# Viva preparation

The rubric awards 4 marks for originality, individual contribution and **modification / viva**. Be able to explain *and live-edit* each item. Both of you should know all of it; each should know their own slice deeply (`CONTRIBUTIONS.md`).

## 60-second pitch
Students' doubts go unresolved because help is limited to their own batch. PeerBridge embeds a doubt into a 384-dimension vector and finds peers who **recently mastered** the same concept, by meaning, then lets the asker book a slot safely. PostgreSQL holds the transactional data; **pgvector in the same database** holds the embeddings, so one SQL query joins similarity with free slots and reputation.

## Likely questions

**Why PostgreSQL + pgvector and not MongoDB / Pinecone?** The data is relational and needs ACID (two students must never book one slot). Vectors in the same database let one query combine similarity with relational filters and stay consistent in one transaction. A separate vector store means two systems and joins in application code.

**What is embedded, with which model, how stored, which metric, how retrieved?** Doubts (`title. body`), concepts, mastery notes. `all-MiniLM-L6-v2`, 384 dims, normalised. Stored as `vector(384)`. Cosine distance `<=>`. HNSW index; `fn_find_peers` takes the nearest 50, keeps each peer's best concept, re-ranks 0.70 similarity + 0.20 recency + 0.10 reputation, drops peers without a free slot.

**Why HNSW, not IVFFlat?** HNSW needs no training step and gives better recall at small/medium sizes; IVFFlat needs data first to build lists.

**Why cosine, not Euclidean?** Vectors are normalised, so cosine and dot product agree and direction (meaning) matters, not length.

**How do you prevent double booking?** `sp_book_session` locks the slot row with `SELECT ... FOR UPDATE`, checks it, locks the doubt, inserts the session; triggers flip `is_booked` and the doubt status. A partial unique index on active sessions is a second safety net. Test T30 shows the second transaction waiting, then failing with PB409.

**Where is the recursive query?** `fn_learning_path` (and Q11 in `demo_queries.sql`): anchor = direct prerequisites of the doubt's concept; recursive step = prerequisites of prerequisites; `max(level)` per concept gives learning order. `fn_validate_prereq` uses the same idea to refuse cycles.

**Where is a correlated subquery?** View `v_unserved_doubts`: `NOT EXISTS (...)` refers to the outer doubt `d` (concept and asker). Also Q13.

**How is RBAC done in the database?** Roles `pb_auth`, `pb_student`, `pb_admin`; the app logs in as `pb_app` which has no privileges and does `SET LOCAL ROLE` per request. GRANTs limit tables and columns (e.g. no `password_hash`), RLS policies limit rows (own sessions, own doubts). Show T11-T27, or run Q15 in psql.

**Why SECURITY DEFINER on some functions?** A student booking must flip the *helper's* slot, and a completed session must credit the helper; students have no UPDATE right on those rows. The trigger / procedure does it as the owner with a fixed `search_path`; the asker is read from `app.user_id`, not from a parameter.

**Weakness of `app.user_id`?** It is a session setting set by the trusted server; someone with direct SQL access as `pb_student` could set it. The database is never exposed to browsers. Next step: one login role per user.

**Is the schema normalised?** 3NF/BCNF. The only deliberate denormalisation is `users.reputation`, maintained by a trigger for fast ranking.

**Vector RUD?** Create: post doubt / mastery. Read: matches, semantic search, similar doubts. Update: `PATCH /api/doubts/:id` re-embeds and re-tags; mastery upsert. Delete: delete doubt / mastery removes the vector from the index. Test V07 shows the peer ranking changes after an edit.

**How do you validate input?** At the database: CHECK, UNIQUE, EXCLUDE, FK, triggers. The API maps SQLSTATE codes to HTTP statuses.

## Likely live modifications (practise these)
1. **Change a weight**: edit `0.70/0.20/0.10` in `fn_find_peers` (`db/02_functions_triggers.sql`), re-run that file's `CREATE OR REPLACE`.
2. **Add a column**: `ALTER TABLE doubts ADD COLUMN priority SMALLINT DEFAULT 1 CHECK (priority BETWEEN 1 AND 3);` then show it in a query.
3. **New view**: e.g. top helpers per course with `RANK() OVER (PARTITION BY ...)` (Q4 is a starting point).
4. **New trigger**: e.g. block a student from having more than 3 open doubts.
5. **Change the mastery threshold** from 70 to 80: `ALTER TABLE mastery DROP CONSTRAINT chk_mastery_threshold, ADD CONSTRAINT ...`.
6. **Add a third role** (e.g. `pb_mentor`): `CREATE ROLE`, `GRANT SET` to `pb_app`, GRANT / policies, one entry in `DB_ROLE` in `lib/db.ts`.
7. **Change the similarity threshold** `MIN_SIM` in `lib/semantic.ts`.

## Be honest about
- Embeddings are computed in the Node server, not inside PostgreSQL.
- Demo data is small; HNSW pays off with more rows.
- The match percentage is a ranking score, not a probability.
