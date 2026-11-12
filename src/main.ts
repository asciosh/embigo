import './style.css'
import { campaignLevel, dailyLevels, dailySeed, randomLevel, type Creature, type GeneratedLevel } from './generator'
import { Game, type Dir } from './game'
import { View } from './scene'
import { KOFI_URL } from './config'
import { CoopGame, type CoopAction, type CoopResult } from './coop'
import { coopLevel, COOP_LEVEL_COUNT } from './coop-levels'
import { RoomClient, createRoom, isRoomCode, roomPlayers, type RoomState, type SignalKey } from './online'
import { ApiError, fetchLeaderboard, loadSession, login, logout, register, saveSession, submitScore, type Board, type Session } from './api'

const canvas = document.getElementById('game') as HTMLCanvasElement
const view = new View(canvas)
const $ = (id: string) => document.getElementById(id)!

const CAMPAIGN_LEVELS = 60

// Phones that support it (Android) give a small vibration; it can be turned off in the menu
const canVibrate = 'vibrate' in navigator
function vibrate(pattern: number | number[]): void {
  if (canVibrate && vibrationOn) navigator.vibrate(pattern)
}

// Screen direction -> game direction. In portrait the board is turned, so "right" on the
// screen is "down" in the level and "down" on the screen is "right" in the level.
function toGameDir(screen: Dir): Dir {
  if (!view.isPortrait) return screen
  return { R: 'D', L: 'U', D: 'R', U: 'L' }[screen] as Dir
}

const CREATURES: Record<Creature, { name: string; power: string; color: string }> = {
  fire: { name: 'Embi', power: 'Fire sprite: burns bushes', color: '#ff7a1a' },
  water: { name: 'Drip', power: 'Water sprite: swims across lakes', color: '#3fa9ff' },
  air: { name: 'Zefi', power: 'Air sprite: hops over one obstacle', color: '#bfe3ff' },
}

type Mode =
  | { kind: 'daily'; day: number; idx: 1 | 2 }
  | { kind: 'campaign'; n: number }
  | { kind: 'random'; seed: number }

type Action = { label: string; run: () => void; primary?: boolean }

// ---------- saved progress (kept in this browser) ----------

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage can be blocked (private mode): progress is simply not saved
  }
}

type CampaignSave = { unlocked: number; stars: Record<string, number> }
type DailySave = { day: number; best: [number | null, number | null] }

const campaign: CampaignSave = readJson('embigo-campaign', { unlocked: 1, stars: {} })
let daily: DailySave = readJson('embigo-daily', { day: 0, best: [null, null] })
if (daily.day !== dailySeed()) daily = { day: dailySeed(), best: [null, null] }
let hintsOn = readJson('embigo-hints', true)
let vibrationOn = readJson('embigo-vibration', true)

// ---------- state ----------

let mode: Mode = { kind: 'campaign', n: 1 }
let game: Game
let par = 0
let busy = false
let streak = 0
let queued: Dir | null = null // one swipe made while the creature was still sliding
let session: Session | null = loadSession()
let pending: { day: number; idx: 1 | 2; moves: string }[] = []
let dailyCache: { day: number; levels: [GeneratedLevel, GeneratedLevel] } | null = null

let introOpen = false
let menuOpen = false
let boardOpen = false
let lobbyOpen = false
const overlayOpen = () => introOpen || menuOpen || boardOpen || lobbyOpen

function todayLevels(day: number): [GeneratedLevel, GeneratedLevel] {
  if (!dailyCache || dailyCache.day !== day) dailyCache = { day, levels: dailyLevels(day) }
  return dailyCache.levels
}

// ---------- toast and feedback pill ----------

function showToast(title: string, text: string, actions: Action[] = [], extra?: string): void {
  const toast = $('toast')
  toast.replaceChildren()
  const b = document.createElement('b')
  b.textContent = title
  toast.append(b)
  if (extra) {
    const stars = document.createElement('span')
    stars.className = 'stars'
    stars.textContent = extra
    toast.append(stars)
  }
  const span = document.createElement('span')
  span.textContent = text
  toast.append(span)
  if (actions.length > 0) {
    const row = document.createElement('div')
    row.className = 'actions'
    for (const a of actions) {
      const button = document.createElement('button')
      button.textContent = a.label
      if (a.primary) button.className = 'primary'
      button.addEventListener('click', a.run)
      row.append(button)
    }
    toast.append(row)
  }
  toast.classList.remove('hidden')
}

function hideToast(): void {
  $('toast').classList.add('hidden')
}

let pillTimer = 0
function showPill(text: string, kind: 'good' | 'bad' | 'info', sticky = false): void {
  const pill = $('pill')
  pill.textContent = text
  pill.className = kind
  window.clearTimeout(pillTimer)
  if (!sticky) pillTimer = window.setTimeout(hidePill, 1300)
}

function hidePill(): void {
  window.clearTimeout(pillTimer)
  $('pill').className = 'hidden'
}

// ---------- overlays ----------

