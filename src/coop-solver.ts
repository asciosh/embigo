import type { Creature } from './generator'

// Offline solver for co-op levels (used by the level generator script, not by the game).

const ROCK = 1, BUSH = 2, LAKE = 3, PLATE = 5, GATE = 6

export type CoopLayout = {
  w: number
  h: number
  tiles: Uint8Array
  start: [number, number]
  goal: [number, number]
}

export function parseCoop(rows: string[]): CoopLayout {
  const h = rows.length
  const w = rows[0].length
  const tiles = new Uint8Array(w * h)
  const start: [number, number] = [0, 0]
  const goal: [number, number] = [0, 0]
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x]
      const i = y * w + x
      if (ch === '#') tiles[i] = ROCK
      else if (ch === 'B') tiles[i] = BUSH
      else if (ch === 'L') tiles[i] = LAKE
      else if (ch === 'P') tiles[i] = PLATE
      else if (ch === 'D') tiles[i] = GATE
      else if (ch === 'E') start[0] = i
      else if (ch === 'F') start[1] = i
      else if (ch === 'G') goal[0] = i
      else if (ch === 'H') goal[1] = i
    }
  }
  return { w, h, tiles, start, goal }
}

const SYMBOLS = ['.', '#', 'B', 'L', '.', 'P', 'D']
export function coopRows(l: CoopLayout): string[] {
  const rows: string[] = []
  for (let y = 0; y < l.h; y++) {
    let r = ''
    for (let x = 0; x < l.w; x++) {
      const i = y * l.w + x
      r += i === l.start[0] ? 'E' : i === l.start[1] ? 'F' : i === l.goal[0] ? 'G' : i === l.goal[1] ? 'H' : SYMBOLS[l.tiles[i]]
    }
    rows.push(r)
  }
  return rows
}

// mode 'both': both creatures must reach their goals (the real level).
// mode 0 / 1: only that creature has to reach its goal while the other one never moves (only passes).
export function solveCoop(l: CoopLayout, roster: [Creature, Creature], mode: 'both' | 0 | 1 = 'both'): number | null {
  const { w, h, tiles } = l
  const cells = w * h
  const bushBit = new Int8Array(cells).fill(-1)
  let bushCount = 0
  for (let i = 0; i < cells; i++) if (tiles[i] === BUSH) bushBit[i] = bushCount++
  const masks = 1 << bushCount
  const total = 2 * masks * cells * cells
  const dist = new Int16Array(total).fill(-1)
  const queue = new Int32Array(total)
  const enc = (turn: number, mask: number, a: number, b: number) => ((turn * masks + mask) * cells + a) * cells + b
  const first = enc(0, 0, l.start[0], l.start[1])
  dist[first] = 0
  let head = 0
  let tail = 0
  queue[tail++] = first
  const steps = [1, -1, w, -w]
  const dxs = [1, -1, 0, 0]
  const dys = [0, 0, 1, -1]

  while (head < tail) {
    const s = queue[head++]
    const b = s % cells
    const r1 = (s - b) / cells
    const a = r1 % cells
    const r2 = (r1 - a) / cells
    const mask = r2 % masks
    const turn = (r2 - mask) / masks
    const d = dist[s]

    if (mode === 'both' ? a === l.goal[0] && b === l.goal[1] : mode === 0 ? a === l.goal[0] : b === l.goal[1]) return d

    const me = turn === 0 ? a : b
    const other = turn === 0 ? b : a
    const power = roster[turn]
    const own = l.goal[turn]
    const plateOn = tiles[a] === PLATE || tiles[b] === PLATE
    const canBurn = power === 'fire'
    const canSwim = power === 'water'
    const canJump = power === 'air'

    const blocked = (c: number) => {
      const t = tiles[c]
      if (t === ROCK) return true
      if (t === LAKE) return !canSwim
      if (t === GATE) return !plateOn
      if (t === BUSH && (mask & (1 << bushBit[c])) === 0) return true
      return c === other
    }

    const push = (nm: number, na: number, nb: number) => {
      const ns = enc(1 - turn, nm, na, nb)
      if (dist[ns] < 0) {
        dist[ns] = d + 1
        queue[tail++] = ns
      }
    }

    // pass is always possible
    push(mask, a, b)

    // the frozen partner only passes
    if (mode !== 'both' && turn !== mode) continue

    for (let k = 0; k < 4; k++) {
      const step = steps[k]
      let pos = me
      let x = me % w
      let y = (me - x) / w
      let jumped = false
      for (;;) {
        const next = pos + step
        if (!blocked(next)) {
          pos = next
          x += dxs[k]
          y += dys[k]
          if (pos === own) break
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
            if (pos === own) break
            continue
          }
        }
        break
      }
      let nm = mask
      if (canBurn && pos !== own) {
        const next = pos + step
        if (tiles[next] === BUSH && (mask & (1 << bushBit[next])) === 0) nm = mask | (1 << bushBit[next])
      }
      if (pos === me && nm === mask) continue
      if (turn === 0) push(nm, pos, b)
      else push(nm, a, pos)
    }
  }
  return null
}

