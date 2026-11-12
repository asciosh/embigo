import { dayNumber } from '../src/generator'
import { getDailyPuzzles } from '../src/puzzles'
import { Game, type Dir } from '../src/game'

type Env = {
  DB: D1Database
  ASSETS: Fetcher
  PIN_PEPPER?: string // optional secret that makes stored PIN hashes harder to crack
}

const MAX_FAILED_PINS = 5
const LOCK_MS = 15 * 60 * 1000
const NICK_RE = /^[A-Za-z0-9_]{3,16}$/
const PIN_RE = /^\d{4}$/

// ---------- small helpers ----------

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

const fail = (message: string, status = 400) => json({ error: message }, status)

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function randomHex(byteCount: number): string {
  return toHex(crypto.getRandomValues(new Uint8Array(byteCount)))
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text)
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', data)))
}

function hashPin(pin: string, salt: string, env: Env): Promise<string> {
  return sha256Hex(`${env.PIN_PEPPER ?? ''}:${salt}:${pin}`)
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const text = await request.text()
    if (text.length > 4096) return null
    const data: unknown = JSON.parse(text)
    return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null
  } catch {
    return null
  }
}

type Player = { id: number; nickname: string }

async function authenticate(request: Request, env: Env): Promise<Player | null> {
  const header = request.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!/^[0-9a-f]{64}$/.test(token)) return null
  const row = await env.DB.prepare(
    'SELECT p.id AS id, p.nickname AS nickname FROM sessions s JOIN players p ON p.id = s.player_id WHERE s.token_hash = ?',
  )
    .bind(await sha256Hex(token))
    .first<Player>()
  return row ?? null
}

async function createSession(env: Env, playerId: number): Promise<string> {
  const token = randomHex(32)
  await env.DB.prepare('INSERT INTO sessions (token_hash, player_id, created_at) VALUES (?, ?, ?)')
    .bind(await sha256Hex(token), playerId, Date.now())
    .run()
  return token
}

// ---------- routes ----------

async function register(request: Request, env: Env): Promise<Response> {
  const body = await readBody(request)
  const nickname = typeof body?.nickname === 'string' ? body.nickname.trim() : ''
  const pin = typeof body?.pin === 'string' ? body.pin : ''
  if (!NICK_RE.test(nickname)) return fail('Nickname: 3-16 characters, letters, numbers or _')
  if (!PIN_RE.test(pin)) return fail('PIN must be exactly 4 digits')

  const salt = randomHex(16)
  try {
    const result = await env.DB.prepare(
      'INSERT INTO players (nickname, pin_salt, pin_hash, created_at) VALUES (?, ?, ?, ?)',
    )
      .bind(nickname, salt, await hashPin(pin, salt, env), Date.now())
      .run()
    const token = await createSession(env, result.meta.last_row_id)
    return json({ token, nickname })
  } catch (e) {
    if (String(e).includes('UNIQUE')) return fail('That nickname is already taken', 409)
    throw e
  }
}

async function login(request: Request, env: Env): Promise<Response> {
  const body = await readBody(request)
  const nickname = typeof body?.nickname === 'string' ? body.nickname.trim() : ''
  const pin = typeof body?.pin === 'string' ? body.pin : ''
  if (!NICK_RE.test(nickname) || !PIN_RE.test(pin)) return fail('Wrong nickname or PIN', 401)

  const player = await env.DB.prepare(
    'SELECT id, nickname, pin_salt, pin_hash, failed_attempts, locked_until FROM players WHERE nickname = ?',
  )
    .bind(nickname)
    .first<{
      id: number
      nickname: string
      pin_salt: string
      pin_hash: string
      failed_attempts: number
      locked_until: number
    }>()
  if (!player) return fail('Wrong nickname or PIN', 401)

  const now = Date.now()
  if (player.locked_until > now) return fail('Too many wrong PINs. Try again in a few minutes.', 429)

  if ((await hashPin(pin, player.pin_salt, env)) !== player.pin_hash) {
    const attempts = player.failed_attempts + 1
    const locked = attempts >= MAX_FAILED_PINS
    await env.DB.prepare('UPDATE players SET failed_attempts = ?, locked_until = ? WHERE id = ?')
      .bind(locked ? 0 : attempts, locked ? now + LOCK_MS : 0, player.id)
      .run()
    return fail('Wrong nickname or PIN', 401)
  }

  await env.DB.prepare('UPDATE players SET failed_attempts = 0, locked_until = 0 WHERE id = ?')
    .bind(player.id)
    .run()
  return json({ token: await createSession(env, player.id), nickname: player.nickname })
}

async function logout(request: Request, env: Env): Promise<Response> {
  const header = request.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (/^[0-9a-f]{64}$/.test(token)) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run()
  }
  return json({ ok: true })
}

