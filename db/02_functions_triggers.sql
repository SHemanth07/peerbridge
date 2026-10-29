-- =====================================================================
-- 02_functions_triggers.sql  -  triggers, stored functions, stored procedures
-- Requires 01_schema.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Session helpers.  The API opens every request with
--     SET LOCAL ROLE pb_student | pb_admin;  set_config('app.user_id', <id>, true)
-- so the database itself always knows WHO is calling (used by RLS policies
-- in 04_roles_rls.sql and by the functions below).  Both are NULL / false
-- when run by the owner (seed script, psql), so admin scripts are unaffected.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_current_user_id() RETURNS INT AS $$
    SELECT NULLIF(current_setting('app.user_id', true), '')::INT
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION fn_is_admin() RETURNS BOOLEAN AS $$
    SELECT current_user = 'pb_admin'
$$ LANGUAGE sql STABLE;

-- ---------------------------------------------------------------------
-- TRIGGER 1 : a mastery row is only valid if the user is enrolled in the
--             course that owns the concept  (data integrity at DB level)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_validate_mastery() RETURNS trigger AS $$
DECLARE
    v_course INT;
BEGIN
    SELECT course_id INTO v_course FROM concepts WHERE concept_id = NEW.concept_id;
    IF NOT EXISTS (SELECT 1 FROM enrolments
                   WHERE user_id = NEW.user_id AND course_id = v_course) THEN
        RAISE EXCEPTION 'You must be enrolled in the concept''s course before recording mastery';
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validate_mastery
    BEFORE INSERT OR UPDATE ON mastery
    FOR EACH ROW EXECUTE FUNCTION fn_validate_mastery();

-- ---------------------------------------------------------------------
-- TRIGGER 2 : a doubt must be asked by an enrolled student, and its
--             concept (if any) must belong to the same course
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_validate_doubt() RETURNS trigger AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM enrolments
                   WHERE user_id = NEW.asker_id AND course_id = NEW.course_id) THEN
        RAISE EXCEPTION 'You can only post doubts for courses you are enrolled in';
    END IF;
    IF NEW.concept_id IS NOT NULL AND NOT EXISTS
       (SELECT 1 FROM concepts WHERE concept_id = NEW.concept_id AND course_id = NEW.course_id) THEN
        RAISE EXCEPTION 'Concept does not belong to the selected course';
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validate_doubt
    BEFORE INSERT ON doubts
    FOR EACH ROW EXECUTE FUNCTION fn_validate_doubt();

-- ---------------------------------------------------------------------
-- TRIGGER 3 : validate a new session (BEFORE INSERT)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_validate_session() RETURNS trigger AS $$
DECLARE
    v_slot  availability_slots%ROWTYPE;
    v_doubt doubts%ROWTYPE;
BEGIN
    SELECT * INTO v_slot  FROM availability_slots WHERE slot_id  = NEW.slot_id;
    SELECT * INTO v_doubt FROM doubts             WHERE doubt_id = NEW.doubt_id;

    IF v_slot.helper_id <> NEW.helper_id THEN
        RAISE EXCEPTION 'Slot % does not belong to helper %', NEW.slot_id, NEW.helper_id;
    END IF;
    IF v_slot.is_booked THEN
        RAISE EXCEPTION 'This slot has already been booked';
    END IF;
    IF v_slot.start_time <= now() THEN
        RAISE EXCEPTION 'Cannot book a slot in the past';
    END IF;
    IF v_doubt.asker_id <> NEW.asker_id THEN
        RAISE EXCEPTION 'Only the doubt owner can book a session for it';
    END IF;
    IF v_doubt.status <> 'open' THEN
        RAISE EXCEPTION 'Doubt is not open (current status: %)', v_doubt.status;
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validate_session
    BEFORE INSERT ON sessions
    FOR EACH ROW EXECUTE FUNCTION fn_validate_session();

