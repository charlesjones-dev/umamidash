export interface Website {
  id: string
  name: string
}

export interface DashboardConfig {
  websites: Website[]
  columns: number
  rows: number
  pollInterval: number
  umamiUrl: string
}

export interface RealtimeData {
  websiteId: string
  visitors: number
}
