// Statistics tracking for user progression
import { readJson, writeJson } from './storage'

export type Stats = {
  wins: number
  totalMoves: number
  bestStreak: number
}

const STATS_KEY = 'embigo-stats'
const DEFAULT_STATS: Stats = { wins: 0, totalMoves: 0, bestStreak: 0 }

export function getStats(): Stats {
  return readJson<Stats>(STATS_KEY, DEFAULT_STATS)
}

export function updateStats(won: boolean, moves: number, streak: number): void {
  const stats = getStats()
  if (won) stats.wins++
  stats.totalMoves += moves
  if (streak > stats.bestStreak) stats.bestStreak = streak
  writeJson(STATS_KEY, stats)
}
