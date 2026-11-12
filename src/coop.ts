import type { Creature } from './generator'
import type { Dir, Pos } from './game'

// Co-op rules: two creatures on the same map, taking turns. Pure logic (no drawing, no network),
// shared by the browser and the server.
//
// Tiles: '#' rock, '.' ice, 'B' bush, 'L' lake, 'P' plate, 'D' gate,
//        'E' start of player 1, 'F' start of player 2, 'G' goal of player 1, 'H' goal of player 2
//  - the other creature is an obstacle: you can use your partner to stop at the right tile
//  - bushes burnt by Embi stay burnt for both
//  - gates are open while any creature is standing on a plate (checked when a move starts)
//  - a turn is one action: a slide or "P" (pass). Turns strictly alternate.
//  - the level is solved when both creatures stand on their own goal

export type CoopAction = Dir | 'P'

export type CoopResult = {
  player: 0 | 1
  action: CoopAction
  from: Pos
  to: Pos
  burned: Pos | null
  jumped: Pos | null
  won: boolean
}

const DELTA: Record<Dir, [number, number]> = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] }

export class CoopGame {
  readonly level: string[]
  readonly roster: [Creature, Creature]
  readonly cols: number
  readonly rows: number
  readonly starts: [Pos, Pos]
  readonly goals: [Pos, Pos]
  pos: [Pos, Pos]
  turn: 0 | 1 = 0 // whose turn it is
  moves = 0 // team moves (every action counts, passes too)
  won = false
  history: CoopAction[] = []
  private burnt = new Set<string>()

  constructor(level: string[], roster: [Creature, Creature]) {
    this.level = level
    this.roster = roster
    this.rows = level.length
    this.cols = level[0].length
    this.starts = [this.find('E'), this.find('F')]
    this.goals = [this.find('G'), this.find('H')]
    this.pos = [{ ...this.starts[0] }, { ...this.starts[1] }]
  }

  private find(symbol: string): Pos {
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) if (this.level[y][x] === symbol) return { x, y }
    }
    throw new Error(`Tile ${symbol} not found`)
  }

  tile(x: number, y: number): string {
    return this.level[y]?.[x] ?? '#'
  }

  isBush(x: number, y: number): boolean {
    return this.tile(x, y) === 'B' && !this.burnt.has(`${x},${y}`)
  }

  wasBurnt(x: number, y: number): boolean {
    return this.burnt.has(`${x},${y}`)
  }

  // Gates are open while any creature stands on a plate
  gatesOpen(): boolean {
    return this.tile(this.pos[0].x, this.pos[0].y) === 'P' || this.tile(this.pos[1].x, this.pos[1].y) === 'P'
  }

  private blocked(player: 0 | 1, x: number, y: number, open: boolean): boolean {
    const t = this.tile(x, y)
    if (t === '#') return true
    if (t === 'L') return this.roster[player] !== 'water'
    if (t === 'D') return !open
    if (t === 'B' && this.isBush(x, y)) return true
    const other = this.pos[1 - player]
    return other.x === x && other.y === y
  }

  // Play the action of the player whose turn it is. Returns null if the action is not allowed
  // (a slide that goes nowhere).
  move(action: CoopAction): CoopResult | null {
    if (this.won) return null
    const player = this.turn
    const from = { ...this.pos[player] }
    let to = from
    let burned: Pos | null = null
    let jumped: Pos | null = null

    if (action !== 'P') {
      const [dx, dy] = DELTA[action]
      const open = this.gatesOpen()
      const own = this.goals[player]
      const canJump = this.roster[player] === 'air'
      let x = from.x
      let y = from.y
      for (;;) {
        const nx = x + dx
        const ny = y + dy
        if (!this.blocked(player, nx, ny, open)) {
          x = nx
          y = ny
          if (x === own.x && y === own.y) break
          continue
        }
        if (canJump && jumped === null) {
          const lx = nx + dx
          const ly = ny + dy
          if (!this.blocked(player, lx, ly, open)) {
            jumped = { x: nx, y: ny }
            x = lx
            y = ly
            if (x === own.x && y === own.y) break
            continue
          }
        }
        break
      }
      const atOwnGoal = x === own.x && y === own.y
      if (this.roster[player] === 'fire' && !atOwnGoal && this.isBush(x + dx, y + dy)) {
        burned = { x: x + dx, y: y + dy }
        this.burnt.add(`${burned.x},${burned.y}`)
      }
      if (x === from.x && y === from.y && !burned) return null
      to = { x, y }
      this.pos[player] = to
    }

    this.moves++
    this.history.push(action)
    this.turn = (1 - player) as 0 | 1
    this.won =
      this.pos[0].x === this.goals[0].x &&
      this.pos[0].y === this.goals[0].y &&
      this.pos[1].x === this.goals[1].x &&
      this.pos[1].y === this.goals[1].y
    return { player, action, from, to, burned, jumped, won: this.won }
  }

  // Replay a history string like "UDLPR": used when a player joins or reconnects
  replay(history: string): boolean {
    for (const ch of history) {
      if (!(ch === 'U' || ch === 'D' || ch === 'L' || ch === 'R' || ch === 'P')) return false
      if (!this.move(ch)) return false
    }
    return true
  }

  restart(): void {
    this.pos = [{ ...this.starts[0] }, { ...this.starts[1] }]
    this.turn = 0
    this.moves = 0
    this.won = false
    this.history = []
    this.burnt.clear()
  }
}
