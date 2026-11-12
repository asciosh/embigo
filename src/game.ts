import { remainingMoves, type Creature } from './generator'

export type Pos = { x: number; y: number }
export type Dir = 'U' | 'D' | 'L' | 'R'
// A move is a direction, or a digit: "0", "1", "2" = switch to roster[0], roster[1], roster[2]
export type Action = Dir | '0' | '1' | '2'

const DELTA: Record<Dir, [number, number]> = {
  U: [0, -1],
  D: [0, 1],
  L: [-1, 0],
  R: [1, 0],
}

export type MoveResult = {
  dir: Dir
  from: Pos
  to: Pos
  burned: Pos | null
  jumped: Pos | null // the obstacle Zefi hopped over, if any
  won: boolean
  // Only when move tracking is on: was this move on a shortest path to the goal?
  optimal: boolean | null
  // Only when move tracking is on: can the goal still be reached from here?
  deadEnd: boolean
}

export type SwapResult = { index: number; optimal: boolean | null; deadEnd: boolean }

// Pure game rules: no drawing, no browser APIs.
// The same code runs in the browser and on the server (to verify leaderboard scores).
export class Game {
  readonly level: string[]
  readonly roster: Creature[]
  readonly cols: number
  readonly rows: number
  readonly start: Pos
  readonly goal: Pos
  pos: Pos
  active = 0 // index in the roster of the creature you are playing now
  moves = 0
  won = false
  history: Action[] = []
  // Moves left on the shortest path to the goal (only when tracking is on).
  // null means the goal can no longer be reached.
  remaining: number | null = null
  private tracking = false
  private burnt = new Set<string>()

  constructor(level: string[], roster: Creature | Creature[]) {
    this.level = level
    this.roster = Array.isArray(roster) ? roster : [roster]
    this.rows = level.length
    this.cols = level[0].length
    this.start = this.find('E')
    this.goal = this.find('G')
    this.pos = { ...this.start }
  }

  // The creature you are playing right now
  get creature(): Creature {
    return this.roster[this.active]
  }

  private find(symbol: string): Pos {
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        if (this.level[y][x] === symbol) return { x, y }
      }
    }
    throw new Error(`Tile ${symbol} not found`)
  }

  // Turn the "is this the best move?" tracking on or off (the server never needs it)
  setTracking(on: boolean): void {
    this.tracking = on
    this.remaining = on ? this.computeRemaining() : null
  }

  private computeRemaining(): number | null {
    if (this.won) return 0
    return remainingMoves(this.level, this.roster, this.active, this.pos, this.burnt)
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

  isBlocked(x: number, y: number): boolean {
    const t = this.tile(x, y)
    if (t === '#') return true
    if (t === 'L') return this.creature !== 'water'
    return this.isBush(x, y)
  }

  // True when the creature is standing on a swap pad
  onPad(): boolean {
    return this.tile(this.pos.x, this.pos.y) === 'W'
  }

  // Where a slide in this direction ends, and which obstacle (if any) Zefi hopped over
  private slide(dx: number, dy: number): { x: number; y: number; jumped: Pos | null } {
    let { x, y } = this.pos
    let jumped: Pos | null = null
    const canJump = this.creature === 'air'
    for (;;) {
      const nx = x + dx
      const ny = y + dy
      if (!this.isBlocked(nx, ny)) {
        x = nx
        y = ny
        if (x === this.goal.x && y === this.goal.y) break
        continue
      }
      if (canJump && jumped === null) {
        const lx = nx + dx
        const ly = ny + dy
        if (!this.isBlocked(lx, ly)) {
          jumped = { x: nx, y: ny }
          x = lx
          y = ly
          if (x === this.goal.x && y === this.goal.y) break
          continue
        }
      }
      break
    }
    return { x, y, jumped }
  }

  // Slide in a direction. Returns null if nothing happens.
  move(dir: Dir): MoveResult | null {
    if (this.won) return null
    const [dx, dy] = DELTA[dir]
    const from = { ...this.pos }
    const { x, y, jumped } = this.slide(dx, dy)

    const atGoal = x === this.goal.x && y === this.goal.y

    // Fire creature: a bush in front of it burns away
    let burned: Pos | null = null
    if (this.creature === 'fire' && !atGoal && this.isBush(x + dx, y + dy)) {
      burned = { x: x + dx, y: y + dy }
      this.burnt.add(`${burned.x},${burned.y}`)
    }

    if (x === from.x && y === from.y && !burned) return null

    this.pos = { x, y }
    this.moves++
    this.won = atGoal
    this.history.push(dir)

    const { optimal, deadEnd } = this.track()
    return { dir, from, to: { x, y }, burned, jumped, won: atGoal, optimal, deadEnd }
  }

  // Switch to another creature of the roster. Only possible while standing on a swap pad,
  // and it costs one move.
  swapTo(index: number): SwapResult | null {
    if (this.won || index === this.active || index < 0 || index >= this.roster.length) return null
    if (!this.onPad()) return null
    this.active = index
    this.moves++
    this.history.push(String(index) as Action)
    const { optimal, deadEnd } = this.track()
    return { index, optimal, deadEnd }
  }

  // Play one action of the history (used by the server to replay a score)
  apply(action: string): boolean {
    if (action === 'U' || action === 'D' || action === 'L' || action === 'R') return this.move(action) !== null
    if (action === '0' || action === '1' || action === '2') return this.swapTo(Number(action)) !== null
    return false
  }

  private track(): { optimal: boolean | null; deadEnd: boolean } {
    if (!this.tracking) return { optimal: null, deadEnd: false }
    const before = this.remaining
    this.remaining = this.computeRemaining()
    return {
      optimal: before !== null && this.remaining !== null && this.remaining === before - 1,
      deadEnd: this.remaining === null,
    }
  }

  // A text key of the whole state (used by tests)
  stateKey(): string {
    return `${this.pos.x},${this.pos.y}|${this.active}|${[...this.burnt].sort().join(';')}`
  }

  restart(): void {
    this.pos = { ...this.start }
    this.active = 0
    this.moves = 0
    this.won = false
    this.history = []
    this.burnt.clear()
    this.remaining = this.tracking ? this.computeRemaining() : null
  }
}
