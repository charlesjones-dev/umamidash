# Railway Infrastructure as Code

The `umamidash` service's build and deploy settings live in [`.railway/railway.ts`](../.railway/railway.ts), Railway's Infrastructure as Code (IaC) format. It replaced the deprecated Config as Code file (`railway.toml`), which Railway stops reading on 2026-12-01. Production was switched over on 2026-09-27 and `railway.toml` was deleted.

## How it works

- **The file does nothing until applied.** Railway never reads `.railway/` during a deploy. Changes land only through `railway config plan` / `railway config apply`, run from a checkout linked to the project (Node.js 22+, `pnpm install`, Railway CLI 5.42.1+). Nothing applies it automatically (no `railwayapp/config` GitHub Action is set up).
- **Apply per environment.** Each apply targets only the CLI's linked environment. The `Umami` project has one environment today (`production`). Every environment added later needs its own apply.
- **The named partial is mandatory.** `export const partial = 'umamidash'` makes the file own only `service.umamidash`. Without it the file is whole-project, and an apply deletes every resource missing from it: the `umami`, `Postgres` and `Valkey` services and the `postgres-volume` / `valkey-volume` volumes.
- **For the declared service, missing means delete.** An apply removes any source, group or variable of `umamidash` that the file doesn't declare. The file therefore declares the GitHub source, the `Umami` canvas group and every variable. Variables use `preserve()`, which keeps the value already set in Railway, so no secrets are in git. **Add any new Railway variable to the file before the next apply, or the apply deletes it.** (The custom domain is not declared, and the plan leaves it alone.)
- **Never regenerate the file with `railway config migrate`.** It is lossy ([railwayapp/cli#1199](https://github.com/railwayapp/cli/issues/1199)): it emits `builder` only as a comment, drops restart policy, region and replicas, and declares no source or variables, so its output would delete them. Never run `railway config migrate --apply` either: it also clears the service's Railway Config File path on the live project.

### What the file declares

| Setting | Value |
|---|---|
| `source` | GitHub `charlesjones-dev/umamidash`, branch `main`, check suites off |
| `groupId` | `Umami` (canvas group; the group itself is not owned by this file) |
| variables | 9, all `preserve()` |
| `build.builder` | `RAILPACK` |
| `build.buildCommand` | `pnpm install --frozen-lockfile && pnpm build` |
| `deploy.startCommand` | `node server.js` |
| `deploy.healthcheckPath` | `/api/health` |
| `deploy.healthcheckTimeout` | `10` |

Restart policy (`ON_FAILURE`, 10 retries), region and replicas are Railway defaults/dashboard settings and not declared.

### Editing the file

The CLI evaluates the file without typechecking it, and nothing in the repo's build covers `.railway/`, so a misspelled key (e.g. `healthcheckTimout`) is silently ignored. After every edit:

```bash
pnpm exec tsc --noEmit --strict --target es2022 --module nodenext --moduleResolution nodenext --skipLibCheck .railway/railway.ts
railway config plan --verbose   # must show 0 to destroy unless you mean it
railway config plan --out /tmp/plan.json && railway config apply --plan /tmp/plan.json
```

Applying a pinned plan (`--out` / `--plan`) applies exactly the change set you reviewed.

## Switching over another environment

Only needed if an environment is added that still has a Railway Config File path set.

1. `railway environment <env>` (staging/preview before production).
2. In the dashboard, clear **umamidash → Settings → Railway Config File**. Committing that change triggers a deploy, which is harmless while `railway.toml` settings and dashboard settings agree.
3. `railway config plan --verbose`. **Abort** on any deletion, or any change to source, domains, group or variables. Expect only settings that differ from the dashboard.
4. Apply the pinned plan (see above), then check `railway config plan` reports up to date and `railway config partials list` shows `umamidash` owning `service.umamidash`.
5. Confirm the triggered deploy goes healthy.

## Production switchover record (2026-09-27)

- Before: Config as Code overrode the dashboard. Only one dashboard value differed from `railway.toml`: `healthcheckTimeout` was unset (Railway default 300s) instead of 10.
- Clearing the Railway Config File path was not enough on its own. Railway still auto-detected `/railway.toml` at the repo root on the next deploy, and the dashboard kept showing "The value is set in /railway.toml". Deleting the file ended Config as Code for the service.
- The first live plan of the original file (which declared only the five `railway.toml` settings) would have deleted all 9 variables, disconnected the GitHub source and ungrouped the service. It was not applied. Declaring source, group and variables reduced it to one change.
- Applied plan: `healthcheckTimeout` null → 10. Nothing else changed.
