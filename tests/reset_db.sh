#!/bin/bash
# Rebuilds a throw-away local database with the stubs + migrations (local testing only).
set -e
PSQL="psql -h 127.0.0.1 -p 54329 -U postgres -v ON_ERROR_STOP=1 -q"
DB=${1:-scorpion_test}
$PSQL -d postgres -c "drop database if exists $DB" -c "create database $DB"
$PSQL -d $DB -f /home/claude/scorpion/tests/local_stubs.sql
for f in /home/claude/scorpion/supabase/migrations/0001_schema.sql /home/claude/scorpion/supabase/migrations/0002_functions.sql; do
  $PSQL -d $DB -f $f
done
echo "db $DB ready"
