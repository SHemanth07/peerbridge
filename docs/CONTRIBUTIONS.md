# Individual contributions and commit plan

**Team 30:** Saikavin S (PES1UG24CS402), S. Hemanth Kumar (PES1UG24CS418)

The evaluation asks for **individual contribution** and for commits that show it. Both members must contribute to the **database and the application**, so the work below is split so that each person owns a slice of each. Edit the names to match what you actually did; each of you should be able to explain your slice in the viva.

| Area | Member 1: Saikavin S | Member 2: S. Hemanth Kumar |
|---|---|---|
| Database design | ER diagram, `01_schema.sql` (users, courses, concepts, enrolments, mastery, doubts) | `concept_prerequisites`, slots, sessions, audit log tables and constraints |
| Triggers / routines | validation triggers, `fn_find_peers`, `fn_learning_path` | booking / session triggers, `sp_book_session`, `sp_complete_session`, prerequisite cycle trigger |
| Vector | embeddings, HNSW, auto-tagging, semantic search, edit / re-embed | mastery embeddings, similar doubts, recency scoring |
| Security | `04_roles_rls.sql` (roles, GRANTs, RLS), `lib/db.ts` | JWT auth, middleware, register / login, error mapping |
| API | doubts, matches, path, similar | sessions, slots, mastery, admin, prerequisites |
| UI | doubts pages, browse, learning path | expertise, sessions, admin dashboard |
| Tests / docs | `test_db.mjs`, ER diagram, report sections 3-7 | `test_api.mjs`, README, report sections 8-12 |

## Suggested commit sequence (each person commits their own files under their own Git identity)

```bash
git init && git branch -M main
git config user.name  "<your name>"      # each person sets their own, on their own machine
git config user.email "<your email>"

# Saikavin
git add db/01_schema.sql                  && git commit -m "schema: users, courses, concepts, mastery, doubts"
git add db/02_functions_triggers.sql      && git commit -m "triggers: validation, fn_find_peers, fn_learning_path"
git add db/04_roles_rls.sql db/04_roles.sh && git commit -m "rbac: roles, grants, row-level security"
git add lib app/api/doubts app/\(app\)/doubts app/\(app\)/browse && git commit -m "doubts: embed, auto-tag, semantic search, edit"

# Hemanth Kumar (pull first, then)
git add db/03_indexes_views.sql           && git commit -m "indexes and views incl. v_unserved_doubts"
git add app/api/sessions app/api/slots app/api/mastery && git commit -m "booking transaction, slots, mastery"
git add app/\(app\)/admin app/api/admin   && git commit -m "admin dashboard and prerequisite graph"
git add scripts/test_api.mjs docs         && git commit -m "api tests and documentation"
```

Push to a GitHub repository, then put its URL in `docs/PROJECT_REPORT.md`. Do not commit `.env` or `node_modules` (both are in `.gitignore`).