// The client sends the list of moves, e.g. "RDLLDL", for puzzle 1 or 2 of a day. The server
// replays them on the real puzzle, so nobody can invent a score.
async function submitScore(request: Request, env: Env): Promise<Response> {
  const player = await authenticate(request, env)
  if (!player) return fail('Please log in again', 401)

  const body = await readBody(request)
  const day = typeof body?.day === 'number' ? body.day : 0
  const idx = body?.idx === 1 || body?.idx === 2 ? body.idx : 0
  const moves = typeof body?.moves === 'string' ? body.moves : ''
  if (!idx) return fail('Invalid puzzle')
  if (!/^[UDLR]{1,300}$/.test(moves)) return fail('Invalid moves')

  const yesterday = new Date()
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  if (day !== dayNumber() && day !== dayNumber(yesterday)) return fail('That puzzle is closed')

  const puzzle = getDailyPuzzles(day)[idx - 1]
  const game = new Game(puzzle.rows, puzzle.creature)
  for (const ch of moves) {
    if (!game.move(ch as Dir)) return fail('Those moves do not match this puzzle')
  }
  if (!game.won) return fail('Those moves do not solve this puzzle')

  const now = Date.now()
  const existing = await env.DB.prepare('SELECT moves FROM scores WHERE player_id = ? AND day = ? AND idx = ?')
    .bind(player.id, day, idx)
    .first<{ moves: number }>()

  let improved = false
  if (!existing) {
    await env.DB.prepare(
      'INSERT INTO scores (player_id, day, idx, moves, par, creature, solution, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(player.id, day, idx, game.moves, puzzle.moves, puzzle.creature, moves, now)
      .run()
    improved = true
  } else if (game.moves < existing.moves) {
    await env.DB.prepare(
      'UPDATE scores SET moves = ?, solution = ?, created_at = ? WHERE player_id = ? AND day = ? AND idx = ?',
    )
      .bind(game.moves, moves, now, player.id, day, idx)
      .run()
    improved = true
  }

  const mine = await env.DB.prepare(
    'SELECT COUNT(*) AS done, SUM(moves) AS total, MAX(created_at) AS finished FROM scores WHERE player_id = ? AND day = ?',
  )
    .bind(player.id, day)
    .first<{ done: number; total: number | null; finished: number | null }>()

  const done = mine?.done ?? 0
  const bestHere = existing && !improved ? existing.moves : game.moves
  let total: number | null = null
  let rank: number | null = null
  if (done === 2 && mine?.total != null && mine.finished != null) {
    total = mine.total
    const ahead = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM (SELECT SUM(moves) AS total, MAX(created_at) AS finished FROM scores WHERE day = ? GROUP BY player_id HAVING COUNT(*) = 2) WHERE total < ? OR (total = ? AND finished < ?)',
    )
      .bind(day, total, total, mine.finished)
      .first<{ n: number }>()
    rank = (ahead?.n ?? 0) + 1
  }

  return json({ moves: bestHere, par: puzzle.moves, improved, done, total, rank })
}

// Scores of a day, ranked by total moves over both puzzles. They stay hidden until the viewer
// has finished both puzzles of that day too, so nobody sees them before playing.
async function leaderboard(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const asked = Number(url.searchParams.get('day'))
  const day = Number.isInteger(asked) && asked > 20200101 && asked < 21000101 ? asked : dayNumber()

  const finishedSets = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM (SELECT player_id FROM scores WHERE day = ? GROUP BY player_id HAVING COUNT(*) = 2)',
  )
    .bind(day)
    .first<{ n: number }>()
  const players = finishedSets?.n ?? 0

  const viewer = await authenticate(request, env)
  let unlocked = false
  if (viewer) {
    const mine = await env.DB.prepare('SELECT COUNT(*) AS n FROM scores WHERE player_id = ? AND day = ?')
      .bind(viewer.id, day)
      .first<{ n: number }>()
    unlocked = (mine?.n ?? 0) >= 2
  }
  if (!unlocked) return json({ day, locked: true, players, scores: [] })

  const { results } = await env.DB.prepare(
    `SELECT p.nickname AS nickname,
            SUM(s.moves) AS total,
            MAX(CASE WHEN s.idx = 1 THEN s.moves END) AS m1,
            MAX(CASE WHEN s.idx = 2 THEN s.moves END) AS m2,
            MAX(s.created_at) AS finished
     FROM scores s JOIN players p ON p.id = s.player_id
     WHERE s.day = ?
     GROUP BY s.player_id
     HAVING COUNT(*) = 2
     ORDER BY total ASC, finished ASC
     LIMIT 20`,
  )
    .bind(day)
    .all<{ nickname: string; total: number; m1: number; m2: number }>()

  return json({ day, locked: false, players, scores: results })
}

// ---------- entry point ----------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request)

    try {
      const route = `${request.method} ${url.pathname}`
      switch (route) {
        case 'POST /api/register':
          return await register(request, env)
        case 'POST /api/login':
          return await login(request, env)
        case 'POST /api/logout':
          return await logout(request, env)
        case 'POST /api/score':
          return await submitScore(request, env)
        case 'GET /api/leaderboard':
          return await leaderboard(request, env)
        default:
          return fail('Not found', 404)
      }
    } catch (e) {
      console.error(e)
      return fail('Something went wrong', 500)
    }
  },
}
