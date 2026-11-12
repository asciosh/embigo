import { dailyLevels, type Creature, type GeneratedLevel } from './generator'
import { PUZZLE_DATA } from './puzzle-data'

const LETTERS: Record<string, Creature> = { f: 'fire', w: 'water', a: 'air' }

// "<letters><par>|<rows>": the letters are the roster (f = fire, w = water, a = air)
function decode(raw: string): GeneratedLevel {
  const [head, rows] = raw.split('|')
  const match = /^([fwa]+)(\d+)$/.exec(head)
  if (!match) throw new Error('Bad puzzle data')
  const roster = [...match[1]].map((c) => LETTERS[c])
  return { creature: roster[0], roster, moves: Number(match[2]), rows: rows.split('/') }
}

// The two puzzles of a given day. The server reads them from the pre-generated table
// (instant); outside the table they are generated on the fly (same result, just slower).
export function getDailyPuzzles(day: number): [GeneratedLevel, GeneratedLevel] {
  const entry = PUZZLE_DATA[day]
  if (entry) return [decode(entry[0]), decode(entry[1])]
  return dailyLevels(day)
}
