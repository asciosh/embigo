// Roguelike mode ("The Descent"): pure rules shared by the browser, local co-op and the online room.
// Everything is deterministic from the run seed, so both friends (and the server) see the same floors.
import { campaignSpec, generateLevel, type Creature, type GeneratedLevel, type Spec } from './generator'
import { COOP_ROGUE_DATA } from './coop-rogue-data'
import type { CoopLevel } from './coop-levels'

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const START_HEARTS = 3
export const MAX_HEARTS_CAP = 6

// ---------- floors ----------

export type FloorKind = 'normal' | 'mirror' | 'elite' | 'camp' | 'boss'

export const KIND_LABEL: Record<FloorKind, string> = {
  normal: 'Floor',
  mirror: 'Mirror floor',
  elite: 'Elite floor',
  camp: 'Campfire',
  boss: 'Boss floor',
}

export function floorKind(seed: number, n: number): FloorKind {
  if (n % 10 === 0) return 'boss'
  if (n % 5 === 0) return 'camp'
  if (n % 4 === 0) return 'elite'
  if (n >= 3 && rng(seed * 131 + n)() < 0.28) return 'mirror'
  return 'normal'
}

// ---------- relics (the cards you pick between floors) ----------

export type RelicId = 'heart' | 'slack' | 'shield' | 'rewind' | 'key' | 'scout' | 'oracle' | 'pact' | 'gamble'

export type Relic = { name: string; icon: string; text: string; rarity: 0 | 1 | 2; cursed?: boolean }

export const RELICS: Record<RelicId, Relic> = {
  heart: { name: 'Warm Heart', icon: '\u2764\uFE0F', text: 'Heal 1 heart.', rarity: 0 },
  slack: { name: 'Long Road', icon: '\u{1F9ED}', text: '+1 move on every floor, for the whole run.', rarity: 0 },
  shield: { name: 'Frost Shield', icon: '\u{1F6E1}\uFE0F', text: 'Your next failed floor costs no heart.', rarity: 0 },
  rewind: { name: 'Rewind', icon: '\u23EA', text: 'Undo your last move once on every floor (stacks).', rarity: 1 },
  key: { name: 'Skeleton Key', icon: '\u{1F5DD}\uFE0F', text: 'Skip one floor whenever you want (no card for it).', rarity: 1 },
  scout: { name: 'Scout', icon: '\u{1F52D}', text: 'You see 4 cards instead of 3 from now on.', rarity: 1 },
  oracle: { name: 'Oracle Eye', icon: '\u{1F441}\uFE0F', text: 'Shows "Best move!" and dead-end warnings. Solo only.', rarity: 2 },
  pact: { name: 'Blood Pact', icon: '\u{1F608}', text: 'Heal 2 hearts now, but -1 move on every floor.', rarity: 1, cursed: true },
  gamble: { name: 'Gambler', icon: '\u{1F3B2}', text: '+3 moves on every floor, but lose 1 heart now.', rarity: 1, cursed: true },
}

// ---------- the run ----------

export type RunState = {
  seed: number
  coop: boolean
  floor: number
  hearts: number
  maxHearts: number
  slackBonus: number // extra (or fewer) moves on every floor
  shield: number
  keys: number
  rewinds: number // undos available on every floor
  scout: number
  oracle: boolean
  relics: RelicId[]
  phase: 'play' | 'pick' | 'over'
  offers: RelicId[]
  cleared: number // floors cleared so far
  undone: number // undos already used on this floor
}

export function newRun(seed: number, coop: boolean): RunState {
  const run: RunState = {
    seed, coop, floor: 1, hearts: START_HEARTS, maxHearts: START_HEARTS, slackBonus: 0, shield: 0, keys: 0,
    rewinds: 0, scout: 0, oracle: false, relics: [], phase: 'play', offers: [], cleared: 0, undone: 0,
  }
  return run
}

// Moves allowed on a floor above the best possible score ("par"). Hard from the start,
// and tighter as you go down.
export function slackFor(run: RunState): number {
  const n = run.floor
  const kind = floorKind(run.seed, n)
  let s = run.coop ? (n <= 3 ? 4 : n <= 9 ? 3 : 2) : n <= 3 ? 2 : 1
  if (!run.coop && n >= 10 && kind !== 'mirror') s = 1
  if (kind === 'mirror') s += 1
  if (kind === 'elite' || kind === 'boss') s -= 1
  return Math.max(0, s + run.slackBonus)
}

export const budgetFor = (run: RunState, par: number): number => par + slackFor(run)

export function canUndo(run: RunState): boolean {
  return run.phase === 'play' && run.rewinds > run.undone
}

export function useUndo(run: RunState): void {
  run.undone++
}

function available(run: RunState, id: RelicId): boolean {
  switch (id) {
    case 'heart': return run.hearts < run.maxHearts
    case 'slack': return run.slackBonus < 4
    case 'shield': return run.shield < 2
    case 'rewind': return run.rewinds < 3
    case 'key': return run.keys < 2
    case 'scout': return run.scout === 0
    case 'oracle': return !run.coop && !run.oracle
    case 'pact': return run.hearts < run.maxHearts && run.slackBonus > -2
    case 'gamble': return run.hearts >= 2
  }
}