const INTRO_KEY = 'embigo-intro-seen'

function openIntro(): void {
  closeMenu()
  introOpen = true
  $('intro').classList.remove('hidden')
}

function closeIntro(): void {
  introOpen = false
  $('intro').classList.add('hidden')
  try {
    localStorage.setItem(INTRO_KEY, '1')
  } catch {
    // the intro will simply show again next time
  }
}

function openMenu(): void {
  hideToast()
  menuOpen = true
  renderMenu()
  $('menu').classList.remove('hidden')
}

function closeMenu(): void {
  menuOpen = false
  $('menu').classList.add('hidden')
}

function stars(count: number): string {
  return '\u2605'.repeat(count) + '\u2606'.repeat(3 - count)
}

function starsFor(moves: number, target: number): number {
  if (moves <= target) return 3
  return moves <= target + Math.max(2, Math.ceil(target * 0.25)) ? 2 : 1
}

function renderMenu(): void {
  const [l1, l2] = todayLevels(dailySeed())
  const status = (i: 0 | 1, l: GeneratedLevel) => {
    const best = daily.best[i]
    const names = l.roster.map((c) => CREATURES[c].name).join(' + ')
    return best === null ? `${names} · not played` : `${names} · ${best} moves`
  }
  $('d1-status').textContent = status(0, l1)
  $('d2-status').textContent = status(1, l2)
  $('btn-daily1').classList.toggle('done', daily.best[0] !== null)
  $('btn-daily2').classList.toggle('done', daily.best[1] !== null)

  const cleared = Object.keys(campaign.stars).length
  $('camp-label').textContent = `Continue · Level ${campaign.unlocked}`
  $('camp-sub').textContent = `${cleared} cleared · levels get bigger and harder`

  const grid = $('levels')
  grid.replaceChildren()
  // small screens: only the levels you can play plus the next few, so the menu stays short
  const compact = window.matchMedia('(max-width: 700px), (max-height: 520px)').matches
  const all = Math.max(CAMPAIGN_LEVELS, campaign.unlocked)
  const total = compact ? Math.min(all, campaign.unlocked + 6) : all
  for (let n = 1; n <= total; n++) {
    const b = document.createElement('button')
    b.className = 'lvl' + (mode.kind === 'campaign' && mode.n === n ? ' current' : '')
    b.disabled = n > campaign.unlocked
    const s = campaign.stars[String(n)]
    b.textContent = String(n)
    const small = document.createElement('small')
    small.textContent = s ? stars(s) : ''
    b.append(small)
    b.addEventListener('click', () => {
      closeMenu()
      startMode({ kind: 'campaign', n })
    })
    grid.append(b)
  }
  $('hints-label').textContent = hintsOn ? 'Hints: on' : 'Hints: off'
  $('btn-vibe').hidden = !canVibrate
  $('vibe-label').textContent = vibrationOn ? 'Vibration: on' : 'Vibration: off'
}

// ---------- puzzles ----------

function levelFor(m: Mode): GeneratedLevel {
  if (m.kind === 'daily') return todayLevels(m.day)[m.idx - 1]
  if (m.kind === 'campaign') return campaignLevel(m.n)
  return randomLevel(m.seed)
}

const hintsActive = () => hintsOn && mode.kind !== 'daily'

function labelFor(m: Mode): string {
  if (m.kind === 'daily') return `Daily ${m.idx}`
  if (m.kind === 'campaign') return `Level ${m.n}`
  return 'Random'
}

function updateHud(): void {
  if (coopSession) {
    $('moves').textContent = String(coopSession.game.moves)
    updateCoopChips()
    return
  }
  $('moves').textContent = String(game.moves)
  updateRoster()
}

// Creature chips (only in levels with swap pads): tap one while standing on a pad to switch
function renderRoster(): void {
  const multi = game.roster.length > 1
  $('creature').hidden = multi
  $('roster').hidden = !multi
  const box = $('roster')
  box.replaceChildren()
  if (!multi) return
  game.roster.forEach((c, i) => {
    const b = document.createElement('button')
    b.className = 'rchip'
    const dot = document.createElement('i')
    dot.style.background = CREATURES[c].color
    dot.style.boxShadow = `0 0 10px ${CREATURES[c].color}`
    const name = document.createElement('span')
    name.textContent = CREATURES[c].name
    const key = document.createElement('small')
    key.textContent = String(i + 1)
    b.append(dot, name, key)
    b.addEventListener('click', () => void trySwap(i))
    box.append(b)
  })
  updateRoster()
}

function updateRoster(): void {
  if (game.roster.length < 2) return
  const onPad = game.onPad()
  Array.from($('roster').children).forEach((el, i) => {
    el.classList.toggle('active', i === game.active)
    el.classList.toggle('ready', onPad && i !== game.active)
  })
}

