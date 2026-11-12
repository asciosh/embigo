import { remainingMoves, type Creature } from './generator'

export type Pos = { x: number; y: number }
export type Dir = 'U' | 'D' | 'L' | 'R'

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
  won: boolean
  // Only when move tracking is on: was this move on a shortest path to the goal?
  optimal: boolean | null
  // Only when move tracking is on: can the goal still be reached from here?
  deadEnd: boolean
}

// Pure game rules: no drawing, no browser APIs.
// The same code can later run on the server to verify leaderboard scores.
export class Game {
  readonly level: string[]
  readonly creature: Creature
  readonly cols: number
  readonly rows: number
  readonly start: Pos
  readonly goal: Pos
  pos: Pos
  moves = 0
  won = false
  history: Dir[] = []
  // Moves left on the shortest path to the goal (only when tracking is on).
  // null means the goal can no longer be reached.
  remaining: number | null = null
  private tracking = false
  private burnt = new Set<string>()

  constructor(level: string[], creature: Creature) {
    this.level = level
    this.creature = creature
    this.rows = level.length
    this.cols = level[0].length
    this.start = this.find('E')
    this.goal = this.find('G')
    this.pos = { ...this.start }
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
    return remainingMoves(this.level, this.creature, this.pos, this.burnt)
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

  // Slide in a direction. Returns null if nothing happens.
  move(dir: Dir): MoveResult | null {
    if (this.won) return null
    const [dx, dy] = DELTA[dir]
    const from = { ...this.pos }
    let { x, y } = this.pos

    while (!this.isBlocked(x + dx, y + dy)) {
      x += dx
      y += dy
      if (x === this.goal.x && y === this.goal.y) break
    }

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

    let optimal: boolean | null = null
    let deadEnd = false
    if (this.tracking) {
      const before = this.remaining
      this.remaining = this.computeRemaining()
      optimal = before !== null && this.remaining !== null && this.remaining === before - 1
      deadEnd = this.remaining === null
    }
    return { dir, from, to: { x, y }, burned, won: atGoal, optimal, deadEnd }
  }

  restart(): void {
    this.pos = { ...this.start }
    this.moves = 0
    this.won = false
    this.history = []
    this.burnt.clear()
    this.remaining = this.tracking ? this.computeRemaining() : null
  }
}
