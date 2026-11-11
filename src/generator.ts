export const W = 10
export const H = 8

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

type Cell = { x: number; y: number }

// Minimum number of slides needed to reach the goal, or null if unsolvable
function solve(grid: string[][], start: Cell, goal: Cell): number | null {
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]]
  const key = (c: Cell) => c.y * W + c.x
  const dist = new Map<number, number>([[key(start), 0]])
  const queue: Cell[] = [start]

  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i]
    const d = dist.get(key(cur))!
    if (cur.x === goal.x && cur.y === goal.y) return d
    for (const [dx, dy] of dirs) {
      let { x, y } = cur
      while (grid[y + dy][x + dx] !== '#') {
        x += dx
        y += dy
        if (x === goal.x && y === goal.y) break
      }
      const next = { x, y }
      if (!dist.has(key(next))) {
        dist.set(key(next), d + 1)
        queue.push(next)
      }
    }
  }
  return null
}

export type GeneratedLevel = { rows: string[]; moves: number }

// Builds random levels, keeps one that is solvable with about `minMoves` slides
export function generateLevel(seed: number, minMoves: number): GeneratedLevel {
  const rnd = mulberry32(seed)
  let best: GeneratedLevel | null = null

  for (let attempt = 0; attempt < 3000; attempt++) {
    const grid: string[][] = []
    for (let y = 0; y < H; y++) {
      grid.push([...Array(W)].map((_, x) => (x === 0 || y === 0 || x === W - 1 || y === H - 1 ? '#' : '.')))
    }

    const rockCount = 9 + Math.floor(rnd() * 6)
    for (let i = 0; i < rockCount; i++) {
      grid[1 + Math.floor(rnd() * (H - 2))][1 + Math.floor(rnd() * (W - 2))] = '#'
    }

    const free: Cell[] = []
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) if (grid[y][x] === '.') free.push({ x, y })
    }
    if (free.length < 2) continue

    const start = free[Math.floor(rnd() * free.length)]
    const goal = free[Math.floor(rnd() * free.length)]
    if (start.x === goal.x && start.y === goal.y) continue

    const moves = solve(grid, start, goal)
    if (moves === null) continue

    grid[start.y][start.x] = 'E'
    grid[goal.y][goal.x] = 'G'
    const rows = grid.map((r) => r.join(''))
    grid[start.y][start.x] = '.'
    grid[goal.y][goal.x] = '.'

    if (moves >= minMoves && moves <= minMoves + 3) return { rows, moves }
    if (!best || Math.abs(moves - minMoves) < Math.abs(best.moves - minMoves)) best = { rows, moves }
  }
  return best!
}

// Same number for everyone on the same day, e.g. 20261111
export function dailySeed(): number {
  const d = new Date()
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()
}