function startMode(m: Mode): void {
  leaveCoop()
  mode = m
  const level = levelFor(m)
  game = new Game(level.rows, level.roster)
  game.setTracking(hintsActive())
  par = level.moves
  streak = 0
  queued = null
  busy = false
  view.setLevel(game)

  const c = CREATURES[game.creature]
  $('label').textContent = labelFor(m)
  $('par').textContent = '?' // the best possible score stays hidden until the puzzle is solved
  $('cname').textContent = c.name
  $('cpower').textContent = c.power
  $('dot').style.background = c.color
  $('dot').style.boxShadow = `0 0 12px ${c.color}`
  hideToast()
  hidePill()
  renderRoster()
  updateHud()
}

function restart(): void {
  if (coopSession) {
    coopRestart()
    return
  }
  game.restart()
  view.setLevel(game)
  streak = 0
  queued = null
  busy = false
  hideToast()
  hidePill()
  renderRoster()
  updateHud()
}

const randomPuzzle = () => startMode({ kind: 'random', seed: Math.floor(Math.random() * 1e9) + 1 })

function toggleHints(): void {
  if (coopSession) return
  hintsOn = !hintsOn
  writeJson('embigo-hints', hintsOn)
  game.setTracking(hintsActive())
  if (!hintsActive()) hidePill()
  if (menuOpen) renderMenu()
}

// ---------- Ko-fi support link (a plain link: no script, no cookies) ----------

const KOFI_OK = /^https:\/\/ko-fi\.com\/[A-Za-z0-9_-]+\/?$/.test(KOFI_URL)

function openKofi(): void {
  if (KOFI_OK) window.open(KOFI_URL, '_blank', 'noopener')
}

// A gentle reminder, at most once a day: only after finishing both daily puzzles
function askForSupportToday(): boolean {
  if (!KOFI_OK) return false
  const today = dailySeed()
  if (readJson<number>('embigo-kofi-day', 0) === today) return false
  writeJson('embigo-kofi-day', today)
  return true
}

// ---------- scores ----------

function firstUnfinishedDaily(): 1 | 2 | null {
  if (daily.best[0] === null) return 1
  if (daily.best[1] === null) return 2
  return null
}

async function sendDaily(day: number, idx: 1 | 2, moves: string, title: string, base: string): Promise<void> {
  const nextActions: Action[] =
    idx === 1
      ? [{ label: 'Next puzzle', run: () => startMode({ kind: 'daily', day, idx: 2 }), primary: true }]
      : daily.best[0] === null
        ? [{ label: 'Play Daily 1', run: () => startMode({ kind: 'daily', day, idx: 1 }), primary: true }]
        : []

  if (!session) {
    pending.push({ day, idx, moves })
    showToast(title, `${base} Log in to save your scores.`, [...nextActions, { label: 'Log in', run: openBoard }])
    return
  }
  try {
    const r = await submitScore(day, idx, moves, session.token)
    pending = pending.filter((p) => !(p.day === day && p.idx === idx))
    if (r.done === 2 && r.rank !== null && r.total !== null) {
      const actions: Action[] = [{ label: 'Leaderboard', run: openBoard, primary: true }]
      if (askForSupportToday()) actions.push({ label: '\u2615 Support', run: openKofi })
      showToast(title, `${base} Total today: ${r.total} moves. You are #${r.rank}.`, actions)
    } else {
      const more = idx === 1 ? 'Finish Daily 2 to see the leaderboard.' : 'Finish Daily 1 to see the leaderboard.'
      showToast(title, `${base} Saved. ${more}`, nextActions)
    }
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      session = null
      saveSession(null)
      pending.push({ day, idx, moves })
      showToast(title, `${base} Please log in again to save your scores.`, [...nextActions, { label: 'Log in', run: openBoard }])
    } else {
      const reason = e instanceof Error ? e.message : 'unknown error'
      showToast(title, `${base} Could not save the score: ${reason}.`, [
        { label: 'Try again', run: () => void sendDaily(day, idx, moves, title, base), primary: true },
        ...nextActions,
      ])
    }
  }
}

async function onWin(): Promise<void> {
  view.celebrate()
  $('par').textContent = String(par) // now the best possible score is revealed
  const c = CREATURES[game.creature]
  const title = `${c.name} made it!`
  const base = game.moves <= par ? `${game.moves} moves: perfect!` : `${game.moves} moves (par ${par}).`

  if (mode.kind === 'daily') {
    const { day, idx } = mode
    const best = daily.best[idx - 1]
    if (best === null || game.moves < best) daily.best[idx - 1] = game.moves
    writeJson('embigo-daily', daily)
    showToast(title, base)
    await sendDaily(day, idx, game.history.join(''), title, base)
  } else if (mode.kind === 'campaign') {
    const n = mode.n
    const s = starsFor(game.moves, par)
    const key = String(n)
    campaign.stars[key] = Math.max(campaign.stars[key] ?? 0, s)
    campaign.unlocked = Math.max(campaign.unlocked, n + 1)
    writeJson('embigo-campaign', campaign)
    showToast(title, `${base} Level ${n} cleared.`, [{ label: 'Next level', run: () => startMode({ kind: 'campaign', n: n + 1 }), primary: true }], stars(s))
  } else {
    showToast(title, `${base} Press N for another random puzzle.`, [{ label: 'New puzzle', run: randomPuzzle, primary: true }])
  }
}

