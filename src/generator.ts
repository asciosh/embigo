export const W = 10
export const H = 8

// How many moves the generator aims for (the real par can be a little higher)
export const TARGET_MOVES = 6

// Small seeded random number generator: same seed -> same sequence
// (like new Random(seed) in C#)
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type Creature = 'fire' | 'water'

type Cell = { x: number; y: number }
type State = { x: number; y: number; mask: number }

// Tiles: '#' rock, '.' ice, 'B' bush, 'L' lake, 'E' start, 'G' goal
//  - everybody is stopped by rocks
//  - fire creature: burns bushes (stops in front, bush disappears), lakes are walls
//  - water creature: slides across lakes, bushes are walls
//  - creature = null: no powers (used to check that the obstacles matter)
// Returns the minimum number of moves to reach the goal, or null if unsolvable.
export function solveLevel(rows: string[], creature: Creature | null): number | null {
  const canBurn = creature === 'fire'
  const canSwim = creature === 'water'
  const grid = rows.map((r) => [...r])
  let start: Cell = { x: 0, y: 0 }
  let goal: Cell = { x: 0, y: 0 }
  const bushBit = new Map<number, number>() // bush cell -> its bit in the "burnt" mask
  let bushCount = 0

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ch = grid[y][x]
      if (ch === 'E') start = { x, y }
      if (ch === 'G') goal = { x, y }
      if (ch === 'B') bushBit.set(y * W + x, 1 << bushCount++)
    }
  }

  const stateKey = (s: State) => (s.mask * H + s.y) * W + s.x
  const first: State = { ...start, mask: 0 }
  const dist = new Map<number, number>([[stateKey(first), 0]])
  const queue: State[] = [first]
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]]

  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i]
    const d = dist.get(stateKey(cur))!
    if (cur.x === goal.x && cur.y === goal.y) return d

    for (const [dx, dy] of dirs) {
      let { x, y } = cur
      let mask = cur.mask
      const blocked = (bx: number, by: number) => {
        const ch = grid[by][bx]
        if (ch === '#') return true
        if (ch === 'L') return !canSwim
        if (ch === 'B') return (mask & bushBit.get(by * W + bx)!) === 0
        return false
      }

      while (!blocked(x + dx, y + dy)) {
        x += dx
        y += dy
        if (x === goal.x && y === goal.y) break
      }

      const atGoal = x === goal.x && y === goal.y
      if (canBurn && !atGoal && grid[y + dy][x + dx] === 'B') {
        mask |= bushBit.get((y + dy) * W + (x + dx))!
      }

      const next: State = { x, y, mask }
      if (!dist.has(stateKey(next))) {
        dist.set(stateKey(next), d + 1)
        queue.push(next)
      }
    }
  }
  return null
}

export type GeneratedLevel = { rows: string[]; moves: number; creature: Creature }

// A hand-made level used only if the generator ever fails
const FALLBACK = [
  '##########',
  '#E...#...#',
  '#........#',
  '#.#...#..#',
  '#...##...#',
  '####.##..#',
  '#.......G#',
  '##########',
]

// Builds a level for a creature picked by the seed, keeping one where:
//  - that creature can solve it in about `minMoves` moves
//  - its power really matters: without powers it is impossible or clearly longer
export function generateLevel(seed: number, minMoves: number): GeneratedLevel {
  const rnd = mulberry32(seed)
  const creature: Creature = rnd() < 0.5 ? 'fire' : 'water'
  let best: GeneratedLevel | null = null

  for (let attempt = 0; attempt < 5000; attempt++) {
    const grid: string[][] = []
    for (let y = 0; y < H; y++) {
      grid.push([...Array(W)].map((_, x) => (x === 0 || y === 0 || x === W - 1 || y === H - 1 ? '#' : '.')))
    }

    const freeCells = (): Cell[] => {
      const free: Cell[] = []
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) if (grid[y][x] === '.') free.push({ x, y })
      }
      return free
    }
    const pick = (cells: Cell[]) => cells.splice(Math.floor(rnd() * cells.length), 1)[0]
    const place = (tile: string, count: number) => {
      for (let i = 0; i < count; i++) {
        const c = pick(freeCells())
        grid[c.y][c.x] = tile
      }
    }

    place('#', 6 + Math.floor(rnd() * 4))
    place('B', 2 + Math.floor(rnd() * 2))
    place('L', 3 + Math.floor(rnd() * 2))

    const free = freeCells()
    if (free.length < 2) continue
    const start = pick(free)
    const goal = pick(free)
    grid[start.y][start.x] = 'E'
    grid[goal.y][goal.x] = 'G'
    const rows = grid.map((r) => r.join(''))

    const moves = solveLevel(rows, creature)
    if (moves === null) continue
    const withoutPowers = solveLevel(rows, null)
    const powerMatters = withoutPowers === null || withoutPowers >= moves + 2

    if (powerMatters && moves >= minMoves && moves <= minMoves + 3) return { rows, moves, creature }
    if (powerMatters && (!best || Math.abs(moves - minMoves) < Math.abs(best.moves - minMoves))) {
      best = { rows, moves, creature }
    }
  }
  return best ?? { rows: FALLBACK, moves: solveLevel(FALLBACK, creature) ?? 0, creature }
}

// A day as a number, e.g. 20261111 (UTC, so it is the same everywhere in the world)
export function dayNumber(date: Date = new Date()): number {
  return date.getUTCFullYear() * 10000 + (date.getUTCMonth() + 1) * 100 + date.getUTCDate()
}

// Today's puzzle number: same for everyone
export function dailySeed(): number {
  return dayNumber()
}
