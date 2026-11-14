import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'
import { createStubUmami, stubWebsites } from './test/stub-umami.ts'

// The stub runs in Node. The Worker under test reaches it through the UMAMI
// service binding, and the tests read its call log through the same binding.
const stub = createStubUmami()

async function umamiBinding(request: Request): Promise<Response> {
  const url = new URL(request.url)
  if (url.pathname === '/__stub/calls') return Response.json(stub.calls)
  if (url.pathname === '/__stub/reset') {
    stub.reset()
    return new Response(null, { status: 204 })
  }
  return stub.handle(request)
}

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'core',
          include: ['test/core/**/*.test.ts'],
          environment: 'node',
          env: { TZ: 'UTC' },
        },
      },
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: './wrangler.jsonc' },
            miniflare: {
              bindings: {
                UMAMI_PUBLIC_URL: 'https://analytics.example.test',
                UMAMI_USERNAME: 'stub-user',
                UMAMI_PASSWORD: 'stub-pass',
                UMAMI_WEBSITES: JSON.stringify(stubWebsites(11)),
                POLL_INTERVAL_MS: '15000',
              },
              serviceBindings: { UMAMI: umamiBinding },
            },
          }),
        ],
        test: {
          name: 'worker',
          include: ['test/worker/**/*.test.ts'],
        },
      },
    ],
  },
})