async function trySwap(index: number): Promise<void> {
  if (coopSession || overlayOpen() || busy || index === game.active || index >= game.roster.length) return
  if (!game.onPad()) {
    showPill('Stop on a swap pad to switch', 'bad')
    return
  }
  const res = game.swapTo(index)
  if (!res) return
  queued = null
  updateHud()
  view.swapModel(game)
  vibrate(25)
  if (res.deadEnd) {
    streak = 0
    view.sparkle('bad')
    showPill('Dead end: press R to restart', 'bad', true)
  } else if (res.optimal === true) {
    streak++
    view.sparkle('good')
    showPill(streak > 1 ? `Best move! x${streak}` : 'Best move!', 'good')
  } else if (res.optimal === false) {
    streak = 0
    hidePill()
  }
}

async function tryMove(dir: Dir, buffered = false): Promise<void> {
  if (coopSession || overlayOpen()) return
  if (busy) {
    if (buffered) queued = dir // a quick second swipe is played right after the current slide
    return
  }
  const res = game.move(dir)
  if (!res) return
  busy = true
  updateHud()
  await view.animateMove(res)
  busy = false
  updateRoster()
  vibrate(res.burned ? 25 : res.jumped ? 15 : 8)

  if (res.won) {
    queued = null
    hidePill()
    vibrate([20, 40, 20, 40, 90])
    await onWin()
    return
  }
  if (res.deadEnd) {
    streak = 0
    view.sparkle('bad')
    showPill('Dead end: press R to restart', 'bad', true)
    vibrate([30, 50, 30])
  } else if (res.optimal === true) {
    streak++
    view.sparkle('good')
    showPill(streak > 1 ? `Best move! x${streak}` : 'Best move!', 'good')
    vibrate(20)
  } else if (res.optimal === false) {
    streak = 0
    hidePill()
  }

  if (queued) {
    const next = queued
    queued = null
    void tryMove(next, true)
  }
}

// ---------- leaderboard window ----------

function formatDay(day: number): string {
  const d = new Date(Date.UTC(Math.floor(day / 10000), (Math.floor(day / 100) % 100) - 1, day % 100))
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

function renderBoard(board: Board): void {
  const list = $('board-list')
  list.replaceChildren()

  if (board.locked) {
    $('board-sub').textContent = formatDay(board.day)
    const li = document.createElement('li')
    li.className = 'locked'
    li.textContent =
      board.players > 0
        ? `${board.players} ${board.players === 1 ? 'player has' : 'players have'} finished today. Finish both daily puzzles to see the scores.`
        : 'Finish both daily puzzles to see the scores. Nobody has finished yet: be the first!'
    list.append(li)
    return
  }

  $('board-sub').textContent = `${formatDay(board.day)} · total moves over both puzzles`
  if (board.scores.length === 0) {
    const li = document.createElement('li')
    li.className = 'empty'
    li.textContent = 'No scores yet.'
    list.append(li)
    return
  }
  board.scores.forEach((row, i) => {
    const li = document.createElement('li')
    if (session && session.nickname.toLowerCase() === row.nickname.toLowerCase()) li.className = 'me'
    const rank = document.createElement('span')
    rank.className = 'rank'
    rank.textContent = String(i + 1)
    const name = document.createElement('span')
    name.className = 'name'
    name.textContent = row.nickname
    const detail = document.createElement('span')
    detail.className = 'detail'
    detail.textContent = `${row.m1} + ${row.m2}`
    const total = document.createElement('span')
    total.className = 'mv'
    total.textContent = `${row.total} moves`
    li.append(rank, name, detail, total)
    list.append(li)
  })
}

let boardRequest = 0 // only the answer of the latest request is shown: a slow old one is ignored
async function refreshBoard(): Promise<void> {
  const mine = ++boardRequest
  try {
    const board = await fetchLeaderboard(dailySeed(), session?.token)
    if (mine === boardRequest) renderBoard(board)
  } catch {
    if (mine !== boardRequest) return
    $('board-sub').textContent = ''
    const li = document.createElement('li')
    li.className = 'empty'
    li.textContent = 'Could not load the leaderboard.'
    $('board-list').replaceChildren(li)
  }
}

function updateAuthUi(): void {
  $('auth-out').classList.toggle('hidden', session !== null)
  $('auth-in').classList.toggle('hidden', session === null)
  $('me').textContent = session?.nickname ?? ''
  $('auth-error').textContent = ''
}

function openBoard(): void {
  closeMenu()
  hideToast()
  boardOpen = true
  $('board').classList.remove('hidden')
  updateAuthUi()
  void refreshBoard()
}

function closeBoard(): void {
  boardOpen = false
  $('board').classList.add('hidden')
  ;($('pin') as HTMLInputElement).value = ''
}

async function authenticate(kind: 'login' | 'register'): Promise<void> {
  const nickname = ($('nick') as HTMLInputElement).value.trim()
  const pin = ($('pin') as HTMLInputElement).value.trim()
  $('auth-error').textContent = ''
  try {
    session = await (kind === 'login' ? login(nickname, pin) : register(nickname, pin))
    saveSession(session)
    ;($('pin') as HTMLInputElement).value = ''
    updateAuthUi()
    // scores won before logging in are saved now
    const waiting = pending
    pending = []
    for (const p of waiting) await submitScore(p.day, p.idx, p.moves, session.token)
    await refreshBoard()
  } catch (e) {
    $('auth-error').textContent = e instanceof Error ? e.message : 'Something went wrong'
  }
}

async function doLogout(): Promise<void> {
  const token = session?.token
  session = null
  saveSession(null)
  updateAuthUi()
  void refreshBoard()
  if (token) {
    try {
      await logout(token)
    } catch {
      // the local session is already gone: nothing else to do
    }
  }
}


// ---------- co-op: two creatures, two players, taking turns ----------

type CoopSession = {
  game: CoopGame
  n: number
  online: RoomClient | null
  you: 0 | 1 | null // which player you are in an online room (null: one phone, both play)
  names: [string, string]
  partnerOnline: boolean
}

let coopSession: CoopSession | null = null
let roomClient: RoomClient | null = null
let coopUnlocked: number = readJson('embigo-coop', 1)
let coopPick = Math.min(coopUnlocked, COOP_LEVEL_COUNT)
let coopBusy = false
let netQueue: string[] = []
let draining = false

const SIGNALS: Record<SignalKey, string> = {
  hi: '\u{1F44B} Hi!',
  wait: '\u270B Wait',
  go: '\u{1F449} Go!',
  oops: '\u{1F605} Oops',
  nice: '\u{1F389} Nice!',
}

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))

