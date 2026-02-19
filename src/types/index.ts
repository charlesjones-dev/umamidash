export interface Website {
  id: string
  name: string
  domain?: string
}

export interface DashboardConfig {
  websites: Website[]
  columns: number
  rows: number
  pollInterval: number
  umamiUrl: string
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
