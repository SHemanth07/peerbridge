#!/bin/bash
# Docker entrypoint hook: runs 04_roles_rls.sql with the app password taken from the environment,
# so no password is written in any source file.
set -e
psql -v ON_ERROR_STOP=1 -v app_pw="$APP_DB_PASSWORD" \
     --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
     -f /opt/peerbridge/04_roles_rls.sql