// Swipes and arrow keys: in co-op they move the creature of the player whose turn it is
function inputDir(dir: Dir, buffered = false): void {
  if (coopSession) void coopMove(dir)
  else void tryMove(dir, buffered)
}

function leaveCoop(): void {
  roomClient?.close()
  roomClient = null
  coopSession = null
  netQueue = []
  coopBusy = false
  $('coopbar').hidden = true
  hidePill()
}

function loadCoop(n: number, online: RoomClient | null, you: 0 | 1 | null, names: [string, string], history = '', partnerOnline = true): void {
  closeLobby()
  closeMenu()
  const level = coopLevel(n)
  const g = new CoopGame(level.rows, level.roster)
  g.replay(history)
  const session: CoopSession = { game: g, n, online, you, names, partnerOnline }
  coopSession = session
  mode = { kind: 'random', seed: 0 } // not a normal puzzle: the menu does not mark any level as current
  par = level.par
  queued = null
  busy = false
  coopBusy = false
  netQueue = []
  view.setCoopLevel(g)
  $('label').textContent = `Co-op ${n}`
  $('par').textContent = g.won ? String(par) : '?'
  $('coopbar').hidden = false
  $('signals').hidden = online === null
  renderCoopChips(session)
  hideToast()
  hidePill()
  updateHud()
  if (g.won) coopWin(session)
  else announceTurn(session)
}

function renderCoopChips(s: CoopSession): void {
  $('creature').hidden = true
  const box = $('roster')
  box.hidden = false
  box.replaceChildren()
  for (const i of [0, 1] as const) {
    const c = CREATURES[s.game.roster[i]]
    const chip = document.createElement('button')
    chip.className = 'rchip static'
    chip.tabIndex = -1
    const dot = document.createElement('i')
    dot.style.background = c.color
    dot.style.boxShadow = `0 0 10px ${c.color}`
    const label = document.createElement('span')
    const who = s.online ? (s.you === i ? 'You' : s.names[i]) : `Player ${i + 1}`
    label.textContent = `${who} \u00B7 ${c.name}`
    chip.append(dot, label)
    box.append(chip)
  }
  updateCoopChips()
}

function updateCoopChips(): void {
  const s = coopSession
  if (!s) return
  Array.from($('roster').children).forEach((el, i) => {
    el.classList.toggle('active', s.game.turn === i && !s.game.won)
    el.classList.toggle('away', s.online !== null && i !== s.you && !s.partnerOnline)
  })
}

function announceTurn(s: CoopSession): void {
  const who = s.game.turn
  if (!s.online) showPill(`Player ${who + 1}'s turn`, 'info')
  else if (who === s.you) showPill('Your turn', 'info')
  else showPill(`Waiting for ${s.names[who]}`, 'info')
}

async function coopMove(action: CoopAction): Promise<void> {
  const s = coopSession
  if (!s || coopBusy || overlayOpen() || s.game.won) return
  if (s.online && s.game.turn !== s.you) {
    showPill(`Wait for ${s.names[s.game.turn]}`, 'bad')
    return
  }
  const res = s.game.move(action)
  if (!res) return // a slide that goes nowhere
  s.online?.send({ t: 'move', a: action })
  await playCoopResult(s, res)
}

