/**
 * The realtime stream sends either a JSON array of RealtimeData or this text.
 * Servers send it when a poll found nothing new, so idle connections stay open
 * and the browser can tell a quiet stream from a dead one.
 */
export const REALTIME_HEARTBEAT = 'heartbeat'

export const REALTIME_STREAM_PATH = '/api/realtime/stream'
