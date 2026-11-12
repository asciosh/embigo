import { DurableObject } from 'cloudflare:workers'
import { CoopGame } from '../src/coop'
import { coopLevel, COOP_LEVEL_COUNT, type CoopLevel } from '../src/coop-levels'
import { budgetFor, canUndo, clearFloor, failFloor, newRun, pickRelic, rogueCoopLevel, skipFloor, useUndo, type RunState } from '../src/rogue'

// One Room = one co-op game between two friends. The room keeps the level and the list of
// moves, checks every move with the real game rules, and tells both players what happened.
// It uses WebSocket hibernation: while nobody moves, it costs nothing.

type Slot = { key: string; name: string }
type Stored = {
  slots: [Slot | null, Slot | null]
  level: number
  history: string
  run?: RunState | null // roguelike run: the room then plays endless generated floors
  ev?: { id: number; k: string } | null
}
type Attachment = { slot: 0 | 1 }

const SIGNALS = new Set(['hi', 'wait', 'go', 'oops', 'nice'])
const MAX_HISTORY = 500
const IDLE_MS = 6 * 60 * 60 * 1000 // an unused room disappears after 6 hours

export class Room extends DurableObject {
  private data: Stored = { slots: [null, null], level: 1, history: '' }

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never)
    void ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get<Stored>('data')
      if (saved) this.data = saved
    })
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname.endsWith('/exists')) {
      return Response.json({ players: this.data.slots.filter(Boolean).length })
    }
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 })
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    this.ctx.acceptWebSocket(server)
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string' || raw.length > 600) return
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(raw) as Record<string, unknown>
    } catch {
      return
    }
    if (msg.t === 'hb') return
    if (msg.t === 'join') return this.onJoin(ws, msg)

    const att = ws.deserializeAttachment() as Attachment | null
    if (!att) return this.fail(ws, 'Join the room first')
    const slot = att.slot

    if (msg.t === 'move') {
      const action = typeof msg.a === 'string' ? msg.a : ''
      if (!/^[UDLRP]$/.test(action)) return
      if (this.data.run && this.data.run.phase !== 'play') return this.fail(ws, this.data.run.phase === 'over' ? 'The run is over' : 'Pick a card first')
      const game = this.game()
      if (game.won) return this.fail(ws, 'This level is already solved')
      if (game.turn !== slot) return this.fail(ws, 'It is not your turn')
      if (this.data.history.length >= MAX_HISTORY) return this.fail(ws, 'Too many moves: restart the level')
      if (!game.move(action as 'U' | 'D' | 'L' | 'R' | 'P')) return this.fail(ws, 'That move does nothing')
      this.data.history += action
      const run = this.data.run
      if (run) {
        // roguelike: too many moves loses a heart; a solved floor within the budget gives a card
        if (game.moves > budgetFor(run, this.levelNow().par)) {
          const outcome = failFloor(run)
          this.data.history = ''
          this.note(outcome === 'over' ? 'over' : 'fail')
        } else if (game.won) {
          clearFloor(run)
          this.note('clear')
        }
      }
      await this.save()
      this.broadcast()
    } else if (msg.t === 'restart') {
      const run = this.data.run
      if (run) {
        if (run.phase !== 'play') return
        if (this.data.history.length > 0) {
          const outcome = failFloor(run) // restarting by hand costs a heart
          this.note(outcome === 'over' ? 'over' : 'fail')
        }
      }
      this.data.history = ''
      await this.save()
      this.broadcast()
    } else if (msg.t === 'pick') {
      const run = this.data.run
      const i = typeof msg.i === 'number' ? msg.i : -1
      if (!run || !pickRelic(run, i)) return
      this.data.history = ''
      this.note('pick')
      await this.save()
      this.broadcast()
    } else if (msg.t === 'undo') {
      const run = this.data.run
      if (!run || !canUndo(run) || this.data.history.length === 0) return
      this.data.history = this.data.history.slice(0, -1)
      useUndo(run)
      this.note('undo')
      await this.save()
      this.broadcast()
    } else if (msg.t === 'skip') {
      const run = this.data.run
      if (!run || !skipFloor(run)) return
      this.data.history = ''
      this.note('skip')
      await this.save()
      this.broadcast()
    } else if (msg.t === 'newrun') {
      if (!this.data.run || this.data.run.phase !== 'over') return
      this.data.run = newRun(Math.floor(Math.random() * 1e9) + 1, true)
      this.data.history = ''
      this.note('newrun')
      await this.save()
      this.broadcast()
    } else if (msg.t === 'next') {
      if (this.data.run) return
      if (!this.game().won) return
      this.data.level = (this.data.level % COOP_LEVEL_COUNT) + 1
      this.data.history = ''
      await this.save()
      this.broadcast()
    } else if (msg.t === 'signal') {
      const k = typeof msg.k === 'string' ? msg.k : ''
      if (!SIGNALS.has(k)) return
      const text = JSON.stringify({ t: 'signal', from: slot, name: this.data.slots[slot]?.name ?? 'Player', k })
      for (const other of this.ctx.getWebSockets()) {
        const a = other.deserializeAttachment() as Attachment | null
        if (a && a.slot !== slot && other.readyState === WebSocket.READY_STATE_OPEN) other.send(text)
      }
    }
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 ? 1000 : code, 'bye')
    } catch {
      // already closed
    }
    this.broadcast()
  }

  async webSocketError(): Promise<void> {
    this.broadcast()
  }

  async alarm(): Promise<void> {
    if (this.ctx.getWebSockets().length === 0) {
      await this.ctx.storage.deleteAll()
      this.data = { slots: [null, null], level: 1, history: '', run: null, ev: null }
    } else {
      await this.ctx.storage.setAlarm(Date.now() + IDLE_MS)
    }
  }

  // ---------- helpers ----------

  private async onJoin(ws: WebSocket, msg: Record<string, unknown>): Promise<void> {
    const key = typeof msg.key === 'string' ? msg.key : ''
    if (!/^[0-9a-f]{16,32}$/.test(key)) return this.fail(ws, 'Invalid player key')
    const name =
      (typeof msg.name === 'string' ? msg.name : '')
        .replace(/[^A-Za-z0-9_ -]/g, '')
        .trim()
        .slice(0, 16) || 'Player'

    const empty = !this.data.slots[0] && !this.data.slots[1]
    let slot: 0 | 1 | -1 = this.data.slots[0]?.key === key ? 0 : this.data.slots[1]?.key === key ? 1 : -1
    if (slot === -1) {
      if (!this.data.slots[0]) slot = 0
      else if (!this.data.slots[1]) slot = 1
    }
    if (slot === -1) return this.fail(ws, 'This room is full')

    if (empty && typeof msg.level === 'number' && Number.isInteger(msg.level) && msg.level >= 1 && msg.level <= COOP_LEVEL_COUNT) {
      this.data.level = msg.level
    }
    if (empty && typeof msg.rogue === 'number' && Number.isInteger(msg.rogue) && msg.rogue > 0 && msg.rogue < 2 ** 31) {
      this.data.run = newRun(msg.rogue, true)
      this.data.history = ''
    }
    this.data.slots[slot] = { key, name }
    ws.serializeAttachment({ slot } satisfies Attachment)
    await this.save()
    this.broadcast()
  }

  private levelNow(): CoopLevel {
    return this.data.run ? rogueCoopLevel(this.data.run) : coopLevel(this.data.level)
  }

  private note(k: string): void {
    this.data.ev = { id: (this.data.ev?.id ?? 0) + 1, k }
  }

  private game(): CoopGame {
    const level = this.levelNow()
    const game = new CoopGame(level.rows, level.roster)
    if (!game.replay(this.data.history)) {
      this.data.history = '' // corrupted history: start the level again
      return new CoopGame(level.rows, level.roster)
    }
    return game
  }

  private async save(): Promise<void> {
    await this.ctx.storage.put('data', this.data)
    await this.ctx.storage.setAlarm(Date.now() + IDLE_MS)
  }

  private fail(ws: WebSocket, error: string): void {
    ws.send(JSON.stringify({ t: 'error', error }))
  }

  // Tell every connected player the full state of the room
  private broadcast(): void {
    const sockets = this.ctx.getWebSockets().filter((s) => s.readyState === WebSocket.READY_STATE_OPEN)
    const online: [boolean, boolean] = [false, false]
    for (const ws of sockets) {
      const att = ws.deserializeAttachment() as Attachment | null
      if (att) online[att.slot] = true
    }
    const players = this.data.slots.map((s, i) => (s ? { name: s.name, online: online[i] } : null))
    for (const ws of sockets) {
      const att = ws.deserializeAttachment() as Attachment | null
      if (!att) continue
      ws.send(JSON.stringify({ t: 'state', level: this.data.level, history: this.data.history, you: att.slot, players, run: this.data.run ?? null, ev: this.data.ev ?? null }))
    }
  }
}
