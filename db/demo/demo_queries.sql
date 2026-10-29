-- =====================================================================
-- Important queries for the demonstration / report
-- =====================================================================

-- Q1  JOIN + ORDER BY : open doubts with course and asker
SELECT d.doubt_id, d.title, c.code, u.full_name AS asker, d.created_at
FROM doubts d
JOIN courses c ON c.course_id = d.course_id
JOIN users   u ON u.user_id   = d.asker_id
WHERE d.status = 'open'
ORDER BY d.created_at DESC;

-- Q2  GROUP BY + HAVING + aggregates : concepts with at least 2 mastering peers
SELECT k.name, count(*) AS helpers, round(avg(m.score), 1) AS avg_score
FROM mastery m
JOIN concepts k ON k.concept_id = m.concept_id
GROUP BY k.name
HAVING count(*) >= 2
ORDER BY helpers DESC;

-- Q3  Subquery : students who have mastered more concepts than the average student
SELECT u.full_name, count(*) AS mastered
FROM mastery m JOIN users u ON u.user_id = m.user_id
GROUP BY u.user_id, u.full_name
HAVING count(*) > (SELECT avg(cnt) FROM (SELECT count(*) AS cnt FROM mastery GROUP BY user_id) t);

-- Q4  Window function : rank helpers inside each course by reputation
SELECT course_code, full_name, reputation,
       RANK() OVER (PARTITION BY course_code ORDER BY reputation DESC) AS rank_in_course
FROM (SELECT DISTINCT c.code AS course_code, u.full_name, u.reputation
      FROM mastery m
      JOIN concepts k ON k.concept_id = m.concept_id
      JOIN courses  c ON c.course_id  = k.course_id
      JOIN users    u ON u.user_id    = m.user_id) x;

-- Q5  Full-text search over doubts
SELECT doubt_id, title,
       ts_rank(search_tsv, websearch_to_tsquery('english', 'page fault')) AS rank
FROM doubts
WHERE search_tsv @@ websearch_to_tsquery('english', 'page fault')
ORDER BY rank DESC;

-- Q6  Vector similarity: top-3 mastery notes closest to a given doubt (cosine distance <=>)
SELECT m.user_id, k.name, 1 - (m.embedding <=> d.embedding) AS cosine_similarity
FROM doubts d, mastery m
JOIN concepts k ON k.concept_id = m.concept_id
WHERE d.doubt_id = 1
ORDER BY m.embedding <=> d.embedding
LIMIT 3;

-- Q7  The stored function that powers peer matching
SELECT peer_name, matched_concept, round(similarity::numeric, 3) AS sim,
       round(recency::numeric, 3) AS rec, round(match_score::numeric, 3) AS score, next_slot
FROM fn_find_peers(1, 5);

-- Q8  Views
SELECT * FROM v_platform_stats;
SELECT * FROM v_helper_leaderboard ORDER BY reputation DESC LIMIT 5;
SELECT * FROM v_concept_demand_supply WHERE open_doubts > helpers ORDER BY open_doubts DESC;

-- Q9  TRANSACTION demo: booking is all-or-nothing (the API does exactly this through sp_book_session)
--     run as the schema owner; app.user_id is the asker (user 2 = Aarav, owner of doubt 1)
BEGIN;
  SELECT set_config('app.user_id', '2', true);
  SELECT min(slot_id) AS free_slot FROM availability_slots WHERE helper_id = 4 AND NOT is_booked \gset
  CALL sp_book_session(1, 4, :free_slot, NULL);
  SELECT slot_id, is_booked FROM availability_slots WHERE helper_id = 4 ORDER BY slot_id LIMIT 3;   -- trigger marked one booked
ROLLBACK;                                                                                           -- nothing persisted

-- Q10 Trigger / constraint proofs (each statement should FAIL)
-- INSERT INTO mastery(user_id, concept_id, score, note) VALUES (1, 1, 40, 'too low score ....');  -- CHECK 70..100
-- INSERT INTO sessions(doubt_id, helper_id, asker_id, slot_id) VALUES (1, 3, 3, 1);                -- not self-help
-- INSERT INTO availability_slots(helper_id,start_time,end_time)
--   SELECT helper_id, start_time + interval '10 min', end_time FROM availability_slots LIMIT 1;    -- overlap EXCLUDE

