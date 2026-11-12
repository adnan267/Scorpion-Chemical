#!/bin/bash
# LOCAL TESTING ONLY: fresh demo database + restart the local stand-in backend
pkill -f "node gateway.mjs" 2>/dev/null; sleep 1
/home/claude/scorpion/tests/reset_db.sh scorpion_e2e >/dev/null 2>&1
psql -h 127.0.0.1 -p 54329 -U postgres -d scorpion_e2e -q -f /home/claude/scorpion/tests/seed_e2e.sql 2>&1 | grep -iE "error|seeded"
UA=$(psql -h 127.0.0.1 -p 54329 -U postgres -d scorpion_e2e -Atc "select id from profiles where role='store'")
OLD=$(ls /tmp/scorpion-storage/payment-proofs | head -1)
[ -n "$OLD" ] && [ "$OLD" != "$UA" ] && mv /tmp/scorpion-storage/payment-proofs/$OLD /tmp/scorpion-storage/payment-proofs/$UA
cd /home/claude/scorpion/tests && (nohup node gateway.mjs > /tmp/gateway.log 2>&1 &)
sleep 2; tail -1 /tmp/gateway.log
