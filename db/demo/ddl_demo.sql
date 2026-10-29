-- =====================================================================
-- DDL demo for the viva: ALTER / DROP / CREATE on a scratch table.
-- Run manually:  psql "$DATABASE_URL" -f db/demo/ddl_demo.sql
-- =====================================================================

-- CREATE
CREATE TABLE doubt_tags (
    tag_id     SERIAL PRIMARY KEY,
    doubt_id   INT NOT NULL REFERENCES doubts(doubt_id) ON DELETE CASCADE,
    tag        VARCHAR(40) NOT NULL
);

-- ALTER: add a column, a constraint and an index
ALTER TABLE doubt_tags ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE doubt_tags ADD CONSTRAINT uq_doubt_tag UNIQUE (doubt_id, tag);
ALTER TABLE doubt_tags ADD CONSTRAINT chk_tag_lower CHECK (tag = lower(tag));
CREATE INDEX idx_doubt_tags_tag ON doubt_tags(tag);

-- ALTER on a real table: add an optional column, then rename it
ALTER TABLE users ADD COLUMN bio TEXT;
ALTER TABLE users RENAME COLUMN bio TO about_me;
ALTER TABLE users DROP COLUMN about_me;

-- DROP
DROP INDEX idx_doubt_tags_tag;
DROP TABLE doubt_tags;
