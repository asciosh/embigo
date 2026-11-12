// Level generator and solver. Everything here is deterministic: the same seed gives the
// same level in every browser and on the server.

export type Creature = 'fire' | 'water'
export type GeneratedLevel = { rows: string[]; moves: number; creature: Creature }

// Tiles in the text format: '#' rock, '.' ice, 'B' bush, 'L' lake, 'E' start, 'G' goal
//  - everybody is stopped by rocks
//  - fire creature (Embi): burns bushes (stops in front, the bush disappears), lakes are walls
//  - water creature (Drip): slides across lakes, bushes are walls
//  - creature = null: no powers (used to check that the powers really matter)

const ICE = 0
const ROCK = 1
const BUSH = 2
const LAKE = 3
const SYMBOLS = ['.', '#', 'B', 'L']

type Layout = { w: number; h: number; tiles: Uint8Array; start: number; goal: number }

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

function parse(rows: string[]): Layout {
  const h = rows.length
  const w = rows[0].length
  const tiles = new Uint8Array(w * h)
  let start = 0
  let goal = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x]
      const i = y * w + x
      if (ch === '#') tiles[i] = ROCK
      else if (ch === 'B') tiles[i] = BUSH
      else if (ch === 'L') tiles[i] = LAKE
      else if (ch === 'E') start = i
      else if (ch === 'G') goal = i
    }
  }
  return { w, h, tiles, start, goal }
}

function toRows(l: Layout): string[] {
  const rows: string[] = []
  for (let y = 0; y < l.h; y++) {
    let r = ''
    for (let x = 0; x < l.w; x++) {
      const i = y * l.w + x
      r += i === l.start ? 'E' : i === l.goal ? 'G' : SYMBOLS[l.tiles[i]]
    }
    rows.push(r)
  }
  return rows
}

// Minimum number of moves from a position (and a set of already burnt bushes) to the goal,
// or null if the goal cannot be reached. Breadth-first search over (position, burnt bushes).
function solveLayout(l: Layout, creature: Creature | null, from: number, burntMask: number): number | null {
  const { w, h, tiles, goal } = l
  const cells = w * h
  const canBurn = creature === 'fire'
  const canSwim = creature === 'water'
  const bushBit = new Int8Array(cells).fill(-1)
  let bushCount = 0
  for (let i = 0; i < cells; i++) if (tiles[i] === BUSH) bushBit[i] = bushCount++
  const masks = 1 << bushCount
  const dist = new Int16Array(cells * masks).fill(-1)
  const queue = new Int32Array(cells * masks)
  const first = burntMask * cells + from
  dist[first] = 0
  let head = 0
  let tail = 0
  queue[tail++] = first
  const steps = [1, -1, w, -w]

  while (head < tail) {
    const s = queue[head++]
    const mask = Math.floor(s / cells)
    const cell = s - mask * cells
    const d = dist[s]
    if (cell === goal) return d

    for (let k = 0; k < 4; k++) {
      const step = steps[k]
      let pos = cell
      for (;;) {
        const next = pos + step
        const t = tiles[next]
        if (t === ROCK) break
        if (t === LAKE && !canSwim) break
        if (t === BUSH && (mask & (1 << bushBit[next])) === 0) break
        pos = next
        if (pos === goal) break
      }
      let nextMask = mask
      if (canBurn && pos !== goal) {
        const next = pos + step
        if (tiles[next] === BUSH && (mask & (1 << bushBit[next])) === 0) nextMask = mask | (1 << bushBit[next])
      }
      if (pos === cell && nextMask === mask) continue
      const ns = nextMask * cells + pos
      if (dist[ns] < 0) {
        dist[ns] = d + 1
        queue[tail++] = ns
      }
    }
  }
  return null
}

export function solveRows(rows: string[], creature: Creature | null): number | null {
  const l = parse(rows)
  return solveLayout(l, creature, l.start, 0)
}

// Moves left on the shortest path from a position, given the bushes burnt so far.
export function remainingMoves(
  rows: string[],
  creature: Creature,
  pos: { x: number; y: number },
  burnt: Iterable<string>,
): number | null {
  const l = parse(rows)
  let bit = 0
  let mask = 0
  const burntSet = new Set(burnt)
  for (let i = 0; i < l.w * l.h; i++) {
    if (l.tiles[i] !== BUSH) continue
    if (burntSet.has(`${i % l.w},${Math.floor(i / l.w)}`)) mask |= 1 << bit
    bit++
  }
  return solveLayout(l, creature, pos.y * l.w + pos.x, mask)
}

// ---------- generation ----------

export type Spec = { w: number; h: number; rocks: number; bushes: number; lakes: number; par: number }

