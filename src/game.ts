import type { Creature } from './generator'

export type Pos = { x: number; y: number }
export type Dir = 'U' | 'D' | 'L' | 'R'

const DELTA: Record<Dir, [number, number]> = {
  U: [0, -1],
  D: [0, 1],
  L: [-1, 0],
  R: [1, 0],
}

export type MoveResult = { dir: Dir; from: Pos; to: Pos; burned: Pos | null; won: boolean }

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
    return { dir, from, to: { x, y }, burned, won: atGoal }
  }

  restart(): void {
    this.pos = { ...this.start }
    this.moves = 0
    this.won = false
    this.history = []
    this.burnt.clear()
  }
}
