import { generateLevel, TARGET_MOVES, type GeneratedLevel } from './generator'
import { PUZZLE_DATA } from './puzzle-data'

// The puzzle of a given day. Read from the pre-generated table when possible
// (instant), otherwise generated on the fly (same result, just slower).
export function getDailyPuzzle(day: number): GeneratedLevel {
  const raw = PUZZLE_DATA[day]
  if (raw) {
    const [head, rows] = raw.split('|')
    return {
      creature: head[0] === 'f' ? 'fire' : 'water',
      moves: Number(head.slice(1)),
      rows: rows.split('/'),
    }
  }
  return generateLevel(day, TARGET_MOVES)
}
