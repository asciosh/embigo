import './style.css'
import { campaignLevel, dailyLevels, dailySeed, randomLevel, type Creature, type GeneratedLevel } from './generator'
import { Game, type Dir } from './game'
import { View } from './scene'
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
const overlayOpen = () => introOpen || menuOpen || boardOpen

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
function showPill(text: string, kind: 'good' | 'bad', sticky = false): void {
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
  hintsOn = !hintsOn
  writeJson('embigo-hints', hintsOn)
  game.setTracking(hintsActive())
  if (!hintsActive()) hidePill()
  if (menuOpen) renderMenu()
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
      showToast(title, `${base} Total today: ${r.total} moves. You are #${r.rank}.`, [
        { label: 'Leaderboard', run: openBoard, primary: true },
      ])
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
  if (overlayOpen() || busy || index === game.active || index >= game.roster.length) return
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
  if (overlayOpen()) return
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

async function refreshBoard(): Promise<void> {
  try {
    renderBoard(await fetchLeaderboard(dailySeed(), session?.token))
  } catch {
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

// ---------- input ----------

const KEYS: Record<string, Dir> = {
  ArrowUp: 'U', ArrowDown: 'D', ArrowLeft: 'L', ArrowRight: 'R',
  w: 'U', s: 'D', a: 'L', d: 'R',
}

function closeTopOverlay(): void {
  if (boardOpen) closeBoard()
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
    void tryMove(toGameDir(dir))
  } else if (key === 'r') restart()
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
  void tryMove(toGameDir(screen), true)
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
