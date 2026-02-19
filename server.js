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

async function fetchActiveVisitors(websiteId) {
  await ensureToken()
  const res = await fetch(`${UMAMI_API_ENDPOINT}/api/websites/${websiteId}/active`, {
    headers: { Authorization: `Bearer ${umamiToken}` },
  })
  if (res.status === 401) {
    await login()
    const retry = await fetch(`${UMAMI_API_ENDPOINT}/api/websites/${websiteId}/active`, {
      headers: { Authorization: `Bearer ${umamiToken}` },
    })
    if (!retry.ok) throw new Error(`Umami fetch failed: ${retry.status}`)
    return retry.json()
  }
  if (!res.ok) throw new Error(`Umami fetch failed: ${res.status}`)
  return res.json()
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

function parseActiveVisitors(data) {
  if (typeof data === 'number') return data
  if (Array.isArray(data)) return data[0]?.visitors ?? data[0]?.x ?? 0
  if (data && typeof data === 'object') return data.visitors ?? data.x ?? 0
  return 0
}

function startPolling() {
  if (pollInterval) return

  async function poll() {
    if (clients.size === 0) return
    try {
      const results = await Promise.all(
        UMAMI_WEBSITES.map(async (site) => {
          const data = await fetchActiveVisitors(site.id)
          return { websiteId: site.id, visitors: parseActiveVisitors(data) }
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
