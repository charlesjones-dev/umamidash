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