-- ---------------------------------------------------------------------
-- TRIGGER 4 : keep slot + doubt consistent after a session is created
--             (SECURITY DEFINER: it must update rows the caller does not own,
--              e.g. the helper's slot, which no student may UPDATE directly)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_session_created() RETURNS trigger AS $$
BEGIN
    UPDATE availability_slots SET is_booked = TRUE   WHERE slot_id  = NEW.slot_id;
    UPDATE doubts             SET status    = 'matched' WHERE doubt_id = NEW.doubt_id;
    RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trg_session_created
    AFTER INSERT ON sessions
    FOR EACH ROW EXECUTE FUNCTION fn_session_created();

-- ---------------------------------------------------------------------
-- TRIGGER 5 : session status transitions
--   BEFORE UPDATE : stamp completed_at, forbid illegal transitions
--   AFTER  UPDATE : completed -> doubt resolved + reputation points
--                   cancelled -> slot freed + doubt re-opened
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_session_before_update() RETURNS trigger AS $$
BEGIN
    IF OLD.status <> 'scheduled' AND NEW.status <> OLD.status THEN
        RAISE EXCEPTION 'Session is already % and cannot change state', OLD.status;
    END IF;
    IF NEW.status = 'completed' AND OLD.status = 'scheduled' THEN
        -- only the student who asked may confirm completion (skipped for owner scripts)
        IF fn_current_user_id() IS NOT NULL AND fn_current_user_id() <> OLD.asker_id THEN
            RAISE EXCEPTION 'Only the student who asked can complete the session';
        END IF;
        NEW.completed_at := now();
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_session_before_update
    BEFORE UPDATE ON sessions
    FOR EACH ROW EXECUTE FUNCTION fn_session_before_update();

CREATE OR REPLACE FUNCTION fn_session_after_update() RETURNS trigger AS $$
BEGIN
    IF NEW.status = 'completed' AND OLD.status = 'scheduled' THEN
        UPDATE doubts SET status = 'resolved' WHERE doubt_id = NEW.doubt_id;
        UPDATE users  SET reputation = reputation + 10 + COALESCE(NEW.rating, 0) * 2
                      WHERE user_id = NEW.helper_id;
    ELSIF NEW.status = 'cancelled' AND OLD.status = 'scheduled' THEN
        UPDATE availability_slots SET is_booked = FALSE  WHERE slot_id  = NEW.slot_id;
        UPDATE doubts             SET status    = 'open' WHERE doubt_id = NEW.doubt_id;
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trg_session_after_update
    AFTER UPDATE OF status ON sessions
    FOR EACH ROW EXECUTE FUNCTION fn_session_after_update();

-- ---------------------------------------------------------------------
-- TRIGGER 6 : deleting a still-scheduled session frees its slot
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_session_deleted() RETURNS trigger AS $$
BEGIN
    IF OLD.status = 'scheduled' THEN
        UPDATE availability_slots SET is_booked = FALSE WHERE slot_id = OLD.slot_id;
    END IF;
    RETURN OLD;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trg_session_deleted
    AFTER DELETE ON sessions
    FOR EACH ROW EXECUTE FUNCTION fn_session_deleted();

-- ---------------------------------------------------------------------
-- TRIGGER 7 : generic audit trail on doubts and sessions
--   TG_ARGV[0] = name of the primary-key column
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_audit() RETURNS trigger AS $$
DECLARE
    v_row JSONB;
BEGIN
    v_row := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
    -- never store big embedding arrays in the log
    v_row := v_row - 'embedding' - 'search_tsv';
    INSERT INTO audit_log(table_name, action, row_id, details)
    VALUES (TG_TABLE_NAME, TG_OP, (v_row ->> TG_ARGV[0])::INT, v_row);
    RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trg_audit_doubts
    AFTER INSERT OR UPDATE OR DELETE ON doubts
    FOR EACH ROW EXECUTE FUNCTION fn_audit('doubt_id');

CREATE TRIGGER trg_audit_sessions
    AFTER INSERT OR UPDATE OR DELETE ON sessions
    FOR EACH ROW EXECUTE FUNCTION fn_audit('session_id');

-- =====================================================================
-- STORED FUNCTION : fn_find_peers
-- Semantic peer matching for one doubt.
--   1. take the doubt's embedding
--   2. find the nearest MASTERY embeddings (cosine distance, HNSW index)
--   3. keep each peer's best-matching concept
--   4. blend: 70% semantic similarity + 20% recency of mastery
--             (exponential decay, 30-day time-constant) + 10% reputation
--   5. only peers who have a free future slot are returned
-- =====================================================================
CREATE OR REPLACE FUNCTION fn_find_peers(p_doubt_id INT, p_limit INT DEFAULT 5)
RETURNS TABLE (
    peer_id            INT,
    peer_name          VARCHAR,
    matched_concept_id INT,
    matched_concept    VARCHAR,
    mastery_note       TEXT,
    mastered_at        TIMESTAMPTZ,
    similarity         DOUBLE PRECISION,
    recency            DOUBLE PRECISION,
    peer_reputation    INT,
    next_slot          TIMESTAMPTZ,
    match_score        DOUBLE PRECISION
) AS $$
#variable_conflict use_column
DECLARE
    v_emb   vector(384);
    v_asker INT;
BEGIN
    SELECT d.embedding, d.asker_id INTO v_emb, v_asker
    FROM doubts d WHERE d.doubt_id = p_doubt_id;

    IF v_emb IS NULL THEN
        RAISE EXCEPTION 'Doubt % not found or has no embedding', p_doubt_id;
    END IF;
    IF fn_current_user_id() IS NOT NULL AND v_asker <> fn_current_user_id() AND NOT fn_is_admin() THEN
        RAISE EXCEPTION 'Only the asker can view matches for doubt %', p_doubt_id;
    END IF;

    RETURN QUERY
    WITH nearest AS (
        SELECT m.user_id, m.concept_id, m.note, m.mastered_at,
               (1 - (m.embedding <=> v_emb))::float8 AS sim
        FROM mastery m
        WHERE m.user_id <> v_asker AND m.embedding IS NOT NULL
        ORDER BY m.embedding <=> v_emb          -- uses the HNSW index
        LIMIT 50
    ),
    best_per_peer AS (
        SELECT DISTINCT ON (n.user_id) n.*
        FROM nearest n
        ORDER BY n.user_id, n.sim DESC
    )
    SELECT u.user_id, u.full_name, b.concept_id, c.name, b.note, b.mastered_at,
           b.sim,
           exp(-extract(epoch FROM (now() - b.mastered_at)) / 86400.0 / 30.0)::float8 AS rec,
           u.reputation,
           s.next_slot,
           (0.70 * b.sim
            + 0.20 * exp(-extract(epoch FROM (now() - b.mastered_at)) / 86400.0 / 30.0)
            + 0.10 * least(u.reputation, 100) / 100.0)::float8 AS score
    FROM best_per_peer b
    JOIN users    u ON u.user_id    = b.user_id
    JOIN concepts c ON c.concept_id = b.concept_id
    CROSS JOIN LATERAL (
        SELECT min(a.start_time) AS next_slot
        FROM availability_slots a
        WHERE a.helper_id = b.user_id AND NOT a.is_booked AND a.start_time > now()
    ) s
    WHERE s.next_slot IS NOT NULL
    ORDER BY score DESC
    LIMIT p_limit;
END $$ LANGUAGE plpgsql STABLE;

-- =====================================================================
-- STORED PROCEDURE : sp_complete_session
-- Marks a session completed with rating + feedback; triggers do the rest.
-- =====================================================================
CREATE OR REPLACE PROCEDURE sp_complete_session(
    p_session_id INT, p_rating SMALLINT, p_feedback TEXT)
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE sessions
       SET status = 'completed', rating = p_rating, feedback = p_feedback
     WHERE session_id = p_session_id AND status = 'scheduled';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Session % not found or is not in scheduled state', p_session_id;
    END IF;
END $$;

-- =====================================================================
-- TRIGGER 8 : concept prerequisites must stay inside one course and
--             must never form a cycle (A requires B requires A).
--             Cycle detection uses a RECURSIVE CTE walking up the graph.
-- =====================================================================
CREATE OR REPLACE FUNCTION fn_validate_prereq() RETURNS trigger AS $$
BEGIN
    IF (SELECT course_id FROM concepts WHERE concept_id = NEW.concept_id)
       IS DISTINCT FROM
       (SELECT course_id FROM concepts WHERE concept_id = NEW.prerequisite_id) THEN
        RAISE EXCEPTION 'A prerequisite must belong to the same course as the concept';
    END IF;

    -- (concept C requires P) is a cycle if P already requires C, directly or transitively.
    IF EXISTS (
        WITH RECURSIVE ancestors(cid) AS (
            SELECT prerequisite_id FROM concept_prerequisites WHERE concept_id = NEW.prerequisite_id
            UNION                                   -- UNION (not ALL) also stops loops
            SELECT p.prerequisite_id
            FROM concept_prerequisites p JOIN ancestors a ON p.concept_id = a.cid
        )
        SELECT 1 FROM ancestors WHERE cid = NEW.concept_id
    ) THEN
        RAISE EXCEPTION 'This prerequisite would create a cycle';
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validate_prereq
    BEFORE INSERT OR UPDATE ON concept_prerequisites
    FOR EACH ROW EXECUTE FUNCTION fn_validate_prereq();

-- =====================================================================
-- STORED FUNCTION : fn_learning_path  (RECURSIVE CTE)
-- For a doubt, walk the prerequisite graph of its concept to any depth and
-- return the foundations in learning order (deepest prerequisite first),
-- with: did the asker already master it? how many peers can help with it?
-- =====================================================================
CREATE OR REPLACE FUNCTION fn_learning_path(p_doubt_id INT)
RETURNS TABLE (
    concept_id        INT,
    concept_name      VARCHAR,
    depth             INT,
    already_mastered  BOOLEAN,
    helpers           BIGINT
) AS $$
#variable_conflict use_column
DECLARE
    v_concept INT;
    v_asker   INT;
BEGIN
    SELECT d.concept_id, d.asker_id INTO v_concept, v_asker FROM doubts d WHERE d.doubt_id = p_doubt_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Doubt % not found', p_doubt_id;
    END IF;

    RETURN QUERY
    WITH RECURSIVE path(cid, lvl) AS (
        -- anchor: direct prerequisites of the doubt's concept
        SELECT cp.prerequisite_id, 1
        FROM concept_prerequisites cp
        WHERE cp.concept_id = v_concept
        UNION ALL
        -- recursive step: prerequisites of prerequisites
        SELECT cp.prerequisite_id, path.lvl + 1
        FROM concept_prerequisites cp
        JOIN path ON cp.concept_id = path.cid
        WHERE path.lvl < 10                         -- safety net
    ),
    deepest AS (                                    -- a concept reachable by two routes: keep the deepest
        SELECT cid, max(lvl) AS lvl FROM path GROUP BY cid
    )
    SELECT k.concept_id, k.name, dp.lvl,
           EXISTS (SELECT 1 FROM mastery m WHERE m.concept_id = k.concept_id AND m.user_id = v_asker),
           (SELECT count(*) FROM mastery m WHERE m.concept_id = k.concept_id AND m.user_id <> v_asker)
    FROM deepest dp
    JOIN concepts k ON k.concept_id = dp.cid
    ORDER BY dp.lvl DESC, k.name;
END $$ LANGUAGE plpgsql STABLE;

-- =====================================================================
-- STORED PROCEDURE : sp_book_session   (ACID transaction unit)
-- Books a help session.  SECURITY DEFINER because a student may not UPDATE
-- someone else's slot, yet booking must lock it.  The asker is taken from the
-- session variable app.user_id, never from a parameter, so it cannot be spoofed.
--   1. lock the slot row   (SELECT ... FOR UPDATE)  -> concurrent bookers queue up
--   2. lock the doubt row
--   3. INSERT the session  -> triggers mark slot booked + doubt matched
-- The API calls it inside BEGIN ... COMMIT; any error rolls everything back.
-- Custom SQLSTATEs: PB404 = not found, PB409 = conflict (mapped to HTTP in lib/http.ts).
-- =====================================================================
CREATE OR REPLACE PROCEDURE sp_book_session(
    p_doubt_id INT, p_helper_id INT, p_slot_id INT, INOUT p_session_id INT DEFAULT NULL)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_asker INT := fn_current_user_id();
    v_slot  availability_slots%ROWTYPE;
    v_doubt doubts%ROWTYPE;
BEGIN
    IF v_asker IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_slot FROM availability_slots WHERE slot_id = p_slot_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Slot not found' USING ERRCODE = 'PB404'; END IF;
    IF v_slot.is_booked THEN
        RAISE EXCEPTION 'Someone just booked that slot - pick another' USING ERRCODE = 'PB409';
    END IF;
    IF v_slot.helper_id <> p_helper_id THEN
        RAISE EXCEPTION 'Slot does not belong to that helper';
    END IF;

    SELECT * INTO v_doubt FROM doubts WHERE doubt_id = p_doubt_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Doubt not found' USING ERRCODE = 'PB404'; END IF;
    IF v_doubt.asker_id <> v_asker THEN
        RAISE EXCEPTION 'Not your doubt' USING ERRCODE = '42501';
    END IF;
    IF v_doubt.status <> 'open' THEN
        RAISE EXCEPTION 'This doubt already has a session or is closed' USING ERRCODE = 'PB409';
    END IF;

    INSERT INTO sessions (doubt_id, helper_id, asker_id, slot_id)
    VALUES (p_doubt_id, p_helper_id, v_asker, p_slot_id)
    RETURNING session_id INTO p_session_id;
END $$;
