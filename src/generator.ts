// Level generator and solver. Everything here is deterministic: the same seed gives the
// same level in every browser and on the server.

export type Creature = 'fire' | 'water' | 'air'
// roster: the creatures you can play in this level (the first one is the one you start with).
// creature: the one you start with.
export type GeneratedLevel = { rows: string[]; moves: number; creature: Creature; roster: Creature[] }

// Tiles in the text format: '#' rock, '.' ice, 'B' bush, 'L' lake, 'W' swap pad, 'E' start, 'G' goal
//  - everybody is stopped by rocks
//  - fire creature (Embi): burns bushes (stops in front, the bush disappears), lakes are walls
//  - water creature (Drip): slides across lakes, bushes are walls
//  - air creature (Zefi): once per move it hops over one obstacle and lands on the free tile behind it
//  - swap pad: when you stop on it you can switch to another creature of the roster (costs 1 move)
//  - creature = null: no powers (used to check that the powers really matter)

const ICE = 0
const ROCK = 1
const BUSH = 2
const LAKE = 3
const PAD = 4
const SYMBOLS = ['.', '#', 'B', 'L', 'W']

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
      else if (ch === 'W') tiles[i] = PAD
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

type Power = Creature | null

// Minimum number of moves from a position (and a set of already burnt bushes) to the goal,
// or null if the goal cannot be reached. Breadth-first search over
// (active creature, burnt bushes, position). Swapping creature on a pad costs one move.
function solveLayout(l: Layout, roster: Power[], startActive: number, from: number, burntMask: number): number | null {
  const { w, h, tiles, goal } = l
  const cells = w * h
  const bushBit = new Int8Array(cells).fill(-1)
  let bushCount = 0
  for (let i = 0; i < cells; i++) if (tiles[i] === BUSH) bushBit[i] = bushCount++
  const masks = 1 << bushCount
  const total = roster.length * masks * cells
  const dist = new Int16Array(total).fill(-1)
  const queue = new Int32Array(total)
  const first = (startActive * masks + burntMask) * cells + from
  dist[first] = 0
  let head = 0
  let tail = 0
  queue[tail++] = first
  const steps = [1, -1, w, -w]
  const dxs = [1, -1, 0, 0]
  const dys = [0, 0, 1, -1]

  while (head < tail) {
    const s = queue[head++]
    const cell = s % cells
    const rest = (s - cell) / cells
    const mask = rest % masks
    const active = (rest - mask) / masks
    const d = dist[s]
    if (cell === goal) return d

    const power = roster[active]
    const canBurn = power === 'fire'
    const canSwim = power === 'water'
    const canJump = power === 'air'
    const blocked = (c: number) => {
      const t = tiles[c]
      if (t === ROCK) return true
      if (t === LAKE) return !canSwim
      if (t === BUSH) return (mask & (1 << bushBit[c])) === 0
      return false
    }

    for (let k = 0; k < 4; k++) {
      const step = steps[k]
      let pos = cell
      let x = cell % w
      let y = (cell - x) / w
      let jumped = false
      for (;;) {
        const next = pos + step
        if (!blocked(next)) {
          pos = next
          x += dxs[k]
          y += dys[k]
          if (pos === goal) break
          continue
        }
        if (canJump && !jumped) {
          const lx = x + 2 * dxs[k]
          const ly = y + 2 * dys[k]
          if (lx >= 0 && lx < w && ly >= 0 && ly < h && !blocked(next + step)) {
            pos = next + step
            x = lx
            y = ly
            jumped = true
            if (pos === goal) break
            continue
          }
        }
        break
      }
      let nextMask = mask
      if (canBurn && pos !== goal) {
        const next = pos + step
        if (tiles[next] === BUSH && (mask & (1 << bushBit[next])) === 0) nextMask = mask | (1 << bushBit[next])
      }
      if (pos === cell && nextMask === mask) continue
      const ns = (active * masks + nextMask) * cells + pos
      if (dist[ns] < 0) {
        dist[ns] = d + 1
        queue[tail++] = ns
      }
    }

    // swap creature on a pad
    if (tiles[cell] === PAD) {
      for (let a = 0; a < roster.length; a++) {
        if (a === active) continue
        const ns = (a * masks + mask) * cells + cell
        if (dist[ns] < 0) {
          dist[ns] = d + 1
          queue[tail++] = ns
        }
      }
    }
  }
  return null
}

