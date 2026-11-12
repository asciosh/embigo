import type { Creature } from './generator'
import { COOP_DATA } from './coop-data'

export type CoopLevel = { rows: string[]; roster: [Creature, Creature]; par: number }

const LETTERS: Record<string, Creature> = { f: 'fire', w: 'water', a: 'air' }

export const COOP_LEVEL_COUNT = COOP_DATA.length

// Co-op level n (1-based). Levels beyond the last one start again from the first.
export function coopLevel(n: number): CoopLevel {
  const raw = COOP_DATA[(Math.max(1, n) - 1) % COOP_DATA.length]
  const [head, rows] = raw.split('|')
  return {
    roster: [LETTERS[head[0]], LETTERS[head[1]]],
    par: Number(head.slice(2)),
    rows: rows.split('/'),
  }
}
