export type Session = { token: string; nickname: string }
export type BoardRow = { nickname: string; total: number; m1: number; m2: number }
// locked = true until the viewer has finished both daily puzzles of that day
export type Board = { day: number; locked: boolean; players: number; scores: BoardRow[] }
export type ScoreResult = {
  moves: number
  par: number
  improved: boolean
  done: number // how many of the two daily puzzles this player has finished
  total: number | null // total moves of the day, once both are finished
  rank: number | null
}

const SESSION_KEY = 'embigo-session'

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const data: unknown = JSON.parse(raw)
    if (typeof data === 'object' && data !== null && 'token' in data && 'nickname' in data) {
      const { token, nickname } = data as Record<string, unknown>
      if (typeof token === 'string' && typeof nickname === 'string') return { token, nickname }
    }
  } catch {
    // storage blocked or corrupted: treat as logged out
  }
  return null
}

export function saveSession(session: Session | null): void {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    else localStorage.removeItem(SESSION_KEY)
  } catch {
    // ignore: the player just has to log in again next time
  }
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function call<T>(path: string, options: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  const headers: Record<string, string> = {}
  if (options.body !== undefined) headers['content-type'] = 'application/json'
  if (options.token) headers.authorization = `Bearer ${options.token}`

  let response: Response
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    })
  } catch {
    throw new ApiError('Cannot reach the server', 0)
  }

  let data: unknown = null
  try {
    data = await response.json()
  } catch {
    // the answer was not JSON
  }
  if (!response.ok) {
    const message =
      typeof data === 'object' && data !== null && 'error' in data ? String((data as { error: unknown }).error) : 'Something went wrong'
    throw new ApiError(message, response.status)
  }
  return data as T
}

export const register = (nickname: string, pin: string) => call<Session>('/api/register', { method: 'POST', body: { nickname, pin } })

export const login = (nickname: string, pin: string) => call<Session>('/api/login', { method: 'POST', body: { nickname, pin } })

export const logout = (token: string) => call<{ ok: boolean }>('/api/logout', { method: 'POST', token })

export const submitScore = (day: number, idx: 1 | 2, moves: string, token: string) =>
  call<ScoreResult>('/api/score', { method: 'POST', body: { day, idx, moves }, token })

export const fetchLeaderboard = (day: number, token?: string) => call<Board>(`/api/leaderboard?day=${day}`, { token })