async function playCoopResult(s: CoopSession, res: CoopResult): Promise<void> {
  coopBusy = true
  updateHud()
  await view.animateMove(res, res.player)
  coopBusy = false
  if (coopSession !== s) return
  vibrate(res.burned ? 25 : res.jumped ? 15 : 8)
  updateHud()
  if (res.won) {
    hidePill()
    vibrate([20, 40, 20, 40, 90])
    view.celebrate()
    coopWin(s)
    return
  }
  announceTurn(s)
}

function coopRestart(): void {
  const s = coopSession
  if (!s) return
  if (s.online) s.online.send({ t: 'restart' }) // the room tells both players
  else loadCoop(s.n, null, null, s.names)
}

function coopWin(s: CoopSession): void {
  $('par').textContent = String(par)
  coopUnlocked = Math.max(coopUnlocked, s.n + 1)
  writeJson('embigo-coop', coopUnlocked)
  const moves = s.game.moves
  const text = moves <= par ? `${moves} moves: perfect teamwork!` : `${moves} moves (par ${par}).`
  const next: Action = s.online
    ? { label: 'Next level', primary: true, run: () => s.online?.send({ t: 'next' }) }
    : { label: 'Next level', primary: true, run: () => loadCoop(s.n + 1 > COOP_LEVEL_COUNT ? 1 : s.n + 1, null, null, s.names) }
  showToast('Level cleared!', text, [next], stars(starsFor(moves, par)))
}

// ---------- co-op online: what the room tells us ----------

function onRoomState(st: RoomState): void {
  const names: [string, string] = [st.players[0]?.name ?? 'Player 1', st.players[1]?.name ?? 'Player 2']
  const other = (1 - st.you) as 0 | 1
  const partnerOnline = !!st.players[other]?.online
  renderLobbyRoom(st)

  const s = coopSession
  if (!s) {
    // both players are in the room: the game starts
    if (st.players[0] && st.players[1] && roomClient) loadCoop(st.level, roomClient, st.you, names, st.history, partnerOnline)
    return
  }
  const wasOnline = s.partnerOnline
  s.names = names
  s.you = st.you
  s.partnerOnline = partnerOnline
  if (wasOnline && !partnerOnline) showPill(`${names[other]} disconnected. Waiting...`, 'info', true)
  else if (!wasOnline && partnerOnline) showPill(`${names[other]} is back`, 'info')
  renderCoopChips(s)
  syncHistory(s, st)
}

// Bring our game in line with the room: play the partner's moves, or rebuild after a restart
function syncHistory(s: CoopSession, st: RoomState): void {
  if (st.level !== s.n) {
    loadCoop(st.level, s.online, st.you, s.names, st.history, s.partnerOnline)
    return
  }
  const local = s.game.history.join('')
  if (st.history === local) return
  if (st.history.startsWith(local)) {
    netQueue.push(...st.history.slice(local.length))
    void drainNet()
    return
  }
  loadCoop(st.level, s.online, st.you, s.names, st.history, s.partnerOnline)
}

async function drainNet(): Promise<void> {
  if (draining) return
  draining = true
  while (netQueue.length > 0) {
    const s = coopSession
    if (!s) break
    if (coopBusy) {
      await sleep(30)
      continue
    }
    const action = netQueue.shift() as CoopAction
    const res = s.game.move(action)
    if (res) await playCoopResult(s, res)
  }
  draining = false
}

let bubbleTimer = 0
function showBubble(text: string): void {
  const bubble = $('bubble')
  bubble.textContent = text
  bubble.classList.remove('hidden')
  window.clearTimeout(bubbleTimer)
  bubbleTimer = window.setTimeout(() => bubble.classList.add('hidden'), 2600)
}

function sendSignal(key: SignalKey): void {
  if (!coopSession?.online) return
  coopSession.online.send({ t: 'signal', k: key })
  showBubble(`You: ${SIGNALS[key]}`)
  vibrate(10)
}

// ---------- co-op lobby (create, join, share the code) ----------

function setLobbyError(text: string): void {
  $('lobby-error').textContent = text
}

function openLobby(): void {
  closeMenu()
  hideToast()
  lobbyOpen = true
  $('lobby').classList.remove('hidden')
  const input = $('coop-name') as HTMLInputElement
  if (!input.value) input.value = readJson<string>('embigo-name', '') || session?.nickname || ''
  setLobbyError('')
  renderLobby()
}

function closeLobby(): void {
  lobbyOpen = false
  $('lobby').classList.add('hidden')
}

function renderLobby(): void {
  const inRoom = roomClient !== null
  $('lobby-start').hidden = inRoom
  $('lobby-room').hidden = !inRoom
  $('coop-level').textContent = String(coopPick)
  if (roomClient) $('room-code').textContent = roomClient.code
}

