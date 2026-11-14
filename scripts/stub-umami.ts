// Runs the stub Umami on a local port, to try either server without a real
// Umami. Prints the env values to point umamidash at it.
//
//   node scripts/stub-umami.ts [--port 3999] [--sites 11] [--latency 0]
import { createServer } from 'node:http'
import { parseArgs } from 'node:util'
import { createStubUmami, stubWebsites } from '../test/stub-umami.ts'

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '3999' },
    sites: { type: 'string', default: '11' },
    latency: { type: 'string', default: '0' },
  },
})
const port = Number(values.port)
const stub = createStubUmami({ latencyMs: Number(values.latency) })
let lastLoggedSecond = 0
let callsThisSecond = 0

const server = createServer(async (req, res) => {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined
  const headers = new Headers()
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(name, value)
  }
  const request = new Request(`http://localhost:${port}${req.url ?? '/'}`, {
    method: req.method,
    headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
  })
  const response = await stub.handle(request)
  res.writeHead(response.status, Object.fromEntries(response.headers))
  res.end(Buffer.from(await response.arrayBuffer()))

  const second = Math.floor(Date.now() / 1000)
  if (second !== lastLoggedSecond) {
    if (callsThisSecond > 0) console.log(`${new Date(lastLoggedSecond * 1000).toISOString()} calls=${callsThisSecond}`)
    lastLoggedSecond = second
    callsThisSecond = 0
  }
  callsThisSecond++
})

server.listen(port, '127.0.0.1', () => {
  console.log(`Stub Umami on http://127.0.0.1:${port}`)
  console.log(`UMAMI_API_ENDPOINT=http://127.0.0.1:${port}`)
  console.log('UMAMI_USERNAME=stub-user')
  console.log('UMAMI_PASSWORD=stub-pass')
  console.log(`UMAMI_WEBSITES=${JSON.stringify(stubWebsites(Number(values.sites)))}`)
})
