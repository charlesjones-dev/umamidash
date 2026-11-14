// UmamiDash on Node.js: Express serves the API and the built SPA, and streams
// realtime data over SSE. The Umami logic lives in core/, which the
// Cloudflare Worker (worker/) shares. Node 22.18 or newer runs the .ts
// imports directly (type stripping), so there is no build step.
import express from 'express'
import compression from 'compression'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dashboardConfig, isConfiguredWebsite, parseSettings } from './core/config.ts'
import { fetchGeocodedSessions, Geocoder, memoryGeocodeCache, parseWindowMinutes } from './core/geocode.ts'
import { RealtimePoller } from './core/poller.ts'
import { errorMessage, memoryStore, systemClock, UNLIMITED } from './core/runtime.ts'
import { UmamiClient } from './core/umami-client.ts'
import { REALTIME_STREAM_PATH } from './src/lib/realtime-protocol.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT || 3000
const SSE_HEARTBEAT_MS = 30_000

const parsed = parseSettings(process.env)
if (!parsed.ok) {
  for (const error of parsed.errors) console.error(error)
  process.exit(1)
}
for (const warning of parsed.warnings) console.warn(warning)
const settings = parsed.settings
const endpoint = /** @type {string} */ (settings.umamiApiEndpoint)

const store = memoryStore()
const client = new UmamiClient({
  transport: (path, init) => fetch(`${endpoint}${path}`, init),
  username: settings.username,
  password: settings.password,
  store,
  clock: systemClock,
})
const poller = new RealtimePoller({
  client,
  websites: settings.websites,
  pollIntervalMs: settings.pollIntervalMs,
  maxCallsPerTick: UNLIMITED,
  store,
  clock: systemClock,
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
})
const geocoder = new Geocoder({ cache: memoryGeocodeCache(), clock: systemClock })

// SSE clients, and the poll loop that runs while at least one is connected
/** @type {Set<import('express').Response>} */
const clients = new Set()
/** @type {ReturnType<typeof setTimeout> | null} */
let pollTimer = null
let polling = false

/** @param {import('./src/types/index.ts').RealtimeData[]} snapshot */
function payloadOf(snapshot) {
  return snapshot.length > 0 ? `data: ${JSON.stringify(snapshot)}\n\n` : ''
}

async function poll() {
  pollTimer = null
  if (clients.size === 0 || polling) return
  polling = true
  let nextDelayMs = settings.pollIntervalMs
  try {
    const result = await poller.tick()
    if (result.errors.length > 0) {
      console.error(`Poll errors (${result.errors.length}): ${result.errors.join('; ')}`)
    }
    nextDelayMs = result.nextDelayMs
    if (result.changed) {
      const payload = payloadOf(result.snapshot)
      for (const res of clients) res.write(payload)
    }
  } catch (err) {
    console.error('Poll error:', errorMessage(err))
  } finally {
    polling = false
  }
  if (clients.size > 0) pollTimer = setTimeout(poll, nextDelayMs)
}

function startPolling() {
  if (pollTimer || polling) return
  pollTimer = setTimeout(poll, 0)
}

function stopPolling() {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = null
}

setInterval(() => {
  for (const res of clients) res.write(': heartbeat\n\n')
}, SSE_HEARTBEAT_MS)

const app = express()

app.use(compression({
  filter: (/** @type {import('express').Request} */ req) => req.path !== REALTIME_STREAM_PATH,
}))

app.get('/api/health', (_req, res) => {
  res.json({ status: 'OK' })
})

app.get('/api/config', (_req, res) => {
  res.json(dashboardConfig(settings, 'sse'))
})

app.get(REALTIME_STREAM_PATH, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  res.write('\n')

  // Send the last known data at once, so a refreshed page doesn't wait for the next poll
  const payload = payloadOf(poller.snapshot())
  if (payload) res.write(payload)

  clients.add(res)
  startPolling()

  req.on('close', () => {
    clients.delete(res)
    if (clients.size === 0) stopPolling()
  })
})

app.get('/api/websites/:websiteId/sessions/geo', async (req, res) => {
  const { websiteId } = req.params
  if (!isConfiguredWebsite(settings, websiteId)) {
    return res.status(404).json({ error: 'Website not found' })
  }
  const windowMinutes = parseWindowMinutes(typeof req.query.window === 'string' ? req.query.window : null)
  try {
    const sessions = await fetchGeocodedSessions(websiteId, windowMinutes, { client, geocoder, clock: systemClock })
    res.json({ websiteId, sessions })
  } catch (err) {
    console.error('Geo sessions error:', errorMessage(err))
    res.status(500).json({ error: 'Failed to fetch sessions' })
  }
})

// SPA serving in production
if (process.env.NODE_ENV === 'production') {
  app.use(
    express.static(resolve(__dirname, 'dist'), {
      setHeaders(res, filePath) {
        if (filePath.endsWith('.webmanifest')) {
          res.setHeader('Content-Type', 'application/manifest+json')
        }
      },
    })
  )
  app.get('*', (_req, res) => {
    res.sendFile(resolve(__dirname, 'dist', 'index.html'))
  })
}

// Bind the port first so the health check passes at once. Logging in before
// listening would block startup whenever Umami is slow or unreachable at boot
// (for example a private network still starting), which can exceed a deploy's
// health check timeout. The poller logs in on demand, so this eager login is
// best effort only.
app.listen(PORT, () => {
  console.log(`UmamiDash server running on port ${PORT}`)
})

client.login().catch((err) => {
  console.error('Failed to authenticate with Umami:', errorMessage(err))
  console.error('Server started; SSE data will be available once Umami is reachable.')
})
