import { dailyLevels, type GeneratedLevel } from './generator'
import { PUZZLE_DATA } from './puzzle-data'

function decode(raw: string): GeneratedLevel {
  const [head, rows] = raw.split('|')
  return {
    creature: head[0] === 'f' ? 'fire' : 'water',
    moves: Number(head.slice(1)),
    rows: rows.split('/'),
  }
}

// The two puzzles of a given day. The server reads them from the pre-generated table
// (instant); outside the table they are generated on the fly (same result, just slower).
export function getDailyPuzzles(day: number): [GeneratedLevel, GeneratedLevel] {
  const entry = PUZZLE_DATA[day]
  if (entry) return [decode(entry[0]), decode(entry[1])]
  return dailyLevels(day)
}