// ---------- level generation (offline) ----------

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

export type CoopSpec = {
  w: number
  h: number
  rocks: number
  bushes: number
  lakes: number
  plates: number
  gates: number
  par: number
  roster: [Creature, Creature]
  mutual: boolean // true: neither player can finish alone; false: at least one of them cannot
}

// Hill climbing like for the single player levels, but a level only counts if the players
// really depend on each other (checked by letting the partner only pass).
export function generateCoop(seed: number, spec: CoopSpec, steps = 3000): { rows: string[]; par: number; mutual: boolean } | null {
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
  place(PLATE, spec.plates)
  place(GATE, spec.gates)
  const sp: number[] = [take(), take(), take(), take()] // start 1, start 2, goal 1, goal 2
  const layout: CoopLayout = { w, h, tiles, start: [sp[0], sp[1]], goal: [sp[2], sp[3]] }
  const sync = () => {
    layout.start = [sp[0], sp[1]]
    layout.goal = [sp[2], sp[3]]
  }

  const evaluate = () => {
    sync()
    return solveCoop(layout, spec.roster) ?? -1
  }
  const dependent = (): { ok: boolean; mutual: boolean } => {
    const a = solveCoop(layout, spec.roster, 0) !== null
    const b = solveCoop(layout, spec.roster, 1) !== null
    const mutual = !a && !b
    return { ok: spec.mutual ? mutual : !(a && b), mutual }
  }

  let current = evaluate()
  let bestPar = -1
  let best: { tiles: Uint8Array; sp: number[]; mutual: boolean } | null = null
  for (let step = 0; step < steps; step++) {
    if (current > bestPar) {
      const dep = dependent()
      if (dep.ok) {
        bestPar = current
        best = { tiles: tiles.slice(), sp: [...sp], mutual: dep.mutual }
        if (bestPar >= spec.par) break
      }
    }
    const r = rnd()
    const cand = interior[Math.floor(rnd() * interior.length)]
    if (tiles[cand] !== 0 || sp.includes(cand)) continue
    let undo: () => void
    if (r < 0.65 && obstacles.length) {
      const oi = Math.floor(rnd() * obstacles.length)
      const from = obstacles[oi]
      const t = tiles[from]
      tiles[from] = 0
      tiles[cand] = t
      obstacles[oi] = cand
      undo = () => {
        tiles[cand] = 0
        tiles[from] = t
        obstacles[oi] = from
      }
    } else {
      const si = Math.floor(rnd() * 4)
      const old = sp[si]
      sp[si] = cand
      undo = () => {
        sp[si] = old
      }
    }
    const score = evaluate()
    if (score >= current || (score >= 0 && rnd() < 0.02)) current = score
    else {
      undo()
      sync()
    }
  }
  if (!best) return null
  const out: CoopLayout = { w, h, tiles: best.tiles, start: [best.sp[0], best.sp[1]], goal: [best.sp[2], best.sp[3]] }
  return { rows: coopRows(out), par: bestPar, mutual: best.mutual }
}
