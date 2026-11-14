# UmamiDash

Realtime analytics dashboard for self-hosted [Umami](https://umami.is) instances. Built with Vue 3 and shadcn-vue. Runs as a Cloudflare Worker (recommended, the Workers Free plan is enough) or as a Node.js server.

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

The server logs in to your Umami instance, polls the active visitor counts, realtime pageviews and 24-hour history of each website, and pushes every change to the browser. The Vue frontend shows a grid of cards with live visitor counts per website and 24-hour sparkline bar charts. Click the countries list to open a world map of geocoded sessions.

```
Browser  ←—WebSocket or SSE—→  Server  —polls→  Umami API
                                 ├── /api/websites/:id/active (active visitor count, 5-min window)
                                 ├── /api/realtime/:id (countries, URLs, filtered to 5-min window)
                                 ├── /api/websites/:id/pageviews (24h hourly sessions)
                                 └── /api/websites/:id/sessions (on demand, geocoded for the map)
```

The server comes in two forms that share one Umami client (`core/`):

- **Cloudflare Worker** (`worker/`): static assets serve the app, and one Durable Object polls Umami on an alarm while at least one browser is connected. Browsers connect over WebSockets that hibernate between polls, so the Durable Object is billed only while a poll runs. It also answers SSE.
- **Node.js server** (`server.js`): Express serves the app and the API, and streams to the browser over SSE.

Each card displays:
- Live active visitor count (center)
- Top 5 countries with visitor counts (top-right, clickable to open session map)
- Top 5 active URLs (bottom-left)
- 24-hour sparkline bar chart background showing hourly session history with hover tooltips
- Link to the Umami realtime view (bottom-right)
- Globe icon (top-right, shown when no active visitors) to open the session map with a 30-minute window

**Session Map Modal**: clicking the countries list or globe icon opens a full-screen dialog with a Leaflet world map. Each active session is plotted as a pin geocoded to city level via Nominatim (at most 1 request a second, results cached). Features:
- Time window toggles: 5m, 30m, 6h, 12h, 24h, 7d
- Auto-zoom to fit all pins at country level
- Dark/light map tiles (OpenStreetMap / CARTO dark_all) matching the app theme; dark tiles need `CARTO_API_KEY`
- Themed markers using the active color theme
- Popups with session details: location, browser/OS, device/screen, language, last active time

The header includes a connection status dot (green = connected, yellow = reconnecting, red = disconnected), a theme color picker (11 color themes sourced from shadcn/ui), and a dark mode toggle. Both theme and dark mode persist to localStorage.

## Prerequisites

- Node.js 22.18 or newer (`.nvmrc` pins the exact release; `nvm install` picks it up)
- pnpm (the version is pinned in `package.json`; `corepack enable` picks it up)
- A self-hosted Umami instance (v2 or v3, tested against v3.2), see [Umami's install guide](https://umami.is/docs/install). Use a dedicated Umami user that can only view the websites.
- For the Worker: a Cloudflare account. The Workers Free plan is enough.

## Deploy to Cloudflare Workers (recommended)

The Worker needs no server of your own. On the Workers Free plan it fits well inside the daily limits: one Durable Object serves every browser, and it hibernates between polls.

1. Install and sign in:

   ```bash
   pnpm install
   pnpm wrangler login
   ```

2. Deploy. This builds the app and deploys the Worker `umamidash` with its Durable Object:

   ```bash
   pnpm deploy:worker
   ```

   The `pnpm` scripts deploy the top-level config (`--env=""`). The environment `service-binding` in `wrangler.jsonc` is for an Umami that runs as a Worker (see "Reaching Umami from the Worker").

3. Set the settings as secrets. Put them in a JSON file outside the repo, then upload them in one step:

   ```json
   {
     "UMAMI_API_ENDPOINT": "https://analytics.example.com",
     "UMAMI_USERNAME": "dashboard",
     "UMAMI_PASSWORD": "…",
     "UMAMI_WEBSITES": "[{\"id\":\"website-uuid\",\"name\":\"Example\"}]"
   }
   ```

   ```bash
   pnpm wrangler secret bulk ~/umamidash-secrets.json --env=""
   ```

   Add any optional variable from the table below the same way. Until the required ones are set, `GET /api/health` answers 503.

4. Protect the dashboard. The app has no login of its own, so put [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/self-hosted-public-app/) in front of it:
   - For the workers.dev address: Workers & Pages → `umamidash` → Settings → Domains & Routes → workers.dev → Enable Cloudflare Access.
   - For your own host name: add a route or custom domain in the dashboard, and a self-hosted Access application for that host name.

   Then let the Worker check the Access token too, by setting the secrets `ACCESS_AUD` (the application's Audience (AUD) tag) and `ACCESS_TEAM_DOMAIN` (such as `yourteam.cloudflareaccess.com`). If an Access policy bypasses Access for some IP addresses, list them in `HOME_IPS`, because a bypassed request carries no token. `GET /api/health` stays open for uptime monitors.

5. Optional: deploy on every push with [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/). Connect the repository in the Worker's Settings → Builds, with build command `pnpm build` and deploy command `npx wrangler deploy --env=""`.

Routes and custom domains stay out of `wrangler.jsonc`, so a deploy never changes them. If you serve the dashboard only from your own host name, set `"workers_dev": false` in `wrangler.jsonc`.

### Reaching Umami from the Worker

The Worker calls `UMAMI_API_ENDPOINT` with `fetch`, so Umami must be reachable from Cloudflare's network, including its login endpoint `/api/auth/login`. A firewall rule that allows the login only from your own IP blocks the Worker.

If Umami runs as a Worker in the same Cloudflare account, use a [service binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/) named `UMAMI` instead. A Worker's `fetch` to a host on its own zone goes to the origin, not to that host's Worker, so a binding is the way to reach it. The environment `service-binding` in `wrangler.jsonc` does this for a Worker named `umami` (change `service` if yours has another name), with workers.dev off. Deploy it with `pnpm build && pnpm wrangler deploy --env service-binding`, and pass `--env service-binding` to `wrangler secret bulk` too. With the binding, `UMAMI_API_ENDPOINT` is not needed, and the Worker calls `https://<UMAMI_PUBLIC_URL host>/api/...` through it.

### How the Worker polls

- One Durable Object, `RealtimeHub`, serves every browser. It polls only while a browser is connected, and stops when the last one leaves.
- It logs in on an alarm of its own, then fetches the active count and realtime data of every site each poll interval, and the 24-hour series every 5 minutes. One alarm makes at most 25 calls to Umami, because a Worker may make 32 calls to a service binding per invocation. Work that doesn't fit runs on the next alarm, 1 second later. With 11 websites, the first poll makes 25 calls and the next one 8, then each poll makes 22.
- It keeps the Umami token, the latest data and the geocoding cache in its SQLite storage, so they survive hibernation. One map request makes at most 20 Nominatim requests; the places left over are looked up on the next request.
- Each poll writes one row to storage. At the default 5-second interval that is about 17,000 rows a day, well inside the Free plan's 100,000.

## Run on Node.js

The Express server is the other way to run UmamiDash, on any host that runs Node.js.

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

To deploy it:

- Build: `pnpm install --frozen-lockfile && pnpm build`
- Start: `node server.js`, with `NODE_ENV=production` so the server also serves the built app
- Health check: `GET /api/health`

Set the environment variables below on the host, or inject them with Doppler. There is no built-in authentication, so put access control in front of it (for example Cloudflare Access).

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `UMAMI_API_ENDPOINT` | Umami API URL for server-side polling | required (a Worker with the `UMAMI` binding can leave it out) |
| `UMAMI_PUBLIC_URL` | Public-facing Umami URL for browser links | defaults to `UMAMI_API_ENDPOINT` |
| `UMAMI_USERNAME` | Umami login username | required |
| `UMAMI_PASSWORD` | Umami login password | required |
| `UMAMI_WEBSITES` | JSON array: `[{"id":"uuid","name":"Display Name"}]` | required |
| `GRID_COLUMNS` | Grid columns on Realtime page | `3` |
| `GRID_ROWS` | Grid rows on Realtime page | `2` |
| `POLL_INTERVAL_MS` | Umami poll interval (ms), at least 1000 | `5000` |
| `CARTO_API_KEY` | [CARTO basemap key](https://carto.com/basemaps/apikey) for the dark session map tiles | unset: OpenStreetMap tiles in dark mode |
| `PORT` | Node server port | `3000` |
| `ACCESS_AUD` | Worker only: Cloudflare Access application AUD tag. With `ACCESS_TEAM_DOMAIN`, turns the token check on | unset: no check |
| `ACCESS_TEAM_DOMAIN` | Worker only: Access team domain, such as `yourteam.cloudflareaccess.com` | unset: no check |
| `HOME_IPS` | Worker only: comma-separated IPs that an Access bypass policy lets through without a token | unset |

Get your website IDs from Umami dashboard: Settings, then Websites.

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Start Express + Vite dev servers |
| `pnpm dev:server` | Start Express only |
| `pnpm dev:client` | Start Vite only |
| `pnpm dev:worker` | Build the app and run the Worker locally with `wrangler dev` (reads `.dev.vars` or `.env`) |
| `pnpm build` | Build the Vue app for production |
| `pnpm start` | Start the Node server |
| `pnpm deploy:worker` | Build the app and deploy the Worker |
| `pnpm stub:umami` | Run a stand-in Umami API on port 3999 for local tries, and print the variables that point to it |
| `pnpm typecheck` | Type-check the app, `core/`, `server.js` and the Worker |
| `pnpm test` | Run the tests: `core/` in Node, the Worker and its Durable Object in workerd |
| `pnpm setup:doppler` | Configure Doppler service token |

## Adding UI Components

This project uses [shadcn-vue](https://www.shadcn-vue.com). To add components:

```bash
pnpm dlx shadcn-vue@latest add <component-name>
```

## Contributing

Contributions are welcome. Please open an issue to discuss changes before submitting a PR.

## License

[MIT](LICENSE)

## Disclaimer

This is an unofficial, community-built project and is not affiliated with, endorsed by, or associated with Umami Software, Inc. "Umami" is a trademark of Umami Software, Inc. This project interacts with the Umami API but does not include any Umami source code.
