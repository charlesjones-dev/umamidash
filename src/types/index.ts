export interface Website {
  id: string
  name: string
  domain?: string
}

/**
 * How the browser receives realtime data. The Node server streams SSE. The
 * Cloudflare Worker prefers WebSockets, because its Durable Object can
 * hibernate between polls while hibernatable WebSockets stay open. It also
 * answers SSE on the same path.
 */
export type RealtimeTransport = 'sse' | 'websocket'

export interface DashboardConfig {
  websites: Website[]
  columns: number
  rows: number
  pollInterval: number
  umamiUrl: string
  cartoApiKey: string | null
  realtimeTransport: RealtimeTransport
}

export interface ApiError {
  error: string
}

export interface GeoSessionsResponse {
  websiteId: string
  sessions: GeocodedSession[]
}

export interface CountryData {
  country: string
  visitors: number
}

export interface UrlData {
  url: string
  visitors: number
}

export interface SeriesPoint {
  x: string
  y: number
}

export interface RealtimeData {
  websiteId: string
  visitors: number
  countries: CountryData[]
  urls: UrlData[]
  series: SeriesPoint[]
}

export interface GeocodedSession {
  id: string
  country: string
  region: string
  city: string
  lat: number
  lng: number
  browser: string
  os: string
  device: string
  screen: string
  language: string
  firstAt: string
  lastAt: string
}
