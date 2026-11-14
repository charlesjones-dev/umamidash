# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm install                  # Install dependencies
pnpm dev                      # Start Express + Vite dev servers (requires Doppler)
pnpm dev:server               # Start Express API server only (port 3000)
pnpm dev:client               # Start Vite dev server only (port 5173)
pnpm dev:worker               # Build the SPA and run the Worker with wrangler dev (port 8787)
pnpm build                    # Build Vue SPA for production
pnpm start                    # Start production server (serves built SPA)
pnpm deploy:worker            # Build the SPA and deploy the Worker (top-level config)
pnpm stub:umami               # Stand-in Umami API on port 3999, for local runs of either server
pnpm typecheck                # vue-tsc for the app, tsc for core/, server.js and worker/
pnpm test                     # vitest: core/ in Node, worker/ in workerd
pnpm setup:doppler            # Configure Doppler service token interactively
pnpm dlx shadcn-vue@latest add <name>  # Add a shadcn-vue component
```

`dev`, `dev:client` and `dev:server` use `doppler run --` to inject secrets. `dev:worker` reads `.dev.vars` or `.env` (wrangler). Alternatively, copy `.env.example` to `.env` for local development without Doppler.

pnpm 11 (pinned via `packageManager`) reads only auth/registry settings from `.npmrc`; all pnpm settings live in `pnpm-workspace.yaml`. It enforces a 3-day `minimumReleaseAge` (newer package versions are refused, and a frozen install fails if the lockfile contains one) and `frozenLockfile`. For an urgent fix younger than 3 days, add that package to `minimumReleaseAgeExclude` instead of lowering the age.

## Architecture

Realtime analytics dashboard for self-hosted Umami instances. A Vue 3 SPA and a server that polls Umami and pushes updates to every browser. The server exists in two forms over one shared module:

**Shared Umami module (`core/`)** - Runtime-neutral TypeScript that both servers import. Node runs it directly (type stripping, Node 22.18 or newer), so only erasable syntax is allowed (`erasableSyntaxOnly`), and imports use `.ts` extensions. Each server injects its own transport for Umami (`UmamiTransport`), clock and storage (`KeyValueStore`, `GeocodeCache`).
- `core/umami-client.ts` - `UmamiClient`: login (single-flight), token refresh at 23 h, GETs with one re-login on 401 and up to 3 waits on 429. Every request takes from an optional `CallBudget`.
- `core/realtime.ts` - Active count, realtime summary (top 5 countries and URLs by unique session, last 5 minutes), 24-hour hourly series. The parsing is pure and tested.
- `core/poller.ts` - `RealtimePoller.tick()`: a login tick on its own when the token is missing or old; otherwise realtime data for every due site (each poll interval), then due series (every 5 min), oldest first, up to `maxCallsPerTick`. Work that didn't fit stays due and the next tick comes after 1 s. Keeps per-site data in the store, so a snapshot survives hibernation. Returns the snapshot, whether it changed, and the delay to the next tick.
- `core/geocode.ts` - Nominatim structured queries, 1 request a second across all callers (a queue), a cache that stores "not found" only when every query was answered, and an optional per-request budget.
- `core/config.ts` - Parses and checks the environment variables both servers share, and builds the `/api/config` body.
- `core/runtime.ts` - `Clock`, `KeyValueStore`, `CallBudget`, small helpers.

**Cloudflare Worker (`worker/`, `wrangler.jsonc`)** - The recommended deploy. Static assets serve `dist/` (`run_worker_first: ["/api/*"]`, SPA fallback). `worker/index.ts` answers `/api/*` and hands the stream and the map sessions to one Durable Object, `RealtimeHub` (`worker/hub.ts`, SQLite-backed so it runs on the Workers Free plan, name `global`). The hub polls on an alarm while a browser is connected and stops when none is. **At most 25 calls to Umami per alarm** (`MAX_UMAMI_CALLS_PER_INVOCATION`; Cloudflare allows 32 service-binding calls per invocation). Browsers connect with hibernatable WebSockets (`ctx.acceptWebSocket`), so between alarms the hub is idle and not billed for duration. It also answers SSE on the same path, for browsers that still run an older build (an open SSE stream keeps the hub active). The hub stores the Umami token and the poller state in `ctx.storage.kv` and the geocoding cache in SQLite table `geocode`. Never add `setTimeout`/`setInterval` to the hub: a pending timer stops hibernation. It reaches Umami through the service binding `UMAMI` when bound (URL `https://<UMAMI_PUBLIC_URL host>/api/...`), else `fetch(UMAMI_API_ENDPOINT)`. `worker/access.ts` checks the Cloudflare Access JWT (`jose`) when `ACCESS_AUD` and `ACCESS_TEAM_DOMAIN` are set, and accepts `CF-Connecting-IP` in `HOME_IPS`; `/api/health` is always open.

**Node.js server (`server.js`)** - The self-hosted alternative, unchanged for its users: same variables, endpoints and `pnpm start`. A thin Express layer over `core/` with no call cap: a `setTimeout` loop runs `poller.tick()` while at least one SSE client is connected. Logs in eagerly at startup (best effort) after binding the port. Serves `dist/` when `NODE_ENV=production`. Plain JS with JSDoc types, checked by `tsconfig.server.json`.

**Vue 3 SPA (`src/`)** - Reads `/api/config`, then connects to `/api/realtime/stream` over the transport the config names (`realtimeTransport`: `sse` for Node, `websocket` for the Worker). Displays a configurable grid of cards, each showing live visitor count, top countries, top URLs, and a 24h sparkline bar chart.

### Data Flow

```
Browser ←SSE→ Express (:3000) →polls→ Umami API
Browser ←WebSocket (or SSE)→ Worker → RealtimeHub (alarm) →polls→ Umami API (service binding or fetch)
```

In development, Vite (:5173) proxies `/api/*` (WebSockets too) to Express (:3000) via `vite.config.ts`. In production (`NODE_ENV=production`), Express serves the built SPA from `dist/`. `wrangler dev` serves the built SPA and the Worker together on :8787.

### Key Server Endpoints

Both servers answer the same endpoints with the same shapes (types in `src/types/index.ts`, stream constants in `src/lib/realtime-protocol.ts`).

- `GET /api/config` - Returns website list, grid dimensions, poll interval, Umami URL, CARTO API key, and `realtimeTransport`
- `GET /api/realtime/stream` - SSE stream (both servers), or a WebSocket upgrade (Worker). Messages are a JSON array of `RealtimeData`, or the text `heartbeat` (SSE: a `: heartbeat` comment) when a poll found nothing new
- `GET /api/websites/:websiteId/sessions/geo?window=N` - On-demand geocoded sessions for the map modal. Window values: 5, 30, 360, 720, 1440, 10080 (minutes). The Worker caps one request at 20 Nominatim requests; places left over are looked up on the next request.
- `GET /api/health` - Health check. The Worker answers 503 when its settings are invalid; Node exits at startup instead.

### Client Structure

- `src/main.ts` - App bootstrap; mounts Vue app directly (no router)
- `src/composables/useRealtimeStream.ts` - Takes the config ref and connects once it loads, with EventSource (SSE) or WebSocket (reconnects with backoff up to 30 s, and treats three silent poll intervals as a dead socket). Parses messages into reactive Maps keyed by website ID. Exports a module-level `connectionStatus` ref (`'connected' | 'reconnecting' | 'disconnected'`) used by the header status dot
- `src/lib/realtime-protocol.ts` - Stream path and heartbeat text, shared by the SPA and both servers
- `src/composables/useTheme.ts` - Unified dark mode + theme color composable; applies CSS custom properties as inline styles on `documentElement`, persists to localStorage (`umamidash-dark-mode`, `umamidash-theme`)
- `src/lib/themes.ts` - Theme definitions array; 4 base gray themes (Neutral, Zinc, Slate, Stone) override all CSS vars, 7 accent themes (Red, Rose, Orange, Green, Blue, Violet, Yellow) override primary/chart/sidebar-primary vars only
- `src/components/ActiveVisitorCard.vue` - Per-website card with visitor count, countries, URLs, sparkline. Countries list is clickable (opens session map modal at 5-min window); when no visitors, a globe icon opens it at 30-min window. Mobile-responsive: smaller title/count, URL list limited to top 2 with max-width constraint.
- `src/components/SessionMapModal.vue` - Full-screen dialog with Leaflet map showing geocoded session pins. Time window toggles (5m, 30m, 6h, 12h, 24h, 7d). Dark/light tile switching (OpenStreetMap / CARTO dark_all; CARTO needs the `cartoApiKey` prop, else dark mode falls back to OpenStreetMap). Themed circle markers using `--primary` CSS var. Auto-zoom `fitBounds` with `maxZoom: 5` (country level). Popup shows location, browser/OS, device/screen, language, last active time.
- `src/components/SparklineBackground.vue` - SVG bar chart rendered as card background with hover tooltips
- `src/components/ThemeDropdown.vue` - Header dropdown for selecting theme color
- `src/components/DarkModeToggle.vue` - Header button toggling light/dark mode
- `src/types/index.ts` - Shared TypeScript interfaces (Website, DashboardConfig, RealtimeData, GeocodedSession, etc.)

### UI

Uses **shadcn-vue** (new-york style, neutral base color) with Tailwind CSS v4 and `lucide-vue-next` icons. Components live in `src/components/ui/` and are added via the shadcn-vue CLI. The `@` alias maps to `src/`.

### Theming

Theme switching works by setting CSS custom properties as inline styles on `<html>`, which override the `:root` / `.dark` defaults in `index.css`. When the "Neutral" theme is selected, all inline overrides are cleared and the stylesheet defaults take effect. A blocking `<script>` in `index.html` reads the dark mode preference from localStorage before paint to prevent FOUC.

## Deployment

**Cloudflare Worker (recommended):** `pnpm deploy:worker` (build, then `wrangler deploy --env=""`). Settings are Worker secrets (`wrangler secret bulk`), never vars in `wrangler.jsonc`: a var and a secret with the same name conflict, and `keep_vars: true` keeps dashboard-set variables. Routes and custom domains stay out of `wrangler.jsonc`. Environments don't inherit bindings or vars and rename the Worker unless `name` is set, so the `service-binding` environment (for an Umami Worker named `umami`, `wrangler deploy --env service-binding`) repeats its `name`, `durable_objects` and adds the `UMAMI` service binding, with `workers_dev: false`. Keep the repo host-neutral: it is public, so no deploy-specific names, hostnames or IDs. A change to the Durable Object class needs a new entry in `migrations`.

**Node server:** Build: `pnpm install --frozen-lockfile && pnpm build`. Start: `node server.js`. Health check: `/api/health`. No built-in auth; access control is handled externally (e.g., Cloudflare Zero Trust).

The Node.js version is pinned to an exact release in `.nvmrc`, the only Node version source. Build tools such as Workers Builds, Railpack and mise read it, and they also read `.node-version`, `mise.toml` and `.tool-versions`, so don't add any of those for Node: one could win over `.nvmrc`. Bump the pin for each Node.js security release. Workers Builds installs Node through node-build, so before bumping, check that `https://raw.githubusercontent.com/nodenv/node-build/master/share/node-build/<version>` answers 200, or every build fails. `package.json` `engines` says Node 22.18 or newer, the first release that runs `core/*.ts` without a flag.

## Testing

`pnpm test` runs two vitest projects (`vitest.config.ts`): `core` in Node (with `TZ=UTC`), and `worker` in workerd through `@cloudflare/vitest-plugin` with the real `wrangler.jsonc`. In the worker project the `UMAMI` service binding is the stub in `test/stub-umami.ts`, which records every call. The hub's alarms run in real time there; the test reads each alarm's call count from its `tick calls=N` log line. The worker project serves `dist/`, so run `pnpm build` first. For a manual run of either server, start `pnpm stub:umami` and point the server at it.

## Development Principles

Follow SOLID, DRY, KISS, and YAGNI in all code changes:

### SOLID

- **Single Responsibility**: Each composable, component, or server route handler does one thing. Don't bolt unrelated logic together.
- **Open/Closed**: Extend behavior through new composables, components, or route handlers, not by modifying stable existing ones.
- **Interface Segregation**: Prefer small, focused TypeScript interfaces over large monolithic ones. Keep `src/types/index.ts` types narrow and purpose-built.
- **Dependency Inversion**: Depend on TypeScript interfaces from `src/types/`, not concrete implementations. Components consume data via props and composables, not direct API calls.

### DRY / Code Reuse

- Never duplicate logic, types, or constants across client and server or between components.
- Extract shared utilities into `src/lib/`. Import, don't copy.
- Shared TypeScript interfaces live in `src/types/index.ts`. If a type is used by more than one component or composable, it belongs there.

### KISS / Simplicity

- Choose the simplest correct solution. Avoid abstractions, patterns, or indirection that don't solve a current problem.
- Prefer simple types over complex generics unless the generic provides real reuse.
- Three similar lines of code is better than a premature abstraction.

### YAGNI / Scope Discipline

- Do not build features, utilities, or infrastructure for hypothetical future needs.
- Only implement what is explicitly requested. Recommending additional features is fine, but always ask before implementing them.

### Modularity

- Keep the Express server (`server.js`) and the Vue SPA (`src/`) loosely coupled. They communicate only through the defined API endpoints and SSE stream.
- New features that touch both server and client should define their API contract (request/response shapes) in `src/types/index.ts` first, then implement on each side.
- Structure code so new components or server endpoints can be added without modifying existing ones.

### Component Architecture

- Components must not import from sibling components. Extract shared functionality into composables (`src/composables/`) or standalone modules (`src/lib/`).
- Use Vue composables for cross-component reactive state and shared logic. Use `@vueuse/core` utilities before writing custom composables that duplicate their functionality.
- UI components are leaf nodes in the dependency graph. They consume data via props and emit events; they do not orchestrate other components.
- shadcn-vue components in `src/components/ui/` are managed by the CLI. Do not manually edit them.

### Type Safety

- Maintain `strict: true` in tsconfig. Never weaken strict checks to fix type errors.
- Never use `any`. Use `unknown` with type guards, proper generics, or discriminated unions instead.
- Define API request/response types in `src/types/index.ts` so client composables and server endpoints share the same contract.

### Error Handling

- Never use empty catch blocks. At minimum, log the error with context.
- Always handle promise rejections. Unhandled rejections crash Node.js processes.
- Fail fast on invalid state. Don't let corrupt data propagate silently through the SSE stream.
- Server endpoints should return structured error responses with consistent shape.

### Testing Philosophy

- Test behavior, not implementation. Tests should survive refactoring if behavior doesn't change.
- Prefer integration tests that exercise real code paths over unit tests with heavy mocking.
- Every bug fix should include a regression test.

### Git

- Never commit or push without explicit user consent. Do not commit, amend, or push to any branch unless the user directly asks.
- Before every commit, review README.md and CLAUDE.md to ensure they reflect any changes made in the current session. Check for: new components, changed architecture, new endpoints, new composables, new scripts, changed configuration. Update documentation as needed before committing.
