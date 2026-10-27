-- =====================================================================
-- 03_indexes_views.sql  -  indexes and views
-- =====================================================================

-- ---- vector indexes (HNSW, cosine distance) ---------------------------
CREATE INDEX idx_mastery_embedding  ON mastery  USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_doubts_embedding   ON doubts   USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_concepts_embedding ON concepts USING hnsw (embedding vector_cosine_ops);

-- ---- full-text index --------------------------------------------------
CREATE INDEX idx_doubts_tsv ON doubts USING gin (search_tsv);

-- ---- B-tree / partial indexes for common lookups ----------------------
CREATE INDEX idx_doubts_asker        ON doubts(asker_id);
CREATE INDEX idx_doubts_status_course ON doubts(status, course_id);
CREATE INDEX idx_mastery_concept     ON mastery(concept_id, mastered_at DESC);
CREATE INDEX idx_slots_free          ON availability_slots(helper_id, start_time) WHERE NOT is_booked;
CREATE INDEX idx_sessions_helper     ON sessions(helper_id);
CREATE INDEX idx_sessions_asker      ON sessions(asker_id);
CREATE INDEX idx_audit_changed_at    ON audit_log(changed_at DESC);

-- ---- VIEWS ------------------------------------------------------------

-- open doubts with readable names
CREATE OR REPLACE VIEW v_open_doubts AS
SELECT d.doubt_id, d.title, d.body, d.created_at,
       c.code AS course_code, c.title AS course_title,
       k.name AS concept_name,
       u.user_id AS asker_id, u.full_name AS asker_name
FROM doubts d
JOIN courses  c ON c.course_id  = d.course_id
JOIN users    u ON u.user_id    = d.asker_id
LEFT JOIN concepts k ON k.concept_id = d.concept_id
WHERE d.status = 'open';

-- helper leaderboard: mastered concepts, completed sessions, average rating
CREATE OR REPLACE VIEW v_helper_leaderboard AS
SELECT u.user_id, u.full_name, u.reputation,
       COALESCE(m.concepts_mastered, 0)   AS concepts_mastered,
       COALESCE(s.sessions_done, 0)       AS sessions_done,
       s.avg_rating
FROM users u
LEFT JOIN (SELECT user_id, count(*) AS concepts_mastered
           FROM mastery GROUP BY user_id) m ON m.user_id = u.user_id
LEFT JOIN (SELECT helper_id, count(*) AS sessions_done,
                  round(avg(rating)::numeric, 2) AS avg_rating
           FROM sessions WHERE status = 'completed'
           GROUP BY helper_id) s ON s.helper_id = u.user_id
WHERE u.role = 'student'
  AND (COALESCE(m.concepts_mastered, 0) > 0 OR COALESCE(s.sessions_done, 0) > 0);

-- demand vs supply per concept: where do students need more helpers?
CREATE OR REPLACE VIEW v_concept_demand_supply AS
SELECT k.concept_id, c.code AS course_code, k.name AS concept_name,
       COALESCE(d.open_doubts, 0)  AS open_doubts,
       COALESCE(m.helpers, 0)      AS helpers
FROM concepts k
JOIN courses c ON c.course_id = k.course_id
LEFT JOIN (SELECT concept_id, count(*) AS open_doubts
           FROM doubts WHERE status = 'open' AND concept_id IS NOT NULL
           GROUP BY concept_id) d ON d.concept_id = k.concept_id
LEFT JOIN (SELECT concept_id, count(*) AS helpers
           FROM mastery GROUP BY concept_id) m ON m.concept_id = k.concept_id;

-- one-row platform summary for the admin dashboard
CREATE OR REPLACE VIEW v_platform_stats AS
SELECT
    (SELECT count(*) FROM users WHERE role = 'student')                AS students,
    (SELECT count(*) FROM doubts)                                      AS total_doubts,
    (SELECT count(*) FROM doubts WHERE status = 'open')                AS open_doubts,
    (SELECT count(*) FROM doubts WHERE status = 'resolved')            AS resolved_doubts,
    (SELECT count(*) FROM sessions WHERE status = 'scheduled')         AS scheduled_sessions,
    (SELECT count(*) FROM sessions WHERE status = 'completed')         AS completed_sessions,
    (SELECT round(avg(rating)::numeric, 2) FROM sessions
      WHERE status = 'completed')                                      AS avg_rating;

-- reverse lookup for the prerequisite graph ("what depends on this concept?")
CREATE INDEX idx_prereq_prerequisite ON concept_prerequisites(prerequisite_id);

-- open, tagged doubts for which NO other student who mastered the same concept
-- currently has a free future slot.  CORRELATED subquery (NOT EXISTS refers to d).
CREATE OR REPLACE VIEW v_unserved_doubts AS
SELECT d.doubt_id, d.title, d.created_at,
       c.code AS course_code, k.name AS concept_name, u.full_name AS asker_name
FROM doubts d
JOIN courses  c ON c.course_id  = d.course_id
JOIN concepts k ON k.concept_id = d.concept_id
JOIN users    u ON u.user_id    = d.asker_id
WHERE d.status = 'open'
  AND NOT EXISTS (
        SELECT 1
        FROM mastery m
        JOIN availability_slots s ON s.helper_id = m.user_id
        WHERE m.concept_id = d.concept_id          -- correlated to the outer doubt
          AND m.user_id   <> d.asker_id
          AND NOT s.is_booked
          AND s.start_time > now());
