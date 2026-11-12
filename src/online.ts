// Client side of the co-op rooms: talks to the Room (Durable Object) through a WebSocket.

import type { RunState } from './rogue'

export type RoomPlayer = { name: string; online: boolean } | null
export type RoomEvent = { id: number; k: string }
export type RoomState = {
  level: number
  history: string
  you: 0 | 1
  players: [RoomPlayer, RoomPlayer]
  run?: RunState | null // roguelike run (hearts, relics, floor) when the room plays the roguelike mode
  ev?: RoomEvent | null // the last thing that happened in the run: fail, clear, pick, undo, skip, over
}
export type SignalKey = 'hi' | 'wait' | 'go' | 'oops' | 'nice'
export type ConnectionStatus = 'connecting' | 'online' | 'offline'

export const isRoomCode = (s: string) => /^[BCDFGHJKLMNPQRSTVWXZ]{5}$/.test(s)

export async function createRoom(): Promise<string> {
  const res = await fetch('/api/coop/create', { method: 'POST' })
  const data = (await res.json()) as { code?: string; error?: string }
  if (!res.ok || !data.code) throw new Error(data.error ?? 'Could not create the room')
  return data.code
}

// How many players are already in a room (0 = the room does not exist)
export async function roomPlayers(code: string): Promise<number> {
  const res = await fetch(`/api/coop/room?code=${code}`)
  if (!res.ok) throw new Error('Invalid room code')
  return ((await res.json()) as { players: number }).players
}

// Identifies this browser inside a room, so a reload gives you your seat back
function playerKey(code: string): string {
  const storeKey = `embigo-room-${code}`
  try {
    const saved = localStorage.getItem(storeKey)
    if (saved && /^[0-9a-f]{20}$/.test(saved)) return saved
    const fresh = [...crypto.getRandomValues(new Uint8Array(10))].map((b) => b.toString(16).padStart(2, '0')).join('')
    localStorage.setItem(storeKey, fresh)
    return fresh
  } catch {
    return [...crypto.getRandomValues(new Uint8Array(10))].map((b) => b.toString(16).padStart(2, '0')).join('')
  }
}

export type RoomHandlers = {
  onState: (state: RoomState) => void
  onSignal: (from: 0 | 1, name: string, key: SignalKey) => void
  onError: (message: string) => void
  onStatus: (status: ConnectionStatus) => void
}

export class RoomClient {
  readonly code: string
  private name: string
  private level: number
  private rogueSeed: number | null
  private handlers: RoomHandlers
  private ws: WebSocket | null = null
  private closed = false
  private retries = 0
  private heartbeat = 0
  private retryTimer = 0

  constructor(code: string, name: string, level: number, handlers: RoomHandlers, rogueSeed: number | null = null) {
    this.rogueSeed = rogueSeed
    this.code = code
    this.name = name
    this.level = level
    this.handlers = handlers
  }

  connect(): void {
    this.closed = false
    this.open()
  }

  private open(): void {
    this.handlers.onStatus('connecting')
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${scheme}://${window.location.host}/api/coop/ws?code=${this.code}`)
    this.ws = ws

    ws.onopen = () => {
      this.retries = 0
      ws.send(JSON.stringify({ t: 'join', name: this.name, key: playerKey(this.code), level: this.level, ...(this.rogueSeed ? { rogue: this.rogueSeed } : {}) }))
      this.handlers.onStatus('online')
      window.clearInterval(this.heartbeat)
      this.heartbeat = window.setInterval(() => this.send({ t: 'hb' }), 30000)
    }

    ws.onmessage = (event) => {
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(String(event.data)) as Record<string, unknown>
      } catch {
        return
      }
      if (msg.t === 'state') this.handlers.onState(msg as unknown as RoomState)
      else if (msg.t === 'signal') this.handlers.onSignal(msg.from as 0 | 1, String(msg.name), msg.k as SignalKey)
      else if (msg.t === 'error') this.handlers.onError(String(msg.error))
    }

    ws.onclose = () => {
      window.clearInterval(this.heartbeat)
      if (this.closed) return
      this.handlers.onStatus('offline')
      // reconnect with a growing delay: 0.7s, 1.4s, 2.8s ... at most 8s
      const delay = Math.min(8000, 700 * 2 ** this.retries++)
      this.retryTimer = window.setTimeout(() => {
        if (!this.closed) this.open()
      }, delay)
    }
  }

  send(msg: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg))
  }

  close(): void {
    this.closed = true
    window.clearInterval(this.heartbeat)
    window.clearTimeout(this.retryTimer)
    this.ws?.close()
  }
}
