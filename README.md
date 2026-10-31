# PeerBridge

**Semantic peer doubt resolution.** Students post a doubt in their own words. PeerBridge embeds it and matches it, by *meaning* rather than by batch or section, to peers who **recently mastered the same concept**, then books a time slot with them.

- **PostgreSQL** holds all transactional data: users, enrolments, doubts, slots, sessions, reputation, audit log.
- **pgvector** (inside the same PostgreSQL) holds 384-dimensional embeddings for doubts, concepts and mastery notes, and powers similarity search.
- **Next.js 15** provides both the UI and the API (Route Handlers).

> DBMS Experiential Learning, Level 3, **Option 2: SQL + Vector database** (PostgreSQL with pgvector).

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 15 (App Router, React 19, TypeScript) |
| Backend/API | Next.js Route Handlers |
| SQL database | PostgreSQL 16 |
| Vector database | pgvector (HNSW index, cosine distance) |
| Embeddings | `all-MiniLM-L6-v2` (384-dim) running locally via Transformers.js, no API key |
| Auth | bcrypt password hashes, JWT in an httpOnly cookie, roles `student` / `admin` |
| Access control | **PostgreSQL roles + column privileges + row-level security** (the API runs each request as `pb_student` / `pb_admin`) |
| Version control | Git + GitHub |

## Setup

Prerequisites: **Node 20+**, **Docker** (for PostgreSQL + pgvector).

```bash
# 1. install dependencies
npm install

# 2. configure environment (nothing sensitive is hard-coded)
cp .env.example .env          # then change every "change_me" value and JWT_SECRET

# 3. start PostgreSQL + pgvector; db/01-04 run automatically on first start
#    (04 creates the roles, using APP_DB_PASSWORD from .env)
docker compose up -d

# 4. load demo data (first run downloads the ~90 MB embedding model once)
npm run seed

# 5. run the app
npm run dev                   # http://localhost:3000
```

To wipe the database and start over: `npm run db:reset` and then `npm run seed`.

**Without Docker** (local PostgreSQL 16 + pgvector installed): create a database, then as a superuser run
`psql -d peerbridge -f db/01_schema.sql -f db/02_functions_triggers.sql -f db/03_indexes_views.sql` and
`psql -d peerbridge -v app_pw='<APP_DB_PASSWORD>' -f db/04_roles_rls.sql`; point `OWNER_DATABASE_URL` at the owner and `DATABASE_URL` at `pb_app`.

### Run the tests

```bash
npm run test:db     # 44 database tests: constraints, triggers, RBAC / RLS, recursive CTE, concurrency, HNSW
npm run dev         # in another terminal ...
npm run test:api    # 44 HTTP tests: auth, vector create/read/update/delete, booking, learning path
```

### Demo accounts (created by the seed)

| Role | Email | Password |
|---|---|---|
| Admin | `admin@peerbridge.edu` | `Admin@123` |
| Student | `aarav@student.edu` (also `diya`, `rohan`, `meera`, `kabir`, `ananya`, `vikram`, `isha`, `arjun`, `sneha`) | `Student@123` |

### Try this in the demo

1. Log in as **Aarav**, open *My doubts*, and look at the seeded doubt about a bank transfer that survives a crash. Open it and see the ranked peers.
2. Post a new doubt in your own words; it is embedded and **auto-tagged** to the nearest concept.
3. Book a slot with a peer (this is an explicit transaction with row locks).
4. Log in as another student, add a concept under *My expertise*, then re-open the first student's doubt: the new helper appears.
5. *Browse doubts* has two modes: **Keyword** (full-text search, highlighted matches) and **Semantic** (pgvector, finds doubts by meaning).
6. On a doubt page: **Edit doubt** (re-embeds and re-matches), the **Learning path** (recursive query over concept prerequisites) and **Others asking something similar**.
7. Log in as **admin** for the dashboard built on SQL views and the trigger-fed audit log, the *Unserved doubts* panel, and the prerequisite-graph editor (try adding a cycle: the database refuses).

## Project layout

```
db/
  01_schema.sql              DDL: tables, keys, CHECK / UNIQUE / EXCLUDE constraints
  02_functions_triggers.sql  8 triggers, fn_find_peers(), fn_learning_path() (recursive CTE), sp_book_session(), sp_complete_session()
  03_indexes_views.sql       HNSW, GIN, B-tree and partial indexes, 5 views
  04_roles_rls.sql           roles pb_app / pb_auth / pb_student / pb_admin, GRANTs, row-level security
  04_roles.sh                Docker hook that passes APP_DB_PASSWORD to 04
  demo/ddl_demo.sql          CREATE / ALTER / DROP demonstration
  demo/demo_queries.sql      JOIN, GROUP BY/HAVING, subquery, window, full-text, vector, transaction
scripts/seed.mjs             demo data + embeddings (runs as the schema owner)
scripts/test_db.mjs          database test suite
scripts/test_api.mjs         HTTP test suite
scripts/screenshots.py       optional: captures report screenshots
lib/                         db pool, auth (JWT), embeddings, error mapping
app/api/                     REST endpoints (see docs/PROJECT_REPORT.md)
app/(app)/                   authenticated UI pages
docs/PROJECT_REPORT.md       report: ER diagram, schema, data dictionary, queries, tests, rubric map
docs/er_diagram.png|.svg|.dot  ER diagram (Chen notation; rebuilt by scripts/make_er_diagram.py)
docs/CONTRIBUTIONS.md        who did what + commit plan
docs/VIVA_PREP.md            questions and answers for the viva
docs/test_results/           saved test logs
```

## How matching works

1. The doubt text (`title + body`) is embedded and stored in `doubts.embedding`.
2. `fn_find_peers(doubt_id)` takes the nearest `mastery.embedding` rows by cosine distance (`<=>`, HNSW index).
3. Each peer keeps their best-matching concept.
4. Score = **0.70 x similarity + 0.20 x recency + 0.10 x reputation**, where recency decays exponentially with a 30-day time constant (so someone who mastered the topic last week beats someone who did last term).
5. Only peers with a free future slot are returned.

## Database rules enforced inside PostgreSQL

Validation does not rely on the application. Examples: mastery score must be 70-100; a mastery or doubt requires enrolment in the course (trigger); no self-help sessions; no overlapping slots for a helper (`EXCLUDE USING gist`); slot length at most 2 hours; one active session per doubt and per slot (partial unique indexes); rating 1-5 only on completed sessions; email format. The API simply surfaces the database's error message.

## Access control (in the database)

`pb_app` is the only login role the app uses and it owns **no table privileges**. Each request runs `SET LOCAL ROLE pb_student` (or `pb_admin`) and sets `app.user_id`; PostgreSQL then enforces which tables, columns and **rows** are reachable (e.g. a student sees only his own sessions and cannot read `password_hash`, `audit_log`, or write `doubts.status`). Details and tests: `docs/PROJECT_REPORT.md` section 7.5.

## Notes

- Never commit `.env`. Credentials come only from environment variables.
- The Next.js route handlers re-check the session and role on every request; `middleware.ts` is only an extra page-level guard.
- Each team member should commit their own work under their own Git identity so individual contributions are visible.
