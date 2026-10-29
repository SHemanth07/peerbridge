-- =====================================================================
-- 04_roles_rls.sql  -  ROLE-BASED ACCESS CONTROL INSIDE POSTGRESQL
--
-- Run as the table owner (superuser) AFTER 01-03:
--     psql -v app_pw='<password>' -f db/04_roles_rls.sql
--
-- Design
--   pb_app      LOGIN role the Next.js app connects as. It owns NO privileges
--               itself; it may only SET ROLE to one of the three roles below.
--   pb_auth     used only by /api/auth/login and /register (pre-login).
--   pb_student  a logged-in student  : least privilege + row-level security.
--   pb_admin    a logged-in admin    : read everything, moderate, manage prereqs.
--
-- The API runs every request as
--     BEGIN; SET LOCAL ROLE pb_student|pb_admin; SELECT set_config('app.user_id', id, true); ...; COMMIT;
-- so even a bug (or SQL injection) in the application cannot exceed the
-- privileges of the caller's role.  Authorization is enforced by GRANT
-- (which table / column / operation) and by ROW LEVEL SECURITY (which rows).
-- =====================================================================

-- ---------- roles --------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pb_auth')    THEN CREATE ROLE pb_auth    NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pb_student') THEN CREATE ROLE pb_student NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pb_admin')   THEN CREATE ROLE pb_admin   NOLOGIN; END IF;
END $$;

SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pb_app') AS need_app \gset
\if :need_app
    CREATE ROLE pb_app LOGIN PASSWORD :'app_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE;
\else
    ALTER ROLE pb_app WITH LOGIN PASSWORD :'app_pw';
\endif

-- pb_app can become one of the roles but does not inherit their privileges
GRANT pb_auth, pb_student, pb_admin TO pb_app WITH INHERIT FALSE, SET TRUE;

-- ---------- start from zero ---------------------------------------------
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM PUBLIC, pb_app, pb_auth, pb_student, pb_admin;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, pb_app, pb_auth, pb_student, pb_admin;
GRANT USAGE ON SCHEMA public TO pb_auth, pb_student, pb_admin;

-- ---------- pb_auth : login / register only -----------------------------
GRANT SELECT ON users TO pb_auth;
GRANT INSERT (email, password_hash, full_name, semester) ON users TO pb_auth;   -- role/reputation use defaults
GRANT USAGE ON SEQUENCE users_user_id_seq TO pb_auth;

-- ---------- pb_student ----------------------------------------------------
-- reference data
GRANT SELECT ON courses, concepts, concept_prerequisites TO pb_student;
-- users: public profile columns only (no email, no password_hash)
GRANT SELECT (user_id, full_name, role, semester, reputation, created_at) ON users TO pb_student;
-- own enrolments
GRANT SELECT, INSERT, DELETE ON enrolments TO pb_student;
-- mastery (public helper profile, but only the owner may change it)
GRANT SELECT, INSERT, UPDATE, DELETE ON mastery TO pb_student;
-- doubts: cannot set status/asker/created_at except through the allowed columns
GRANT SELECT, DELETE ON doubts TO pb_student;
GRANT INSERT (asker_id, course_id, concept_id, title, body, embedding) ON doubts TO pb_student;
GRANT UPDATE (title, body, concept_id, embedding)                      ON doubts TO pb_student;
-- slots: offer / withdraw; is_booked can only be changed by triggers
GRANT SELECT, DELETE ON availability_slots TO pb_student;
GRANT INSERT (helper_id, start_time, end_time) ON availability_slots TO pb_student;
-- sessions: no direct INSERT (booking goes through sp_book_session)
GRANT SELECT ON sessions TO pb_student;
GRANT UPDATE (status, rating, feedback) ON sessions TO pb_student;
GRANT SELECT ON v_open_doubts TO pb_student;
GRANT USAGE ON SEQUENCE doubts_doubt_id_seq, availability_slots_slot_id_seq TO pb_student;

-- ---------- pb_admin ------------------------------------------------------
GRANT SELECT ON courses, concepts, concept_prerequisites, enrolments, mastery,
                doubts, availability_slots, sessions, audit_log TO pb_admin;
GRANT SELECT (user_id, email, full_name, role, semester, reputation, created_at) ON users TO pb_admin;
GRANT DELETE ON doubts TO pb_admin;                         -- moderation
GRANT INSERT, DELETE ON concept_prerequisites TO pb_admin;  -- curate the prerequisite graph
GRANT SELECT ON v_open_doubts, v_helper_leaderboard, v_concept_demand_supply,
                v_platform_stats, v_unserved_doubts TO pb_admin;

-- ---------- routines ------------------------------------------------------
REVOKE EXECUTE ON PROCEDURE sp_book_session(INT, INT, INT, INT)         FROM PUBLIC;
REVOKE EXECUTE ON PROCEDURE sp_complete_session(INT, SMALLINT, TEXT)    FROM PUBLIC;
GRANT  EXECUTE ON PROCEDURE sp_book_session(INT, INT, INT, INT)         TO pb_student;
GRANT  EXECUTE ON PROCEDURE sp_complete_session(INT, SMALLINT, TEXT)    TO pb_student;

