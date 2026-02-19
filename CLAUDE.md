# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm install                  # Install dependencies
pnpm dev                      # Start Express + Vite dev servers (requires Doppler)
pnpm dev:server               # Start Express API server only (port 3000)
pnpm dev:client               # Start Vite dev server only (port 5173)
pnpm build                    # Build Vue SPA for production
pnpm start                    # Start production server (serves built SPA)
pnpm setup:doppler            # Configure Doppler service token interactively
pnpm dlx shadcn-vue@latest add <name>  # Add a shadcn-vue component
```

All `dev` scripts use `doppler run --` to inject secrets. Alternatively, copy `.env.example` to `.env` for local development without Doppler.

## Architecture

Realtime analytics dashboard for self-hosted Umami instances. Two-process architecture:

**Express server (`server.js`)** - Authenticates with Umami API, polls active visitor counts (`/api/websites/:id/active`, 5-min window), realtime pageview data (`/api/realtime/:id`, filtered to 5-min window for countries/URLs), and 24h pageview history for each configured website, and pushes updates to all connected browsers via SSE. Manages Umami JWT token lifecycle (auto-refresh at 23h). No build step; plain JS, runs directly with Node.

**Vue 3 SPA (`src/`)** - Connects to `/api/realtime/stream` SSE endpoint. Displays a configurable grid of cards, each showing live visitor count, top countries, top URLs, and a 24h sparkline bar chart.

### Data Flow

```
Browser ←SSE→ Express (:3000) →polls→ Umami API
```

In development, Vite (:5173) proxies `/api/*` to Express (:3000) via `vite.config.ts`. In production (`NODE_ENV=production`), Express serves the built SPA from `dist/`.

### Key Server Endpoints

- `GET /api/config` - Returns website list, grid dimensions, poll interval, Umami URL
- `GET /api/realtime/stream` - SSE stream; broadcasts poll results to all connected clients
- `GET /api/health` - Health check for Railway deployment

### Client Structure

- `src/main.ts` - Router setup; single route `/realtime` (root redirects to it)
- `src/composables/useRealtimeStream.ts` - EventSource composable; parses SSE data into reactive Maps keyed by website ID
- `src/components/ActiveVisitorCard.vue` - Per-website card with visitor count, countries, URLs, sparkline
- `src/components/SparklineBackground.vue` - SVG bar chart rendered as card background with hover tooltips
- `src/types/index.ts` - Shared TypeScript interfaces (Website, DashboardConfig, RealtimeData, etc.)

### UI

Uses **shadcn-vue** (new-york style, neutral base color) with Tailwind CSS v4 and `lucide-vue-next` icons. Components live in `src/components/ui/` and are added via the shadcn-vue CLI. The `@` alias maps to `src/`.

## Deployment

Deployed to Railway via `railway.toml`. Build: `pnpm install --frozen-lockfile && pnpm build`. Start: `node server.js`. No built-in auth; access control is handled externally (e.g., Cloudflare Zero Trust).
