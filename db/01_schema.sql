-- =====================================================================
-- PeerBridge : semantic peer doubt-resolution platform
-- 01_schema.sql  -  DDL: extensions, tables, keys, constraints
-- Target: PostgreSQL 16 + pgvector
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS vector;       -- pgvector: embeddings + similarity search
CREATE EXTENSION IF NOT EXISTS btree_gist;   -- needed for the slot-overlap EXCLUDE constraint

-- ---------------------------------------------------------------------
-- USERS  (two roles: student, admin)
-- ---------------------------------------------------------------------
CREATE TABLE users (
    user_id        SERIAL        PRIMARY KEY,
    email          VARCHAR(255)  NOT NULL UNIQUE,
    password_hash  TEXT          NOT NULL,
    full_name      VARCHAR(120)  NOT NULL CHECK (length(trim(full_name)) >= 2),
    role           VARCHAR(10)   NOT NULL DEFAULT 'student'
                                 CHECK (role IN ('student', 'admin')),
    semester       SMALLINT      CHECK (semester BETWEEN 1 AND 8),
    reputation     INT           NOT NULL DEFAULT 0 CHECK (reputation >= 0),
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT chk_email_format CHECK (email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);

-- ---------------------------------------------------------------------
-- COURSES and CONCEPTS (a concept is a teachable topic inside a course)
-- concepts.embedding : vector of "name. description" -> used to auto-tag doubts
-- ---------------------------------------------------------------------
CREATE TABLE courses (
    course_id  SERIAL       PRIMARY KEY,
    code       VARCHAR(12)  NOT NULL UNIQUE,
    title      VARCHAR(150) NOT NULL
);

CREATE TABLE concepts (
    concept_id   SERIAL        PRIMARY KEY,
    course_id    INT           NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
    name         VARCHAR(120)  NOT NULL,
    description  TEXT          NOT NULL,
    embedding    vector(384),
    CONSTRAINT uq_concept_per_course UNIQUE (course_id, name)
);

-- ---------------------------------------------------------------------
-- CONCEPT PREREQUISITES : self-referencing M:N on concepts (a DAG).
-- "Concept C requires concept P first."  Walked with a RECURSIVE CTE to
-- build a learning path for a doubt (see fn_learning_path).
-- Same-course and no-cycle rules are enforced by trigger trg_validate_prereq.
-- ---------------------------------------------------------------------
CREATE TABLE concept_prerequisites (
    concept_id       INT NOT NULL REFERENCES concepts(concept_id) ON DELETE CASCADE,
    prerequisite_id  INT NOT NULL REFERENCES concepts(concept_id) ON DELETE CASCADE,
    PRIMARY KEY (concept_id, prerequisite_id),
    CONSTRAINT chk_prereq_not_self CHECK (concept_id <> prerequisite_id)
);

-- ---------------------------------------------------------------------
-- ENROLMENTS  (M:N users <-> courses)  - transactional data
-- ---------------------------------------------------------------------
CREATE TABLE enrolments (
    user_id        INT          NOT NULL REFERENCES users(user_id)     ON DELETE CASCADE,
    course_id      INT          NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
    academic_term  VARCHAR(10)  NOT NULL DEFAULT '2026-ODD',
    enrolled_on    DATE         NOT NULL DEFAULT CURRENT_DATE,
    PRIMARY KEY (user_id, course_id)
);

-- ---------------------------------------------------------------------
-- MASTERY : "student X recently mastered concept Y"
-- note + embedding capture the helper's own words about what they learned.
-- A row only exists if score >= 70 (the mastery threshold).
-- ---------------------------------------------------------------------
CREATE TABLE mastery (
    user_id      INT          NOT NULL REFERENCES users(user_id)       ON DELETE CASCADE,
    concept_id   INT          NOT NULL REFERENCES concepts(concept_id) ON DELETE CASCADE,
    score        SMALLINT     NOT NULL,
    note         TEXT         NOT NULL CHECK (length(trim(note)) >= 10),
    mastered_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    embedding    vector(384),
    PRIMARY KEY (user_id, concept_id),
    CONSTRAINT chk_mastery_threshold CHECK (score BETWEEN 70 AND 100)
);

-- ---------------------------------------------------------------------
-- DOUBTS : the question a student wants help with
-- embedding   : semantic vector (title + body)
-- search_tsv  : generated tsvector for keyword full-text search
-- ---------------------------------------------------------------------
CREATE TABLE doubts (
    doubt_id    SERIAL        PRIMARY KEY,
    asker_id    INT           NOT NULL REFERENCES users(user_id)     ON DELETE CASCADE,
    course_id   INT           NOT NULL REFERENCES courses(course_id) ON DELETE RESTRICT,
    concept_id  INT           REFERENCES concepts(concept_id)        ON DELETE SET NULL,
    title       VARCHAR(200)  NOT NULL CHECK (length(trim(title)) >= 8),
    body        TEXT          NOT NULL CHECK (length(trim(body)) >= 20),
    status      VARCHAR(10)   NOT NULL DEFAULT 'open'
                              CHECK (status IN ('open', 'matched', 'resolved', 'cancelled')),
    embedding   vector(384),
    search_tsv  tsvector GENERATED ALWAYS AS
                (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, ''))) STORED,
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- AVAILABILITY SLOTS : when a helper can take a session
-- The EXCLUDE constraint makes overlapping slots for one helper impossible.
-- ---------------------------------------------------------------------
CREATE TABLE availability_slots (
    slot_id     SERIAL       PRIMARY KEY,
    helper_id   INT          NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    start_time  TIMESTAMPTZ  NOT NULL,
    end_time    TIMESTAMPTZ  NOT NULL,
    is_booked   BOOLEAN      NOT NULL DEFAULT FALSE,
    CONSTRAINT chk_slot_order  CHECK (end_time > start_time),
    CONSTRAINT chk_slot_length CHECK (end_time - start_time <= INTERVAL '2 hours'),
    CONSTRAINT uq_helper_start UNIQUE (helper_id, start_time),
    CONSTRAINT ex_no_overlap   EXCLUDE USING gist
        (helper_id WITH =, tstzrange(start_time, end_time) WITH &&)
);