function renderLobbyRoom(st: RoomState): void {
  const list = $('room-players')
  list.replaceChildren()
  st.players.forEach((p, i) => {
    const li = document.createElement('li')
    const dot = document.createElement('i')
    dot.className = p?.online ? 'on' : 'off'
    const name = document.createElement('span')
    name.textContent = p ? `${p.name}${i === st.you ? ' (you)' : ''}` : 'Waiting for a friend...'
    li.append(dot, name)
    list.append(li)
  })
  $('room-status').textContent = st.players[0] && st.players[1] ? 'Both players are here!' : 'Send the code to your friend.'
}

function lobbyName(): string {
  const typed = ($('coop-name') as HTMLInputElement).value.trim()
  writeJson('embigo-name', typed)
  return typed || session?.nickname || 'Player'
}

function joinRoom(code: string): void {
  roomClient?.close()
  const client = new RoomClient(code, lobbyName(), coopPick, {
    onState: onRoomState,
    onSignal: (_from, name, key) => {
      showBubble(`${name}: ${SIGNALS[key]}`)
      vibrate(15)
    },
    onError: (message) => {
      if (lobbyOpen) setLobbyError(message)
      else showPill(message, 'bad')
      if (message === 'This room is full' && roomClient === client) {
        client.close()
        roomClient = null
        renderLobby()
      }
    },
    onStatus: (status) => {
      if (!coopSession) return
      if (status === 'offline') showPill('Connection lost. Reconnecting...', 'bad', true)
      else if (status === 'online') hidePill()
    },
  })
  roomClient = client
  setLobbyError('')
  renderLobby()
  client.connect()
}

async function onCreateRoom(): Promise<void> {
  setLobbyError('')
  try {
    joinRoom(await createRoom())
  } catch (e) {
    setLobbyError(e instanceof Error ? e.message : 'Could not create the room')
  }
}

async function onJoinRoom(): Promise<void> {
  const code = ($('coop-code') as HTMLInputElement).value.trim().toUpperCase()
  if (!isRoomCode(code)) {
    setLobbyError('A room code has 5 letters, like XHPNT')
    return
  }
  try {
    if ((await roomPlayers(code)) === 0) {
      setLobbyError('Room not found. Check the code with your friend.')
      return
    }
    joinRoom(code)
  } catch (e) {
    setLobbyError(e instanceof Error ? e.message : 'Could not join the room')
  }
}

function leaveRoom(): void {
  const playing = coopSession !== null
  roomClient?.close()
  roomClient = null
  if (playing) startMode({ kind: 'campaign', n: campaign.unlocked })
  setLobbyError('')
  renderLobby()
}

async function shareRoom(copyOnly: boolean): Promise<void> {
  if (!roomClient) return
  const url = `${window.location.origin}/?room=${roomClient.code}`
  if (!copyOnly && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: 'Embigo co-op', text: 'Join my Embigo room!', url })
      return
    } catch {
      return // the player closed the share sheet
    }
  }
  try {
    await navigator.clipboard.writeText(url)
    $('btn-copy-code').textContent = 'Copied!'
  } catch {
    $('btn-copy-code').textContent = url
  }
  window.setTimeout(() => ($('btn-copy-code').textContent = 'Copy link'), 1800)
}


// ---------- input ----------

const KEYS: Record<string, Dir> = {
  ArrowUp: 'U', ArrowDown: 'D', ArrowLeft: 'L', ArrowRight: 'R',
  w: 'U', s: 'D', a: 'L', d: 'R',
}

function closeTopOverlay(): void {
  if (lobbyOpen) closeLobby()
  else if (boardOpen) closeBoard()
  else if (menuOpen) closeMenu()
  else if (introOpen) closeIntro()
}

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) {
    if (e.key === 'Enter') void authenticate('login')
    else if (e.key === 'Escape') closeTopOverlay()
    return
  }
  if (overlayOpen()) {
    if (e.key === 'Escape') closeTopOverlay()
    else if (introOpen && (e.key === 'Enter' || e.key === ' ')) closeIntro()
    return
  }
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
  const dir = KEYS[key]
  if (dir) {
    e.preventDefault()
    inputDir(toGameDir(dir))
  } else if (key === 'p' && coopSession) void coopMove('P')
  else if (key === 'r') restart()
  else if (key === 'm') openMenu()
  else if (key === 'n') randomPuzzle()
  else if (key === 'l') openBoard()
  else if (key === 'h') toggleHints()
  else if (key === '1' || key === '2' || key === '3') void trySwap(Number(key) - 1)
})

