# Railway Infrastructure as Code

Railway stops reading Config as Code files (`railway.toml` / `railway.json`) on **2026-12-01**. The `umamidash` service's build and deploy settings now also live in [`.railway/railway.ts`](../.railway/railway.ts), Railway's Infrastructure as Code (IaC) format. `railway.toml` stays in the repo and remains what production reads until the switchover below is done.

## How it works

- **The file does nothing until applied.** Railway never reads `.railway/` during a deploy. Changes land only through `railway config plan` / `railway config apply`, run from a checkout linked to the project. Nothing applies it automatically (no `railwayapp/config` GitHub Action is set up).
- **Apply per environment.** Each apply targets only the CLI's linked environment. The `Umami` project has one environment today (`production`). Every environment added later needs its own apply.
- **The named partial is mandatory.** `export const partial = 'umamidash'` makes the file own only `service.umamidash`. Without it the file is whole-project, and an apply deletes every resource missing from it: the `umami`, `Postgres` and `Valkey` services and the `postgres-volume` / `valkey-volume` volumes.
- **Never regenerate the file with `railway config migrate`.** It is lossy ([railwayapp/cli#1199](https://github.com/railwayapp/cli/issues/1199)): it emits `builder` only as a comment, drops restart policy, region and replicas, and (run unlinked) named the project `umamidash` instead of `Umami`. Never run `railway config migrate --apply` either: it also clears the service's Railway Config File path on the live project.

### What the file declares

Exactly the five settings from `railway.toml`, verified field by field against the file and against what the live deployment read from it:

| Setting | Value |
|---|---|
| `build.builder` | `RAILPACK` |
| `build.buildCommand` | `pnpm install --frozen-lockfile && pnpm build` |
| `deploy.startCommand` | `node server.js` |
| `deploy.healthcheckPath` | `/api/health` |
| `deploy.healthcheckTimeout` | `10` |

Deliberately not declared: `source` (GitHub `charlesjones-dev/umamidash`, branch `main`), the custom domain, variables, the `Umami` canvas group, restart policy, region and replicas. None of these are in `railway.toml` today. Undeclared settings are expected to stay as they are in the dashboard; step 3 of the runbook is where that gets confirmed against the live plan.

### Editing the file

The CLI evaluates the file without typechecking it, and nothing in the repo's build covers `.railway/`, so a misspelled key (e.g. `healthcheckTimout`) is silently ignored. Typecheck after every edit:

```bash
pnpm exec tsc --noEmit --strict --target es2022 --module nodenext --moduleResolution nodenext --skipLibCheck .railway/railway.ts
```

Then run `railway config plan` and `railway config apply` in each environment.

## Dashboard fallback (snapshot 2026-09-26)

Config as Code overrides the dashboard but never writes back to it. When the config file stops being read, the service falls back to its dashboard values. For `umamidash` in `production`:

| Setting | `railway.toml` (effective today) | Dashboard fallback | Drift |
|---|---|---|---|
| builder | `RAILPACK` | `RAILPACK` | none |
| buildCommand | `pnpm install --frozen-lockfile && pnpm build` | same | none |
| startCommand | `node server.js` | same | none |
| healthcheckPath | `/api/health` | `/api/health` | none |
| healthcheckTimeout | `10` | unset (Railway default 300s) | **yes** |
| restartPolicyType / MaxRetries | not set | `ON_FAILURE` / `10` | n/a |
| watchPatterns, rootDirectory, preDeploy, cron | not set | unset | n/a |
| region / replicas | not set | `us-east4` × 1 | n/a |

The `umami`, `Postgres` and `Valkey` services have no config file and aren't affected.

Only the healthcheck timeout would change if the file stopped being read without an apply.

## Switchover runbook

Run once per environment, staging/preview first if one exists (today there is only `production`). Needs Railway CLI 5.42.1 or newer and `pnpm install` run at the repo root (the file imports the `railway` package).

1. Link the environment: `railway link` and pick project `Umami` and the environment (or `railway environment <env>` if already linked).
2. In the dashboard, open **umamidash → Settings** and clear the **Railway Config File** path (`/railway.toml`). In the same change, set **Healthcheck Timeout** to `10` if the field is now editable, so the dashboard fallback matches `railway.toml` exactly. If the dashboard stages the change and you have to deploy to commit it, that deploy then runs with identical settings.
3. Run `railway config plan --verbose`. **Abort** on any deletion, or any change to source, domains or variables. Expected: only `service.umamidash` changes, and only `healthcheckTimeout` → `10` (the one drifted field), or no setting changes at all if you set the timeout in step 2. The first apply also records ownership for partial `umamidash`. Also stop and review if the plan moves `umamidash` out of the `Umami` canvas group.
4. Run `railway config apply`.
5. Verify:
   - `railway config plan` reports the configuration is up to date.
   - `railway config partials list` shows `umamidash` owning `service.umamidash`.
   - The next deployment goes healthy. If the apply didn't start one, redeploy once from the dashboard.
   - The deployment details show builder, build command, start command, healthcheck path and timeout as above, with no config-file icon, and the restart policy is still `ON_FAILURE` / 10.

**No deploy may run between steps 2 and 4** (other than one needed to commit step 2's staged change): don't push to `main` in that window. A deploy there uses the dashboard fallback, which today differs only in the healthcheck timeout (300s instead of 10s) unless you fixed it in step 2.

**If step 3 still says `umamidash is already managed by /railway.toml`** after clearing the path, Railway is picking up the root file on its own. Abort, restore the path to `/railway.toml`, and do the switchover together with the follow-up PR that deletes `railway.toml`.

**Rollback before step 4:** set the Railway Config File path back to `/railway.toml`. Nothing else has changed.

**After step 4** the applied values are ordinary service settings that match `railway.toml`, so there is normally nothing to roll back: fix a bad value in the file and re-apply, or edit it in the dashboard. Going back to Config as Code would mean releasing ownership first (`railway config partials release umamidash --dry-run`, then without `--dry-run`) and then restoring the path. Railway may refuse to re-enable Config as Code for the service, and it stops working on 2026-12-01 anyway.

## After every environment is switched

Open a follow-up PR that deletes `railway.toml` and updates this doc, README.md and CLAUDE.md. Until then, keep `railway.toml` and `.railway/railway.ts` in sync.