-- Q11 RECURSIVE CTE : every prerequisite (any depth) of a concept, foundations first
WITH RECURSIVE path(cid, lvl) AS (
    SELECT prerequisite_id, 1 FROM concept_prerequisites
    WHERE concept_id = (SELECT concept_id FROM concepts WHERE name = 'Deadlocks')
  UNION ALL
    SELECT cp.prerequisite_id, path.lvl + 1
    FROM concept_prerequisites cp JOIN path ON cp.concept_id = path.cid
)
SELECT k.name, max(p.lvl) AS depth
FROM path p JOIN concepts k ON k.concept_id = p.cid
GROUP BY k.name ORDER BY depth DESC;
-- the same logic packaged as a stored function:  SELECT * FROM fn_learning_path(2);

-- Q12 CORRELATED SUBQUERY : doubts with no other helper who has a free slot (see view v_unserved_doubts)
SELECT d.doubt_id, d.title
FROM doubts d
WHERE d.status = 'open' AND d.concept_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM mastery m
                  JOIN availability_slots s ON s.helper_id = m.user_id
                  WHERE m.concept_id = d.concept_id AND m.user_id <> d.asker_id
                    AND NOT s.is_booked AND s.start_time > now());

-- Q13 CORRELATED scalar subquery : for each helper, their rating vs. the average of all helpers
SELECT u.full_name,
       (SELECT round(avg(se.rating), 2) FROM sessions se
        WHERE se.helper_id = u.user_id AND se.status = 'completed')          AS my_avg_rating,
       (SELECT round(avg(rating), 2) FROM sessions WHERE status = 'completed') AS overall_avg
FROM users u WHERE u.role = 'student' ORDER BY my_avg_rating DESC NULLS LAST;

-- Q14 NON-recursive CTE : concepts where demand (open doubts) exceeds supply (helpers)
WITH demand AS (SELECT concept_id, count(*) AS n FROM doubts WHERE status = 'open' GROUP BY concept_id),
     supply AS (SELECT concept_id, count(*) AS n FROM mastery GROUP BY concept_id)
SELECT k.name, COALESCE(d.n, 0) AS open_doubts, COALESCE(s.n, 0) AS helpers
FROM concepts k LEFT JOIN demand d USING (concept_id) LEFT JOIN supply s USING (concept_id)
WHERE COALESCE(d.n, 0) > COALESCE(s.n, 0);

-- Q15 ROLE-BASED ACCESS CONTROL demo (run as the login role pb_app, e.g.  psql "$DATABASE_URL"; user 2 = Aarav)
--     Each block is independent; every "-- must fail" statement raises an error.
-- BEGIN; SET LOCAL ROLE pb_student; SELECT set_config('app.user_id', '2', true);
--   SELECT count(*) FROM sessions;                         -- only Aarav's own sessions (row-level security)
--   SELECT password_hash FROM users;                       -- must fail: column privilege
--   SELECT * FROM audit_log;                               -- must fail: no privilege
--   UPDATE doubts SET status = 'resolved';                 -- must fail: status column not updatable
--   INSERT INTO sessions(doubt_id,helper_id,asker_id,slot_id) VALUES (1,2,1,1);   -- must fail: use sp_book_session
-- ROLLBACK;
-- BEGIN; SET LOCAL ROLE pb_admin; SELECT * FROM v_platform_stats; SELECT count(*) FROM audit_log; ROLLBACK;

-- Q16 VECTOR  Read / Update / Delete (embeddings are written by the app; these show the SQL side)
-- Read  : nearest open doubts to doubt 1 (HNSW cosine)
SELECT o.doubt_id, o.title, 1 - (o.embedding <=> d.embedding) AS similarity
FROM doubts d JOIN doubts o ON o.doubt_id <> d.doubt_id AND o.status = 'open'
WHERE d.doubt_id = 1 ORDER BY o.embedding <=> d.embedding LIMIT 3;
-- Update: re-embedding after an edit replaces the stored vector (here: copy another doubt's vector)
--   UPDATE doubts SET embedding = (SELECT embedding FROM doubts WHERE doubt_id = 3) WHERE doubt_id = 1;
-- Delete: the row and its vector leave the HNSW index together
--   DELETE FROM mastery WHERE user_id = 4 AND concept_id = 1;
