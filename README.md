# UmamiDash

Realtime analytics dashboard for self-hosted [Umami](https://umami.is) instances. Built with Vue 3, shadcn-vue, and Express.

## Preview

```
┌─────────────────────────────────┐  ┌─────────────────────────────────┐
│ blog.example.com     US 5  UK 2 │  │ shop.example.com        DE 3   │
│  12                          12 │  │  8                           8  │
│                                 │  │                                 │
│              24                 │  │               7                 │
│         active visitors         │  │          active visitors        │
│                                 │  │                                 │
│  3 /how-to-deploy    ▁▂▅▇▃▂▁▄  │  │  2 /products       ▁▁▃▅▇▅▃▂▁  │
│  2 /getting-started  -24h    ⇗  │  │  1 /checkout       -24h     ⇗  │
├─────────────────────────────────┤  ├─────────────────────────────────┤
│ docs.example.com         CA 1   │  │ app.example.com    JP 4  BR 2  │
│  4                           4  │  │  16                         16  │
│                                 │  │                                 │
│               3                 │  │              12                 │
│          active visitors        │  │         active visitors         │
│                                 │  │                                 │
│  1 /api-reference    ▁▁▂▃▂▁▁▁  │  │  3 /dashboard      ▂▃▅▇▆▅▃▂▁  │
│  1 /quickstart       -24h    ⇗  │  │  2 /settings       -24h     ⇗  │
└─────────────────────────────────┘  └─────────────────────────────────┘
```

## How It Works

UmamiDash runs a lightweight Express server that authenticates with your Umami instance, polls active visitor counts and pageview history, and pushes updates to the browser via Server-Sent Events (SSE). The Vue frontend displays a grid of cards showing live visitor counts per website with 24-hour sparkline bar charts. Click on the countries list to open an interactive world map showing geocoded session pins.

```
Browser  ←—SSE—→  Express (:3000)  —polls→  Umami API
                                     ├── /api/websites/:id/active (active visitor count, 5-min window)
                                     ├── /api/realtime/:id (countries, URLs, filtered to 5-min window)
                                     ├── /api/websites/:id/pageviews (24h hourly sessions)
                                     └── /api/websites/:id/sessions/geo (on-demand geocoded sessions for map)
```

Each card displays:
- Live active visitor count (center)
- Top 5 countries with visitor counts (top-right, clickable to open session map)
- Top 5 active URLs (bottom-left)
- 24-hour sparkline bar chart background showing hourly session history with hover tooltips
- Link to the Umami realtime view (bottom-right)
- Globe icon (top-right, shown when no active visitors) to open the session map with a 30-minute window

**Session Map Modal** — clicking the countries list or globe icon opens a full-screen dialog with a Leaflet world map. Each active session is plotted as a pin geocoded to city level via Nominatim. Features:
- Time window toggles: 5m, 30m, 6h, 12h, 24h, 7d
- Auto-zoom to fit all pins at country level
- Dark/light map tiles (OpenStreetMap / CartoDB dark_all) matching the app theme
- Themed markers using the active color theme
- Popups with session details: location, browser/OS, device/screen, language, last active time

The header includes a connection status dot (green = connected, yellow = reconnecting, red = disconnected), a theme color picker (11 color themes sourced from shadcn/ui), and a dark mode toggle. Both theme and dark mode persist to localStorage.

## Prerequisites

- Node.js 20+
- pnpm
- [Doppler CLI](https://docs.doppler.com/docs/install-cli) (or use a local `.env` file)
- Self-hosted Umami instance (v2) - [deploy one on Railway](https://railway.com/deploy/umami-analytics)

## Quick Start

```bash
# Install dependencies
pnpm install

# Option A: Configure Doppler
pnpm setup:doppler

# Option B: Use a local .env file
cp .env.example .env
# Edit .env with your Umami credentials

# Start development (Express + Vite)
pnpm dev
```

Open `http://localhost:5173` in your browser.

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `UMAMI_API_ENDPOINT` | Umami instance URL | required |
| `UMAMI_USERNAME` | Umami login username | required |
| `UMAMI_PASSWORD` | Umami login password | required |
| `UMAMI_WEBSITES` | JSON array: `[{"id":"uuid","name":"Display Name"}]` | required |
| `GRID_COLUMNS` | Grid columns on Realtime page | `3` |
| `GRID_ROWS` | Grid rows on Realtime page | `2` |
| `POLL_INTERVAL_MS` | Umami poll interval (ms) | `5000` |
| `PORT` | Server port | `3000` |

Get your website IDs from Umami dashboard: Settings, then Websites.

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Start Express + Vite dev servers |
| `pnpm dev:server` | Start Express only |
| `pnpm dev:client` | Start Vite only |
| `pnpm build` | Build Vue SPA for production |
| `pnpm start` | Start production server |
| `pnpm setup:doppler` | Configure Doppler service token |

## Deployment

### Railway

1. Connect your repo to Railway
2. Add Doppler integration or set environment variables directly
3. Railway auto-detects `railway.toml` for build/deploy config

Set `NODE_ENV=production` so the Express server serves the built SPA.

Access control is intended to be handled externally (e.g., Cloudflare Zero Trust). There is no built-in authentication.

## Adding UI Components

This project uses [shadcn-vue](https://www.shadcn-vue.com). To add components:

```bash
pnpm dlx shadcn-vue@latest add <component-name>
```

## Contributing

Contributions are welcome. Please open an issue to discuss changes before submitting a PR.

## License

[MIT](LICENSE)
