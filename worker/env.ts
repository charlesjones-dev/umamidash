import type { RealtimeHub } from './hub.ts'

/** Bindings, vars and secrets of the umamidash Worker (see wrangler.jsonc and README). */
export interface Env {
  ASSETS: Fetcher
  HUB: DurableObjectNamespace<RealtimeHub>
  /** Service binding to the Worker in front of Umami. When set, it wins over UMAMI_API_ENDPOINT. */
  UMAMI?: Fetcher

  UMAMI_API_ENDPOINT?: string
  UMAMI_PUBLIC_URL?: string
  UMAMI_USERNAME?: string
  UMAMI_PASSWORD?: string
  UMAMI_WEBSITES?: string
  GRID_COLUMNS?: string
  GRID_ROWS?: string
  POLL_INTERVAL_MS?: string
  CARTO_API_KEY?: string

  /** Cloudflare Access application audience (AUD) tag. With ACCESS_TEAM_DOMAIN, turns the check on. */
  ACCESS_AUD?: string
  /** Access team domain, such as `example.cloudflareaccess.com`. */
  ACCESS_TEAM_DOMAIN?: string
  /** Comma-separated IPs that an Access bypass policy lets through without a JWT. */
  HOME_IPS?: string
}