export function solveRows(rows: string[], creature: Creature | Creature[] | null): number | null {
  const l = parse(rows)
  const roster: Power[] = creature === null ? [null] : Array.isArray(creature) ? creature : [creature]
  return solveLayout(l, roster, 0, l.start, 0)
}

// Moves left on the shortest path from a position, given the bushes burnt so far
// and the creature that is active right now.
export function remainingMoves(
  rows: string[],
  roster: Creature[],
  active: number,
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
  return solveLayout(l, roster, active, pos.y * l.w + pos.x, mask)
}

// ---------- generation ----------

export type Spec = { w: number; h: number; rocks: number; bushes: number; lakes: number; par: number; pads?: number }

// Hill climbing: start from a random layout and keep moving obstacles / start / goal around,
// keeping every change that does not shorten the best solution, until the target par is reached.
function tryGenerate(seed: number, spec: Spec, roster: Creature[]): { layout: Layout; par: number } | null {
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
  if (spec.pads) place(PAD, spec.pads)
  let start = take()
  let goal = take()
  const layout: Layout = { w, h, tiles, start, goal }

  const evaluate = (): number => {
    layout.start = start
    layout.goal = goal
    return solveLayout(layout, roster, 0, start, 0) ?? -1
  }
  // The powers must really matter. One creature: without any power it is impossible or clearly longer.
  // Several creatures: each of them alone is stuck or clearly slower, so the swap pads are needed.
  const powerMatters = (par: number): boolean => {
    if (roster.length === 1) {
      const plain = solveLayout(layout, [null], 0, start, 0)
      return plain === null || plain >= par + 2
    }
    for (const c of roster) {
      const alone = solveLayout(layout, [c], 0, start, 0)
      if (alone !== null && alone < par + 2) return false
    }
    return true
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

export function generateLevel(seed: number, spec: Spec, creature: Creature | Creature[]): GeneratedLevel {
  const roster = Array.isArray(creature) ? creature : [creature]
  for (let attempt = 0; attempt < 12; attempt++) {
    const result = tryGenerate(seed * 31 + attempt, spec, roster)
    if (result && result.par >= Math.max(3, Math.floor(spec.par * 0.7))) {
      return { rows: toRows(result.layout), moves: result.par, creature: roster[0], roster }
    }
  }
  return { rows: FALLBACK, moves: solveRows(FALLBACK, roster[0]) ?? 0, creature: roster[0], roster: [roster[0]] }
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

// Which creatures you can play in campaign level n:
//  - levels 1-7: Embi on odd levels, Drip on even levels
//  - then Zefi joins the rotation (Zefi, Embi, Drip)
//  - from level 16 every 4th level has swap pads with two creatures
//  - from level 36 some levels have swap pads with all three
export function campaignRoster(n: number): Creature[] {
  if (n <= 7) return [n % 2 === 1 ? 'fire' : 'water']
  if (n >= 36 && n % 4 === 2) return ['fire', 'water', 'air']
  if (n >= 16 && n % 4 === 0) {
    const pairs: Creature[][] = [['fire', 'water'], ['water', 'air'], ['air', 'fire']]
    return pairs[(n / 4) % 3]
  }
  const single: Creature[] = ['air', 'fire', 'water']
  return [single[n % 3]]
}

export function campaignLevel(n: number): GeneratedLevel {
  const roster = campaignRoster(n)
  const base = campaignSpec(n)
  // levels with swap pads are a bit shorter: switching creature adds its own difficulty
  const spec: Spec = roster.length > 1 ? { ...base, pads: roster.length, par: Math.max(6, Math.round(base.par * 0.8)) } : base
  return generateLevel(n * 7919 + 13, spec, roster)
}

// A random puzzle, about as hard as the middle of the campaign
export function randomLevel(seed: number): GeneratedLevel {
  const rnd = mulberry32(seed)
  const n = 10 + Math.floor(rnd() * 35)
  const r = rnd()
  const roster: Creature[] = r < 0.25 ? ['fire'] : r < 0.5 ? ['water'] : r < 0.75 ? ['air'] : r < 0.9 ? ['fire', 'water'] : ['fire', 'water', 'air']
  const base = campaignSpec(n)
  const spec: Spec = roster.length > 1 ? { ...base, pads: roster.length, par: Math.max(6, Math.round(base.par * 0.8)) } : base
  return generateLevel(seed, spec, roster)
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
