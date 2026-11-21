# PayGuard Operations Runbook

Production posture: API on Render (PostgreSQL durable mode), dashboard on
Vercel (session-gated proxy). Money APIs never boot without auth; the money
ledger is the single source of truth and always fails closed.

## 1. Secrets & Key Rotation (do this before any public demo)

Exposed keys are rotated by **generating new ones and updating both sides** —
never edit a leaked key in place.

```bash
# 1. Generate fresh keys (one per role)
openssl rand -hex 32   # -> PROPOSER key
openssl rand -hex 32   # -> APPROVER key (dashboard/proxy uses this one)

# 2. Render -> payguard-api -> Environment -> PAYGUARD_API_KEYS:
#    pgk_<hex1>:owner_northstar:proposer,pgk_<hex2>:owner_northstar:approver
#    (Save = auto-redeploy; boot log must print "Auth: API-key auth ENABLED (2 key(s))")

# 3. Vercel -> project -> Settings -> Environment Variables:
#    PAYGUARD_API_KEY      = pgk_<hex2>:owner_northstar:approver   (proxy key, server-only)
#    PAYGUARD_DASHBOARD_PASSWORD = <strong password, generated same way>
#    (After env changes: Deployments -> Redeploy — functions snapshot env at deploy time)

# 4. Verify both sides, then consider the old key dead:
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer <OLD key>" https://<render-host>/v1/transactions   # expect 401
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer <NEW key>" https://<render-host>/v1/transactions   # expect 200
```

Roles (maker-checker): `proposer` may evaluate/run the agent but the API
rejects every money-moving call with `403 FORBIDDEN_ROLE`; only
`approver`/`admin` keys settle. The dashboard proxy carries the approver key.

## 2. Monitoring & Alerts

- **UptimeRobot** (free): HTTP monitor every 10 min on `https://<render-host>/healthz`
  — keeps the free instance warm AND is your first alerting line (email on down).
- **Render metrics**: request volume + latency + memory on the service page;
  configure the Slack/email notification for deploy failures.
- **Vercel analytics** on the dashboard project; deploy notifications on.
- Escalation rule: 2 consecutive failed `healthz` = investigate; any
  `RAIL_FAILED` row in `/v1/reconciliation` = investigate the rail.

## 3. Database Backups (Render free tier caveat)

Free Postgres expires after ~30 days and has no PITR. Two options:

```bash
# Manual backup (run anywhere with psql + DATABASE_URL):
pg_dump "$DATABASE_URL" --no-owner --format=custom -f payguard-$(date +%F).dump

# Restore drill (do it once a month so restores are never theory):
createdb payguard_restore_test && pg_restore -d payguard_restore_test payguard-YYYY-MM-DD.dump
psql payguard_restore_test -c "SELECT count(*) FROM ledger_entries;"   -- verify row count
```

For real money: move to a managed PG with PITR (Supabase/Neon free tiers or
Render paid) and test the restore, not the backup.

## 4. Deploy & Rollback

- **Deploy = merge to main.** CI gates: typecheck, 159+ tests (incl. Postgres
  service specs), 18 golden evals, web build. Never deploy past a red gate.
- **Rollback (Vercel):** Deployments -> pick last green -> "Promote to
  Production" (instant, no rebuild).
- **Rollback (Render):** Events tab -> the last good deploy -> "Rollback".
- Migrations are idempotent (`CREATE ... IF NOT EXISTS`) and run at every
  boot, so rollbacks are safe schema-wise. Never write destructive SQL
  without a backup from §3.

## 5. Incident Template

```
What:   <one line — user-visible symptom>
When:   <first seen (UTC)>
Impact: <money at risk? data? just UX?>
Status: investigating | identified | monitoring | resolved
Facts:  <curl outputs / log lines / reconciliation report — no theories>
Actions: <what was changed, by whom>
Follow-up: <test added? runbook updated? monitoring gap closed?>
```

Money-path triage order: `/v1/reconciliation` (ledger vs rail mismatch) ->
audit trail for the affected invoice -> Render logs for the decision id.

## 6. Known Roadmap Items (not yet done — track them)

- Load tests (k6) on `/v1/evaluate` + `/v1/execute`
- Chaos drill: kill Render mid-settle, prove idempotent replay (the code
  supports it; the drill needs a runbook entry + a recorded run)
- Live PayPal rails + real currency compliance review
- Per-user dashboard accounts (today: single admin password)
- Dependency vulnerability scan in CI (pnpm audit / osv-scanner step)

## 7. Known Limitations (accepted risks — review quarterly)

- **No rate limiter on `/api/login`:** the control is password entropy —
  keep `PAYGUARD_DASHBOARD_PASSWORD` at 96+ bits (`openssl rand -base64 12`
  or a 4-word passphrase). A serverless-per-instance limiter would be porous;
  move to a real WAF/rate-limit if the console ever faces the open internet
  beyond trusted users.
- **Keys without an explicit role default to `admin`:** always annotate
  `:proposer` / `:approver` when adding keys — the boot log prints the role
  distribution so silent admin creep is visible at a glance.
- **Session cookie comparison is not constant-time:** acceptable for a
  64-hex-char derived token; revisit only if the console leaves trusted hands.
- **Free-tier instance limits:** Render free spins down (~cold starts) and
  its Postgres expires in ~30 days — see §3 for backups or move to a managed
  PG before any money-like demo.
