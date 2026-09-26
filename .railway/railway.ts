// Railway Infrastructure as Code for the umamidash service.
//
// Replaces the deprecated Config as Code file (railway.toml), which Railway
// stops reading on 2026-12-01. See docs/railway-iac.md for the switchover
// runbook.
//
// This file does nothing on its own. Railway never reads .railway/ during a
// deploy; changes land only via `railway config plan` / `railway config apply`,
// and each apply targets only the CLI's linked environment.
//
// Hand-written on purpose. Do NOT regenerate it with `railway config migrate`:
// - migrate emits `builder` only as a comment, so it would not pin RAILPACK.
// - migrate (run unlinked) named the project "umamidash"; the live Railway
//   project is "Umami".
// - migrate is lossy for restart policy, region and replicas
//   (https://github.com/railwayapp/cli/issues/1199). None are set today, but a
//   future regenerate would silently drop them if they were.
// railway.toml has no comments to carry over. Restart policy, region and
// replicas are not set there either; they stay dashboard-managed
// (ON_FAILURE, 10 retries, us-east4, 1 replica at the time of migration).
import { defineRailway, project, service } from 'railway/iac'

// Named partial: this file owns only the resources it declares. Without it the
// file is whole-project, and an apply would DELETE everything missing from it
// (the umami, Postgres and Valkey services and their volumes).
export const partial = 'umamidash'

export default defineRailway(() => {
  const umamidash = service('umamidash', {
    build: {
      builder: 'RAILPACK',
      buildCommand: 'pnpm install --frozen-lockfile && pnpm build',
    },
    start: 'node server.js',
    healthcheck: '/api/health',
    healthcheckTimeout: 10,
  })

  return project('Umami', {
    resources: [umamidash],
  })
})
