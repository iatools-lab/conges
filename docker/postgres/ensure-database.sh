#!/bin/sh
set -eu

: "${POSTGRES_DB:=conges}"
: "${POSTGRES_USER:=conges}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD manquant}"

case "$POSTGRES_PASSWORD" in
  "replace-with-generated-password"|"replace-with-your-postgres-password"|"CHANGE_ME_POSTGRES_PASSWORD")
    echo "POSTGRES_PASSWORD doit etre remplace par votre propre mot de passe."
    exit 1
    ;;
esac

echo "Verification de la base PostgreSQL '$POSTGRES_DB' pour l'utilisateur '$POSTGRES_USER'"

psql \
  -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname postgres \
  -v target_db="$POSTGRES_DB" \
  -v target_user="$POSTGRES_USER" \
  -v target_password="$POSTGRES_PASSWORD" <<'SQL'
SELECT format('CREATE DATABASE %I OWNER %I', :'target_db', :'target_user')
WHERE NOT EXISTS (
  SELECT 1 FROM pg_database WHERE datname = :'target_db'
)
\gexec

SELECT format('ALTER DATABASE %I OWNER TO %I', :'target_db', :'target_user')
WHERE EXISTS (
  SELECT 1 FROM pg_database WHERE datname = :'target_db'
)
\gexec

SELECT format('ALTER USER %I WITH PASSWORD %L', :'target_user', :'target_password')
\gexec

SELECT format('GRANT ALL PRIVILEGES ON DATABASE %I TO %I', :'target_db', :'target_user')
\gexec
SQL

echo "Base PostgreSQL prete: $POSTGRES_DB"