import type { Env as WorkerEnv } from '../../worker/env.ts'

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {}
    interface GlobalProps {
      mainModule: typeof import('../../worker/index.ts')
      durableNamespaces: 'RealtimeHub'
    }
  }
}