function makeOffers(run: RunState): RelicId[] {
  const r = rng(run.seed * 7919 + run.floor * 104729 + run.cleared * 13 + 5)
  const hard = floorKind(run.seed, run.floor) === 'elite' || floorKind(run.seed, run.floor) === 'boss'
  const weights = hard ? [1, 3, 3] : [5, 3, 1]
  const pool = (Object.keys(RELICS) as RelicId[]).filter((id) => available(run, id))
  const count = Math.min(pool.length, 3 + run.scout)
  const out: RelicId[] = []
  while (out.length < count) {
    const total = pool.reduce((sum, id) => sum + weights[RELICS[id].rarity], 0)
    let x = r() * total
    let chosen = pool[0]
    for (const id of pool) {
      x -= weights[RELICS[id].rarity]
      if (x <= 0) {
        chosen = id
        break
      }
    }
    out.push(chosen)
    pool.splice(pool.indexOf(chosen), 1)
  }
  return out
}

// Start a floor (the campfire heals and goes straight to the cards)
function enterFloor(run: RunState): void {
  run.undone = 0
  if (floorKind(run.seed, run.floor) === 'camp') {
    run.hearts = Math.min(run.maxHearts, run.hearts + 1)
    run.offers = makeOffers(run)
    run.phase = 'pick'
  } else {
    run.offers = []
    run.phase = 'play'
  }
}

// The floor was solved within the move budget
export function clearFloor(run: RunState): void {
  run.cleared++
  if (floorKind(run.seed, run.floor) === 'boss') {
    run.maxHearts = Math.min(MAX_HEARTS_CAP, run.maxHearts + 1)
    run.hearts = Math.min(run.maxHearts, run.hearts + 1)
  }
  run.offers = makeOffers(run)
  run.phase = 'pick'
}

export function pickRelic(run: RunState, index: number): boolean {
  if (run.phase !== 'pick') return false
  const id = run.offers[index]
  if (!id) return false
  switch (id) {
    case 'heart': run.hearts = Math.min(run.maxHearts, run.hearts + 1); break
    case 'slack': run.slackBonus++; break
    case 'shield': run.shield++; break
    case 'rewind': run.rewinds++; break
    case 'key': run.keys++; break
    case 'scout': run.scout = 1; break
    case 'oracle': run.oracle = true; break
    case 'pact': run.hearts = Math.min(run.maxHearts, run.hearts + 2); run.slackBonus--; break
    case 'gamble': run.hearts = Math.max(1, run.hearts - 1); run.slackBonus += 3; break
  }
  run.relics.push(id)
  run.floor++
  enterFloor(run)
  return true
}

// The floor was failed (too many moves, or restarted by hand). Returns what happens next.
export function failFloor(run: RunState): 'retry' | 'shielded' | 'over' {
  run.undone = 0
  if (run.shield > 0) {
    run.shield--
    return 'shielded'
  }
  run.hearts--
  if (run.hearts <= 0) {
    run.hearts = 0
    run.phase = 'over'
    return 'over'
  }
  return 'retry'
}

export function skipFloor(run: RunState): boolean {
  if (run.phase !== 'play' || run.keys <= 0) return false
  run.keys--
  run.floor++
  enterFloor(run)
  return true
}

// ---------- levels ----------

function difficulty(n: number, kind: FloorKind): number {
  const base = 14 + Math.round((n - 1) * 1.5)
  return Math.min(60, base + (kind === 'elite' ? 5 : kind === 'boss' ? 9 : 0))
}

function soloRoster(seed: number, n: number, kind: FloorKind): Creature[] {
  const r = rng(seed * 977 + n * 31 + 3)
  const single: Creature[] = ['fire', 'water', 'air']
  const one = single[Math.floor(r() * 3)]
  if (n >= 4 && (kind === 'boss' || r() < 0.28)) {
    if (kind === 'boss' && n >= 10) return ['fire', 'water', 'air']
    const pairs: Creature[][] = [['fire', 'water'], ['water', 'air'], ['air', 'fire']]
    return pairs[Math.floor(r() * 3)]
  }
  return [one]
}

let soloCache: { key: string; level: GeneratedLevel } | null = null

export function rogueLevel(run: RunState): GeneratedLevel {
  const key = `${run.seed}-${run.floor}`
  if (soloCache && soloCache.key === key) return soloCache.level
  const kind = floorKind(run.seed, run.floor)
  const roster = soloRoster(run.seed, run.floor, kind)
  const base = campaignSpec(difficulty(run.floor, kind))
  const spec: Spec = roster.length > 1 ? { ...base, pads: roster.length, par: Math.max(6, Math.round(base.par * 0.8)) } : base
  const level = generateLevel(run.seed * 7919 + run.floor * 104729 + 13, spec, roster)
  soloCache = { key, level }
  return level
}

const LETTERS: Record<string, Creature> = { f: 'fire', w: 'water', a: 'air' }

export function rogueCoopLevel(run: RunState): CoopLevel {
  const kind = floorKind(run.seed, run.floor)
  const r = rng(run.seed * 613 + run.floor * 17 + 1)
  const size = COOP_ROGUE_DATA.length
  const base = 2 + (run.floor - 1) * 1.4 + (kind === 'elite' ? 3 : kind === 'boss' ? 6 : 0)
  let idx = Math.round(base + (r() * 4 - 2))
  if (idx > size - 1) idx = size - 1 - Math.floor(r() * 8)
  idx = Math.max(0, Math.min(size - 1, idx))
  const variant = Math.floor(r() * 4) // mirrored left-right and/or top-bottom: same rules, new look
  const [head, body] = COOP_ROGUE_DATA[idx].split('|')
  let rows = body.split('/')
  if (variant & 1) rows = rows.map((row) => [...row].reverse().join(''))
  if (variant & 2) rows = [...rows].reverse()
  return { roster: [LETTERS[head[0]], LETTERS[head[1]]], par: Number(head.slice(2)), rows }
}