-- ---------------------------------------------------------------------
-- SESSIONS : a booked help session (doubt + helper + slot)
-- ---------------------------------------------------------------------
CREATE TABLE sessions (
    session_id    SERIAL       PRIMARY KEY,
    doubt_id      INT          NOT NULL REFERENCES doubts(doubt_id)             ON DELETE CASCADE,
    helper_id     INT          NOT NULL REFERENCES users(user_id)               ON DELETE CASCADE,
    asker_id      INT          NOT NULL REFERENCES users(user_id)               ON DELETE CASCADE,
    slot_id       INT          NOT NULL REFERENCES availability_slots(slot_id)  ON DELETE CASCADE,
    status        VARCHAR(10)  NOT NULL DEFAULT 'scheduled'
                               CHECK (status IN ('scheduled', 'completed', 'cancelled')),
    rating        SMALLINT     CHECK (rating BETWEEN 1 AND 5),
    feedback      TEXT,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    completed_at  TIMESTAMPTZ,
    CONSTRAINT chk_not_self_help   CHECK (helper_id <> asker_id),
    CONSTRAINT chk_rating_on_done  CHECK (rating IS NULL OR status = 'completed')
);

-- one *active* session per doubt and per slot (cancelled ones may be re-booked)
CREATE UNIQUE INDEX uq_active_session_doubt ON sessions(doubt_id) WHERE status <> 'cancelled';
CREATE UNIQUE INDEX uq_active_session_slot  ON sessions(slot_id)  WHERE status <> 'cancelled';

-- ---------------------------------------------------------------------
-- AUDIT LOG (filled by triggers)
-- ---------------------------------------------------------------------
CREATE TABLE audit_log (
    log_id      BIGSERIAL    PRIMARY KEY,
    table_name  VARCHAR(40)  NOT NULL,
    action      VARCHAR(10)  NOT NULL,
    row_id      INT,
    details     JSONB,
    changed_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
