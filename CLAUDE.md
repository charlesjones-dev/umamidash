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

**Express server (`server.js`)** - Authenticates with Umami API via `UMAMI_API_ENDPOINT` (can be an internal network URL), polls active visitor counts (`/api/websites/:id/active`, 5-min window), realtime pageview data (`/api/realtime/:id`, filtered to 5-min window for countries/URLs), and 24h pageview history for each configured website, and pushes updates to all connected browsers via SSE. The `/api/config` endpoint returns `UMAMI_PUBLIC_URL` (falls back to `UMAMI_API_ENDPOINT`) so browser links point to the public Umami instance. Also serves an on-demand geocoded sessions endpoint (`/api/websites/:id/sessions/geo`) that fetches sessions from Umami and geocodes them via Nominatim (structured queries, 1 req/sec rate limit, in-memory cache). Manages Umami JWT token lifecycle (auto-refresh at 23h). No build step; plain JS, runs directly with Node.

**Vue 3 SPA (`src/`)** - Connects to `/api/realtime/stream` SSE endpoint. Displays a configurable grid of cards, each showing live visitor count, top countries, top URLs, and a 24h sparkline bar chart.

### Data Flow

```
Browser ←SSE→ Express (:3000) →polls→ Umami API
```

In development, Vite (:5173) proxies `/api/*` to Express (:3000) via `vite.config.ts`. In production (`NODE_ENV=production`), Express serves the built SPA from `dist/`.

### Key Server Endpoints

- `GET /api/config` - Returns website list, grid dimensions, poll interval, Umami URL
- `GET /api/realtime/stream` - SSE stream; broadcasts poll results to all connected clients
- `GET /api/websites/:websiteId/sessions/geo?window=N` - On-demand geocoded sessions for the map modal. Window values: 5, 30, 360, 720, 1440, 10080 (minutes). Uses Nominatim structured queries with in-memory geocode cache (persists for server lifetime). Rate-limited to 1 req/sec per Nominatim policy.
- `GET /api/health` - Health check for Railway deployment

### Client Structure

- `src/main.ts` - App bootstrap; mounts Vue app directly (no router)
- `src/composables/useRealtimeStream.ts` - EventSource composable; parses SSE data into reactive Maps keyed by website ID. Exports a module-level `connectionStatus` ref (`'connected' | 'reconnecting' | 'disconnected'`) used by the header status dot
- `src/composables/useTheme.ts` - Unified dark mode + theme color composable; applies CSS custom properties as inline styles on `documentElement`, persists to localStorage (`umamidash-dark-mode`, `umamidash-theme`)
- `src/lib/themes.ts` - Theme definitions array; 4 base gray themes (Neutral, Zinc, Slate, Stone) override all CSS vars, 7 accent themes (Red, Rose, Orange, Green, Blue, Violet, Yellow) override primary/chart/sidebar-primary vars only
- `src/components/ActiveVisitorCard.vue` - Per-website card with visitor count, countries, URLs, sparkline. Countries list is clickable (opens session map modal at 5-min window); when no visitors, a globe icon opens it at 30-min window. Mobile-responsive: smaller title/count, URL list limited to top 2 with max-width constraint.
- `src/components/SessionMapModal.vue` - Full-screen dialog with Leaflet map showing geocoded session pins. Time window toggles (5m, 30m, 6h, 12h, 24h, 7d). Dark/light tile switching (OpenStreetMap / CartoDB dark_all). Themed circle markers using `--primary` CSS var. Auto-zoom `fitBounds` with `maxZoom: 5` (country level). Popup shows location, browser/OS, device/screen, language, last active time.
- `src/components/SparklineBackground.vue` - SVG bar chart rendered as card background with hover tooltips
- `src/components/ThemeDropdown.vue` - Header dropdown for selecting theme color
- `src/components/DarkModeToggle.vue` - Header button toggling light/dark mode
- `src/types/index.ts` - Shared TypeScript interfaces (Website, DashboardConfig, RealtimeData, GeocodedSession, etc.)

### UI

Uses **shadcn-vue** (new-york style, neutral base color) with Tailwind CSS v4 and `lucide-vue-next` icons. Components live in `src/components/ui/` and are added via the shadcn-vue CLI. The `@` alias maps to `src/`.

### Theming

Theme switching works by setting CSS custom properties as inline styles on `<html>`, which override the `:root` / `.dark` defaults in `index.css`. When the "Neutral" theme is selected, all inline overrides are cleared and the stylesheet defaults take effect. A blocking `<script>` in `index.html` reads the dark mode preference from localStorage before paint to prevent FOUC.

## Deployment

Deployed to Railway via `railway.toml`. Build: `pnpm install --frozen-lockfile && pnpm build`. Start: `node server.js`. No built-in auth; access control is handled externally (e.g., Cloudflare Zero Trust).