-- ---------- ROW LEVEL SECURITY -------------------------------------------
-- make the script re-runnable: drop old policies first
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public' LOOP
        EXECUTE format('DROP POLICY %I ON %I', r.policyname, r.tablename);
    END LOOP;
END $$;

ALTER TABLE users              ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrolments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE mastery            ENABLE ROW LEVEL SECURITY;
ALTER TABLE doubts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log          ENABLE ROW LEVEL SECURITY;

-- users
CREATE POLICY users_auth_read   ON users FOR SELECT TO pb_auth    USING (true);
CREATE POLICY users_auth_insert ON users FOR INSERT TO pb_auth    WITH CHECK (role = 'student' AND reputation = 0);
CREATE POLICY users_student_read ON users FOR SELECT TO pb_student USING (true);   -- column grant hides email
CREATE POLICY users_admin_read  ON users FOR SELECT TO pb_admin   USING (true);

-- enrolments: strictly own rows
CREATE POLICY enr_student_all ON enrolments FOR ALL TO pb_student
    USING (user_id = fn_current_user_id()) WITH CHECK (user_id = fn_current_user_id());
CREATE POLICY enr_admin_read  ON enrolments FOR SELECT TO pb_admin USING (true);

-- mastery: everybody may see who mastered what (that is the point), only the owner may change it
CREATE POLICY mas_student_read   ON mastery FOR SELECT TO pb_student USING (true);
CREATE POLICY mas_student_insert ON mastery FOR INSERT TO pb_student WITH CHECK (user_id = fn_current_user_id());
CREATE POLICY mas_student_update ON mastery FOR UPDATE TO pb_student
    USING (user_id = fn_current_user_id()) WITH CHECK (user_id = fn_current_user_id());
CREATE POLICY mas_student_delete ON mastery FOR DELETE TO pb_student USING (user_id = fn_current_user_id());
CREATE POLICY mas_admin_read     ON mastery FOR SELECT TO pb_admin USING (true);

-- doubts: own doubts + other students' OPEN doubts are readable; only the owner edits / deletes, only while open
CREATE POLICY dbt_student_read   ON doubts FOR SELECT TO pb_student
    USING (asker_id = fn_current_user_id() OR status = 'open');
-- a helper must be able to read the doubt of every session he takes part in (even after it is matched / resolved)
CREATE POLICY dbt_student_read_helper ON doubts FOR SELECT TO pb_student
    USING (EXISTS (SELECT 1 FROM sessions se WHERE se.doubt_id = doubts.doubt_id AND se.helper_id = fn_current_user_id()));
CREATE POLICY dbt_student_insert ON doubts FOR INSERT TO pb_student WITH CHECK (asker_id = fn_current_user_id());
CREATE POLICY dbt_student_update ON doubts FOR UPDATE TO pb_student
    USING (asker_id = fn_current_user_id() AND status = 'open') WITH CHECK (asker_id = fn_current_user_id());
CREATE POLICY dbt_student_delete ON doubts FOR DELETE TO pb_student
    USING (asker_id = fn_current_user_id() AND status = 'open');
CREATE POLICY dbt_admin_read     ON doubts FOR SELECT TO pb_admin USING (true);
CREATE POLICY dbt_admin_delete   ON doubts FOR DELETE TO pb_admin USING (true);

-- availability slots: visible to all (needed for booking), managed only by the helper
CREATE POLICY slot_student_read   ON availability_slots FOR SELECT TO pb_student USING (true);
CREATE POLICY slot_student_insert ON availability_slots FOR INSERT TO pb_student WITH CHECK (helper_id = fn_current_user_id());
CREATE POLICY slot_student_delete ON availability_slots FOR DELETE TO pb_student
    USING (helper_id = fn_current_user_id() AND NOT is_booked);
CREATE POLICY slot_admin_read     ON availability_slots FOR SELECT TO pb_admin USING (true);

-- sessions: only the two participants (admin may read all)
CREATE POLICY ses_student_read   ON sessions FOR SELECT TO pb_student
    USING (asker_id = fn_current_user_id() OR helper_id = fn_current_user_id());
CREATE POLICY ses_student_update ON sessions FOR UPDATE TO pb_student
    USING (asker_id = fn_current_user_id() OR helper_id = fn_current_user_id())
    WITH CHECK (asker_id = fn_current_user_id() OR helper_id = fn_current_user_id());
CREATE POLICY ses_admin_read     ON sessions FOR SELECT TO pb_admin USING (true);

-- audit log: admin read-only; rows are written by SECURITY DEFINER triggers (run as owner)
CREATE POLICY aud_admin_read ON audit_log FOR SELECT TO pb_admin USING (true);