// Swipe on the board: the move starts as soon as the finger has moved a little,
// without waiting for it to be lifted.
let swipe: { id: number; x: number; y: number; done: boolean } | null = null
canvas.addEventListener('pointerdown', (e) => {
  if (overlayOpen()) return
  swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, done: false }
  try {
    canvas.setPointerCapture(e.pointerId)
  } catch {
    // not supported everywhere: the swipe still works while the finger stays on the canvas
  }
})
canvas.addEventListener('pointermove', (e) => {
  if (!swipe || swipe.done || e.pointerId !== swipe.id) return
  const dx = e.clientX - swipe.x
  const dy = e.clientY - swipe.y
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 28) return
  swipe.done = true
  const screen: Dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'R' : 'L') : dy > 0 ? 'D' : 'U'
  inputDir(toGameDir(screen), true)
})
const endSwipe = () => {
  swipe = null
}
canvas.addEventListener('pointerup', endSwipe)
canvas.addEventListener('pointercancel', endSwipe)
canvas.addEventListener('contextmenu', (e) => e.preventDefault())

$('btn-menu').addEventListener('click', openMenu)
$('btn-restart').addEventListener('click', restart)
$('menu-close').addEventListener('click', closeMenu)
$('btn-play').addEventListener('click', closeIntro)
$('btn-help').addEventListener('click', openIntro)
$('btn-hints').addEventListener('click', toggleHints)
$('btn-vibe').addEventListener('click', () => {
  vibrationOn = !vibrationOn
  writeJson('embigo-vibration', vibrationOn)
  vibrate(30)
  renderMenu()
})
$('btn-random').addEventListener('click', () => {
  closeMenu()
  randomPuzzle()
})
$('btn-board').addEventListener('click', openBoard)
$('board-close').addEventListener('click', closeBoard)
$('btn-daily1').addEventListener('click', () => {
  closeMenu()
  startMode({ kind: 'daily', day: dailySeed(), idx: 1 })
})
$('btn-daily2').addEventListener('click', () => {
  closeMenu()
  startMode({ kind: 'daily', day: dailySeed(), idx: 2 })
})
$('btn-campaign').addEventListener('click', () => {
  closeMenu()
  startMode({ kind: 'campaign', n: campaign.unlocked })
})
$('btn-login').addEventListener('click', () => void authenticate('login'))
$('btn-register').addEventListener('click', () => void authenticate('register'))
$('btn-logout').addEventListener('click', () => void doLogout())


if (KOFI_OK) {
  const button = document.createElement('button')
  button.id = 'btn-kofi'
  button.className = 'mode wide'
  const title = document.createElement('b')
  title.textContent = '\u2615 Support Embigo'
  const hint = document.createElement('span')
  hint.textContent = 'Buy me a coffee on Ko-fi'
  button.append(title, hint)
  button.addEventListener('click', openKofi)
  const row = document.createElement('div')
  row.className = 'row'
  row.append(button)
  $('btn-vibe').parentElement?.insertAdjacentElement('afterend', row)
}

$('btn-coop').addEventListener('click', openLobby)
$('lobby-close').addEventListener('click', closeLobby)
$('btn-coop-local').addEventListener('click', () => loadCoop(coopPick, null, null, ['Player 1', 'Player 2']))
$('btn-coop-create').addEventListener('click', () => void onCreateRoom())
$('btn-coop-join').addEventListener('click', () => void onJoinRoom())
$('btn-leave-room').addEventListener('click', leaveRoom)
$('btn-copy-code').addEventListener('click', () => void shareRoom(true))
$('btn-share-code').addEventListener('click', () => void shareRoom(false))
$('btn-pass').addEventListener('click', () => void coopMove('P'))
$('coop-minus').addEventListener('click', () => {
  coopPick = Math.max(1, coopPick - 1)
  renderLobby()
})
$('coop-plus').addEventListener('click', () => {
  coopPick = Math.min(Math.min(coopUnlocked, COOP_LEVEL_COUNT), coopPick + 1)
  renderLobby()
})
$('signals').addEventListener('click', (e) => {
  const key = (e.target as HTMLElement).closest('button')?.dataset.k
  if (key) sendSignal(key as SignalKey)
})
$('coop-code').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') void onJoinRoom()
})

// ---------- start ----------

let seen = false
try {
  seen = localStorage.getItem(INTRO_KEY) === '1'
} catch {
  seen = false
}

// ?seed=123 opens a specific random puzzle (handy to share one with friends)
const seedParam = Number(new URLSearchParams(window.location.search).get('seed'))
if (Number.isInteger(seedParam) && seedParam > 0) {
  startMode({ kind: 'random', seed: seedParam })
} else if (!seen) {
  startMode({ kind: 'campaign', n: 1 }) // new players start with an easy campaign level
} else {
  const next = firstUnfinishedDaily()
  startMode(next ? { kind: 'daily', day: dailySeed(), idx: next } : { kind: 'campaign', n: campaign.unlocked })
}
if (!seen) openIntro()

// A link like /?room=XHPNT opens the co-op lobby with the code already filled in
const roomParam = (new URLSearchParams(window.location.search).get('room') ?? '').toUpperCase()
if (isRoomCode(roomParam)) {
  closeIntro()
  openLobby()
  ;($('coop-code') as HTMLInputElement).value = roomParam
}