// Hill climbing: start from a random layout and keep moving obstacles / start / goal around,
// keeping every change that does not shorten the best solution, until the target par is reached.
function tryGenerate(seed: number, spec: Spec, creature: Creature): { layout: Layout; par: number } | null {
  const rnd = mulberry32(seed)
  const { w, h } = spec
  const tiles = new Uint8Array(w * h)
  const interior: number[] = []
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) tiles[y * w + x] = ROCK
      else interior.push(y * w + x)
    }
  }

  const free = [...interior]
  const take = () => free.splice(Math.floor(rnd() * free.length), 1)[0]
  const obstacles: number[] = []
  const place = (tile: number, count: number) => {
    for (let i = 0; i < count; i++) {
      const c = take()
      tiles[c] = tile
      obstacles.push(c)
    }
  }
  place(ROCK, spec.rocks)
  place(BUSH, spec.bushes)
  place(LAKE, spec.lakes)
  let start = take()
  let goal = take()
  const layout: Layout = { w, h, tiles, start, goal }

  const evaluate = (): number => {
    layout.start = start
    layout.goal = goal
    return solveLayout(layout, creature, start, 0) ?? -1
  }
  const powerMatters = (par: number): boolean => {
    const plain = solveLayout(layout, null, start, 0)
    return plain === null || plain >= par + 2
  }

  let current = evaluate()
  let bestPar = -1
  let best: { tiles: Uint8Array; start: number; goal: number } | null = null

  for (let step = 0; step < 4000; step++) {
    if (current > bestPar && powerMatters(current)) {
      bestPar = current
      best = { tiles: tiles.slice(), start, goal }
      if (bestPar >= spec.par) break
    }

    const r = rnd()
    const cand = interior[Math.floor(rnd() * interior.length)]
    let undo: () => void
    if (r < 0.7) {
      const oi = Math.floor(rnd() * obstacles.length)
      const from = obstacles[oi]
      if (tiles[cand] !== ICE || cand === start || cand === goal) continue
      const t = tiles[from]
      tiles[from] = ICE
      tiles[cand] = t
      obstacles[oi] = cand
      undo = () => {
        tiles[cand] = ICE
        tiles[from] = t
        obstacles[oi] = from
      }
    } else if (r < 0.85) {
      if (tiles[cand] !== ICE || cand === goal) continue
      const old = start
      start = cand
      undo = () => {
        start = old
      }
    } else {
      if (tiles[cand] !== ICE || cand === start) continue
      const old = goal
      goal = cand
      undo = () => {
        goal = old
      }
    }

    const score = evaluate()
    if (score >= current || (score >= 0 && rnd() < 0.02)) {
      current = score
    } else {
      undo()
      layout.start = start
      layout.goal = goal
    }
  }

  if (!best) return null
  return { layout: { w, h, tiles: best.tiles, start: best.start, goal: best.goal }, par: bestPar }
}

// A hand-made level used only if generation ever fails
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

export function generateLevel(seed: number, spec: Spec, creature: Creature): GeneratedLevel {
  for (let attempt = 0; attempt < 12; attempt++) {
    const result = tryGenerate(seed * 31 + attempt, spec, creature)
    if (result && result.par >= Math.max(3, Math.floor(spec.par * 0.7))) {
      return { rows: toRows(result.layout), moves: result.par, creature }
    }
  }
  return { rows: FALLBACK, moves: solveRows(FALLBACK, creature) ?? 0, creature }
}

// ---------- campaign, daily and random puzzles ----------

// Campaign level n (1, 2, 3...): the board and the solution get longer as n grows.
export function campaignSpec(n: number): Spec {
  const w = Math.min(14, 7 + Math.floor((n - 1) / 8))
  const h = Math.min(10, 6 + Math.floor((n - 1) / 12))
  const inner = (w - 2) * (h - 2)
  return {
    w,
    h,
    rocks: Math.round(inner * 0.16),
    bushes: Math.min(5, 1 + Math.floor(n / 12)),
    lakes: Math.min(5, 1 + Math.floor(n / 10)),
    par: Math.min(26, Math.round(3 + n * 0.38)),
  }
}

// Odd levels are for Embi, even levels for Drip
export function campaignLevel(n: number): GeneratedLevel {
  return generateLevel(n * 7919 + 13, campaignSpec(n), n % 2 === 1 ? 'fire' : 'water')
}

// A random puzzle, about as hard as the middle of the campaign
export function randomLevel(seed: number): GeneratedLevel {
  const rnd = mulberry32(seed)
  const n = 10 + Math.floor(rnd() * 35)
  return generateLevel(seed, campaignSpec(n), rnd() < 0.5 ? 'fire' : 'water')
}

// The two puzzles of a day: the first is medium, the second is bigger and harder.
// One is for Embi and the other for Drip.
export const DAILY_SPECS: [Spec, Spec] = [
  { w: 11, h: 9, rocks: 12, bushes: 3, lakes: 3, par: 10 },
  { w: 14, h: 10, rocks: 20, bushes: 4, lakes: 5, par: 16 },
]

export function dailyLevels(day: number): [GeneratedLevel, GeneratedLevel] {
  const firstIsFire = mulberry32(day)() < 0.5
  return [
    generateLevel(day * 10 + 1, DAILY_SPECS[0], firstIsFire ? 'fire' : 'water'),
    generateLevel(day * 10 + 2, DAILY_SPECS[1], firstIsFire ? 'water' : 'fire'),
  ]
}

// A day as a number, e.g. 20261111 (UTC, so it is the same everywhere in the world)
export function dayNumber(date: Date = new Date()): number {
  return date.getUTCFullYear() * 10000 + (date.getUTCMonth() + 1) * 100 + date.getUTCDate()
}

// Today's puzzle number: same for everyone
export function dailySeed(): number {
  return dayNumber()
}
