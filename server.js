import express from 'express'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const app = express()
const PORT = process.env.PORT || 3000
const UMAMI_API_ENDPOINT = process.env.UMAMI_API_ENDPOINT
const UMAMI_USERNAME = process.env.UMAMI_USERNAME
const UMAMI_PASSWORD = process.env.UMAMI_PASSWORD
const GRID_COLUMNS = parseInt(process.env.GRID_COLUMNS || '3', 10)
const GRID_ROWS = parseInt(process.env.GRID_ROWS || '2', 10)
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '5000', 10)

let UMAMI_WEBSITES = []
try {
  UMAMI_WEBSITES = JSON.parse(process.env.UMAMI_WEBSITES || '[]')
} catch {
  console.error('UMAMI_WEBSITES is not valid JSON. Expected: [{"id":"uuid","name":"Display Name"}]')
  process.exit(1)
}

if (!UMAMI_API_ENDPOINT || !UMAMI_USERNAME || !UMAMI_PASSWORD) {
  console.error('Missing required environment variables: UMAMI_API_ENDPOINT, UMAMI_USERNAME, UMAMI_PASSWORD')
  process.exit(1)
}

let umamiToken = null
let tokenTimestamp = 0
const TOKEN_REFRESH_MS = 23 * 60 * 60 * 1000 // 23 hours

async function login() {
  const res = await fetch(`${UMAMI_API_ENDPOINT}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: UMAMI_USERNAME, password: UMAMI_PASSWORD }),
  })
  if (!res.ok) throw new Error(`Umami login failed: ${res.status}`)
  const data = await res.json()
  umamiToken = data.token
  tokenTimestamp = Date.now()
}

async function ensureToken() {
  if (!umamiToken || Date.now() - tokenTimestamp > TOKEN_REFRESH_MS) {
    await login()
  }
}

async function umamiGet(path) {
  await ensureToken()
  const res = await fetch(`${UMAMI_API_ENDPOINT}${path}`, {
    headers: { Authorization: `Bearer ${umamiToken}` },
  })
  if (res.status === 401) {
    await login()
    const retry = await fetch(`${UMAMI_API_ENDPOINT}${path}`, {
      headers: { Authorization: `Bearer ${umamiToken}` },
    })
    if (!retry.ok) throw new Error(`Umami fetch failed: ${retry.status}`)
    return retry.json()
  }
  if (!res.ok) throw new Error(`Umami fetch failed: ${res.status}`)
  return res.json()
}

async function fetchActiveVisitors(websiteId) {
  const data = await umamiGet(`/api/websites/${websiteId}/active`)
  return data.x ?? 0
}

async function fetchRealtime(websiteId) {
  const data = await umamiGet(`/api/realtime/${websiteId}`)
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000)

  // Filter pageviews to last 5 minutes to match the active visitor window
  const recentPageviews = (data.pageviews ?? []).filter(
    (pv) => new Date(pv.createdAt) >= fiveMinAgo
  )

  // Aggregate countries from recent pageviews (unique sessions per country)
  const countrySessions = {}
  for (const pv of recentPageviews) {
    if (pv.country) {
      if (!countrySessions[pv.country]) countrySessions[pv.country] = new Set()
      countrySessions[pv.country].add(pv.sessionId ?? pv.id)
    }
  }
  const countries = Object.entries(countrySessions)
    .map(([country, sessions]) => ({ country, visitors: sessions.size }))
    .sort((a, b) => b.visitors - a.visitors)
    .slice(0, 5)

  // Aggregate URLs from recent pageviews
  const urlSessions = {}
  for (const pv of recentPageviews) {
    if (pv.urlPath) {
      if (!urlSessions[pv.urlPath]) urlSessions[pv.urlPath] = new Set()
      urlSessions[pv.urlPath].add(pv.sessionId ?? pv.id)
    }
  }
  const urls = Object.entries(urlSessions)
    .map(([url, sessions]) => ({ url, visitors: sessions.size }))
    .sort((a, b) => b.visitors - a.visitors)
    .slice(0, 5)

  return { countries, urls }
}

async function fetchPageviewSeries(websiteId) {
  const now = Date.now()
  const startAt = now - 24 * 60 * 60 * 1000
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const params = new URLSearchParams({
    startAt: String(startAt),
    endAt: String(now),
    unit: 'hour',
    timezone: tz,
  })
  const data = await umamiGet(`/api/websites/${websiteId}/pageviews?${params}`)

  // API returns local-tz timestamps like "2026-02-18 20:00:00"; backfill full 24h
  const sparse = new Map()
  for (const p of data.sessions ?? []) {
    sparse.set(p.x, p.y)
  }
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  })
  const series = []
  for (let i = 23; i >= 0; i--) {
    const t = new Date(now - i * 60 * 60 * 1000)
    const parts = fmt.formatToParts(t)
    const g = (type) => parts.find((p) => p.type === type).value
    const key = `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:00:00`
    series.push({ x: key, y: sparse.get(key) ?? 0 })
  }
  return series
}

// SSE
const clients = new Set()

function broadcast(data) {
  const payload = `data: ${JSON.stringify(data)}\n\n`
  for (const res of clients) {
    res.write(payload)
  }
}

let pollInterval = null

function startPolling() {
  if (pollInterval) return

  async function poll() {
    if (clients.size === 0) return
    try {
      const results = await Promise.all(
        UMAMI_WEBSITES.map(async (site) => {
          const [visitors, { countries, urls }, series] = await Promise.all([
            fetchActiveVisitors(site.id),
            fetchRealtime(site.id),
            fetchPageviewSeries(site.id),
          ])
          return { websiteId: site.id, visitors, countries, urls, series }
        })
      )
      broadcast(results)
    } catch (err) {
      console.error('Poll error:', err.message)
    }
  }

  poll()
  pollInterval = setInterval(poll, POLL_INTERVAL_MS)
}

// Heartbeat every 30s
setInterval(() => {
  for (const res of clients) {
    res.write(': heartbeat\n\n')
  }
}, 30000)

// Routes
app.get('/api/health', (_req, res) => {
  res.json({ status: 'OK' })
})

app.get('/api/config', (_req, res) => {
  res.json({
    websites: UMAMI_WEBSITES,
    columns: GRID_COLUMNS,
    rows: GRID_ROWS,
    pollInterval: POLL_INTERVAL_MS,
    umamiUrl: UMAMI_API_ENDPOINT,
  })
})

app.get('/api/realtime/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  res.write('\n')

  clients.add(res)
  startPolling()

  req.on('close', () => {
    clients.delete(res)
    if (clients.size === 0 && pollInterval) {
      clearInterval(pollInterval)
      pollInterval = null
    }
  })
})

// SPA serving in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(resolve(__dirname, 'dist')))
  app.get('*', (_req, res) => {
    res.sendFile(resolve(__dirname, 'dist', 'index.html'))
  })
}

// Startup
async function start() {
  try {
    await login()
  } catch (err) {
    console.error('Failed to authenticate with Umami:', err.message)
    console.error('Server will start but SSE data will not be available until Umami is reachable.')
  }

  app.listen(PORT, () => {
    console.log(`UmamiDash server running on port ${PORT}`)
  })
}

start()
