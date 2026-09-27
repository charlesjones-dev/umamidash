// Railway Infrastructure as Code for the umamidash service.
//
// This file does nothing on its own. Railway never reads .railway/ during a
// deploy; changes land only via `railway config plan` / `railway config apply`,
// and each apply targets only the CLI's linked environment. See
// docs/railway-iac.md.
//
// Hand-written on purpose. Do NOT regenerate it with `railway config migrate`:
// it drops builder, restart policy, region and replicas
// (https://github.com/railwayapp/cli/issues/1199), and it declares no source
// or variables, which an apply treats as deletions.
//
// Typecheck after editing (the SDK silently ignores unknown keys); the command
// is in docs/railway-iac.md.
import { defineRailway, github, preserve, project, service } from 'railway/iac'

// Named partial: this file owns only the resources it declares. Without it the
// file is whole-project, and an apply would DELETE everything missing from it
// (the umami, Postgres and Valkey services and their volumes).
export const partial = 'umamidash'

export default defineRailway(() => {
  const umamidash = service('umamidash', {
    // For a declared service, a missing source, group or variable is planned
    // as a removal, not left alone. Declare the existing ones.
    source: github('charlesjones-dev/umamidash', { branch: 'main', checkSuites: false }),
    groupId: 'Umami',
    // preserve() keeps the value already set in Railway, so no secrets live
    // here. Add any new Railway variable to this list before the next apply,
    // or the apply deletes it.
    env: {
      GRID_COLUMNS: preserve(),
      GRID_ROWS: preserve(),
      POLL_INTERVAL_MS: preserve(),
      PORT: preserve(),
      UMAMI_API_ENDPOINT: preserve(),
      UMAMI_PASSWORD: preserve(),
      UMAMI_PUBLIC_URL: preserve(),
      UMAMI_USERNAME: preserve(),
      UMAMI_WEBSITES: preserve(),
    },
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
