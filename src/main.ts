import './style.css'
import { campaignLevel, dailyLevels, dailySeed, randomLevel, type Creature, type GeneratedLevel } from './generator'
import { Game, type Dir } from './game'
import { View } from './scene'
import { KOFI_URL } from './config'
import { CoopGame, type CoopAction, type CoopResult } from './coop'
import { coopLevel, COOP_LEVEL_COUNT } from './coop-levels'
import { RoomClient, createRoom, isRoomCode, roomPlayers, type RoomState, type SignalKey } from './online'
import { KIND_LABEL, RELICS, budgetFor, canUndo, clearFloor, failFloor, floorKind, newRun, pickRelic, rogueCoopLevel, rogueLevel, skipFloor, useUndo, type RunState } from './rogue'
import { ApiError, fetchLeaderboard, loadSession, login, logout, register, saveSession, submitScore, type Board, type Session } from './api'
import { initAudioOnGesture, sfxMove, sfxBurn, sfxJump, sfxWin, sfxDeadEnd, sfxRelic, sfxFail, sfxShield, sfxPerfect, getAudioState, setAudio, isAudioOn } from './audio'
import { readJson, writeJson } from './storage'
import { updateStats } from './stats'

const canvas = document.getElementById('game') as HTMLCanvasElement
// a soft dark vignette on the edges of the screen (cheap, drawn by the browser, not the GPU scene)
const vignette = document.createElement('div')
vignette.id = 'vignette'
canvas.insertAdjacentElement('afterend', vignette)
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
let mirrorNow = false // roguelike mirror floors: left and right are swapped
function toGameDir(screen: Dir): Dir {
  if (mirrorNow) screen = ({ L: 'R', R: 'L', U: 'U', D: 'D' } as Record<Dir, Dir>)[screen]
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
  | { kind: 'rogue' }

type Action = { label: string; run: () => void; primary?: boolean }

// ---------- saved progress (kept in this browser) ----------

type CampaignSave = { unlocked: number; stars: Record<string, number> }
type DailySave = { day: number; best: [number | null, number | null] }

const campaign: CampaignSave = readJson('embigo-campaign', { unlocked: 1, stars: {} })
let daily: DailySave = readJson('embigo-daily', { day: 0, best: [null, null] })
if (daily.day !== dailySeed()) daily = { day: dailySeed(), best: [null, null] }
let hintsOn = readJson('embigo-hints', true)
let vibrationOn = readJson('embigo-vibration', true)

// ---------- state ----------

let mode: Mode = { kind: 'campaign', n: 1 }
const ROGUE_SAVE = 'embigo-rogue-solo'
let rogue: RunState | null = readJson<RunState | null>(ROGUE_SAVE, null)
const rogueBest = readJson<{ solo: number; coop: number }>('embigo-rogue-best', { solo: 0, coop: 0 })
let rogueOpen = false
let rogueDismiss = false
let rogueLocked = false // after a failed floor, moves are blocked until you retry
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
let audioInitialized = false
const overlayOpen = () => introOpen || menuOpen || boardOpen || lobbyOpen || rogueOpen

function ensureAudio(): void {
  if (!audioInitialized) {
    audioInitialized = true
    initAudioOnGesture()
  }
}

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
  const gfx = document.getElementById('gfx-label')
  if (gfx) gfx.textContent = `Graphics: ${view.qualityLabel()}`
  $('btn-vibe').hidden = !canVibrate
  $('vibe-label').textContent = vibrationOn ? 'Vibration: on' : 'Vibration: off'
  const audioState = getAudioState()
  $('audio-label').textContent = (audioState.sfx && audioState.music) ? 'Audio: on' : 'Audio: off'
}

// ---------- puzzles ----------

function levelFor(m: Mode): GeneratedLevel {
  if (m.kind === 'daily') return todayLevels(m.day)[m.idx - 1]
  if (m.kind === 'campaign') return campaignLevel(m.n)
  if (m.kind === 'rogue') return rogueLevel(rogue ?? newRun(1, false))
  return randomLevel(m.seed)
}

const hintsActive = () => (mode.kind === 'rogue' ? !!rogue?.oracle : hintsOn && mode.kind !== 'daily')

function labelFor(m: Mode): string {
  if (m.kind === 'daily') return `Daily ${m.idx}`
  if (m.kind === 'campaign') return `Level ${m.n}`
  if (m.kind === 'rogue') return `Floor ${rogue?.floor ?? 1}`
  return 'Random'
}

function updateHud(): void {
  const r = runNow()
  if (coopSession) {
    $('moves').textContent = r ? `${coopSession.game.moves}/${budgetNow()}` : String(coopSession.game.moves)
    updateCoopChips()
    if (r) rogueUiRefresh()
    return
  }
  $('moves').textContent = r ? `${game.moves}/${budgetNow()}` : String(game.moves)
  if (r) rogueUiRefresh()
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
  rogueLocked = false
  hideToast()
  hidePill()
  renderRoster()
  updateHud()
  rogueUiRefresh()
  if (mirrorNow) showPill('Mirror floor: left and right are swapped', 'info')
}

function restart(): void {
  if (runNow()) {
    rogueRestart()
    return
  }
  if (coopSession) {
    coopRestart()
    return
  }
  game.restart()
  view.setLevel(game, false)
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
  if (coopSession || mode.kind === 'rogue') return
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
  updateStats(true, game.moves, streak)
  view.celebrate()
  if (mode.kind === 'rogue' && rogue) {
    await rogueSoloWin()
    return
  }
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
  if (coopSession || overlayOpen() || rogueLocked || busy || index === game.active || index >= game.roster.length) return
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
  if (mode.kind === 'rogue' && rogue && game.moves > budgetNow()) {
    await rogueFail('You ran out of moves.')
    return
  }
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
  if (coopSession || overlayOpen() || rogueLocked) return
  if (busy) {
    if (buffered) queued = dir // a quick second swipe is played right after the current slide
    return
  }
  const res = game.move(dir)
  if (!res) return
  ensureAudio()
  busy = true
  updateHud()
  await view.animateMove(res)
  busy = false
  updateRoster()
  vibrate(res.burned ? 25 : res.jumped ? 15 : 8)
  // Sound effects
  if (res.burned) sfxBurn()
  else if (res.jumped) sfxJump()
  else sfxMove()

  if (mode.kind === 'rogue' && rogue && game.moves > budgetNow()) {
    await rogueFail('You ran out of moves.')
    return
  }
  if (res.won) {
    queued = null
    hidePill()
    vibrate([20, 40, 20, 40, 90])
    sfxWin()
    await onWin()
    return
  }
  if (res.deadEnd) {
    streak = 0
    view.sparkle('bad')
    view.setMood('worried', 4)
    showPill('Dead end: press R to restart', 'bad', true)
    vibrate([30, 50, 30])
    sfxDeadEnd()
  } else if (res.optimal === true) {
    streak++
    view.sparkle('good')
    view.setMood('happy', 1.4)
    showPill(streak > 1 ? `Best move! x${streak}` : 'Best move!', 'good')
    vibrate(20)
    sfxPerfect()
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
  run: RunState | null // roguelike run (null in the normal co-op levels)
}

let lastEvId = 0
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

function loadCoop(n: number, online: RoomClient | null, you: 0 | 1 | null, names: [string, string], history = '', partnerOnline = true, run: RunState | null = null): void {
  closeLobby()
  closeMenu()
  hideRogue()
  rogueLocked = false
  const level = run ? rogueCoopLevel(run) : coopLevel(n)
  const g = new CoopGame(level.rows, level.roster)
  g.replay(history)
  const session: CoopSession = { game: g, n, online, you, names, partnerOnline, run }
  coopSession = session
  mode = { kind: 'random', seed: 0 } // not a normal puzzle: the menu does not mark any level as current
  par = level.par
  queued = null
  busy = false
  coopBusy = false
  netQueue = []
  view.setCoopLevel(g)
  $('label').textContent = run ? `Floor ${run.floor}` : `Co-op ${n}`
  $('par').textContent = g.won && !run ? String(par) : '?'
  $('coopbar').hidden = false
  $('signals').hidden = online === null
  renderCoopChips(session)
  hideToast()
  hidePill()
  updateHud()
  rogueUiRefresh()
  if (run) {
    if (!g.won) announceTurn(session)
    if (mirrorNow) showPill('Mirror floor: left and right are swapped', 'info')
    maybeCoopCards(session)
  } else if (g.won) coopWin(session)
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
  if (!s || coopBusy || overlayOpen() || rogueLocked || s.game.won) return
  if (s.run && s.run.phase !== 'play') return
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
  if (s.run && !s.online && s.game.moves > budgetFor(s.run, par)) {
    localCoopFail(s, 'You ran out of moves.')
    return
  }
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
  if (s.run) {
    if (!s.online && s.run.phase === 'play') clearFloor(s.run)
    updateHud()
    maybeCoopCards(s)
    return
  }
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
    if (st.players[0] && st.players[1] && roomClient) {
      lastEvId = st.ev?.id ?? 0
      loadCoop(st.level, roomClient, st.you, names, st.history, partnerOnline, st.run ?? null)
    }
    return
  }
  const wasOnline = s.partnerOnline
  s.names = names
  s.you = st.you
  s.partnerOnline = partnerOnline
  if (wasOnline && !partnerOnline) showPill(`${names[other]} disconnected. Waiting...`, 'info', true)
  else if (!wasOnline && partnerOnline) showPill(`${names[other]} is back`, 'info')
  renderCoopChips(s)
  const prevRun = s.run
  s.run = st.run ?? null
  syncHistory(s, st, prevRun)
  const ev = st.ev && st.ev.id > lastEvId ? st.ev : null
  if (st.ev) lastEvId = st.ev.id
  if (ev?.k === 'fail' && s.run) {
    const shielded = prevRun !== null && prevRun.hearts === s.run.hearts
    showToast(shielded ? 'Shield broken!' : 'Floor failed', failText(shielded ? 'shielded' : 'retry', s.run, 'Out of moves.'), [{ label: 'Retry', primary: true, run: hideToast }])
  }
  updateHud()
  maybeCoopCards(s)
}

// Bring our game in line with the room: play the partner's moves, or rebuild after a restart
function syncHistory(s: CoopSession, st: RoomState, prevRun: RunState | null): void {
  const changed = st.run ? !prevRun || prevRun.floor !== st.run.floor || prevRun.seed !== st.run.seed : st.level !== s.n
  if (changed) {
    loadCoop(st.level, s.online, st.you, s.names, st.history, s.partnerOnline, st.run ?? null)
    return
  }
  const local = s.game.history.join('')
  if (st.history === local) return
  if (st.history.startsWith(local)) {
    netQueue.push(...st.history.slice(local.length))
    void drainNet()
    return
  }
  loadCoop(st.level, s.online, st.you, s.names, st.history, s.partnerOnline, st.run ?? null)
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
  }, coopRogueMode ? Math.floor(Math.random() * 1e9) + 1 : null)
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
  if (rogueOpen) {
    if (rogueDismiss) hideRogue()
  } else if (lobbyOpen) closeLobby()
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
  else if (key === 'u') rogueUndo()
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
$('btn-play').addEventListener('click', () => { ensureAudio(); closeIntro() })
$('btn-help').addEventListener('click', () => { ensureAudio(); openIntro() })
$('btn-hints').addEventListener('click', () => { ensureAudio(); toggleHints() })
$('btn-audio').addEventListener('click', () => {
  ensureAudio()
  setAudio(!isAudioOn())
  renderMenu()
})
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

{
  const button = document.createElement('button')
  button.id = 'btn-gfx'
  button.className = 'mode wide'
  const title = document.createElement('b')
  title.id = 'gfx-label'
  const hint = document.createElement('span')
  hint.textContent = 'Auto lowers it by itself if your phone struggles'
  button.append(title, hint)
  button.addEventListener('click', () => {
    view.setQualitySetting(view.nextQualitySetting())
    title.textContent = `Graphics: ${view.qualityLabel()}`
  })
  const row = document.createElement('div')
  row.className = 'row'
  row.append(button)
  $('btn-vibe').parentElement?.insertAdjacentElement('afterend', row)
  title.textContent = `Graphics: ${view.qualityLabel()}`
}
$('btn-coop').addEventListener('click', openLobby)
$('lobby-close').addEventListener('click', closeLobby)
$('btn-coop-local').addEventListener('click', () => (coopRogueMode ? startLocalRogue() : loadCoop(coopPick, null, null, ['Player 1', 'Player 2'])))
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

// ---------- roguelike: "The Descent" ----------

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text) e.textContent = text
  return e
}

const runNow = (): RunState | null => (coopSession ? coopSession.run : mode.kind === 'rogue' ? rogue : null)
const budgetNow = (): number => {
  const r = runNow()
  return r ? budgetFor(r, par) : 0
}
const saveRogue = (): void => {
  if (rogue) writeJson(ROGUE_SAVE, rogue)
}
const heartsText = (r: RunState): string => `\u2764 ${r.hearts}/${r.maxHearts}`

let rogueEl: HTMLElement | null = null
function rogueCardEl(): HTMLElement {
  if (!rogueEl) {
    rogueEl = el('div', 'overlay hidden')
    rogueEl.id = 'rogue'
    rogueEl.append(el('div', 'card'))
    document.body.append(rogueEl)
  }
  return rogueEl.firstElementChild as HTMLElement
}

function showRogue(build: (card: HTMLElement) => void, dismissable = false): void {
  const card = rogueCardEl()
  card.replaceChildren()
  build(card)
  rogueDismiss = dismissable
  rogueOpen = true
  rogueEl?.classList.remove('hidden')
}

function hideRogue(): void {
  rogueOpen = false
  rogueEl?.classList.add('hidden')
}

function runSummary(r: RunState): HTMLElement {
  const line = el('p', 'rogue-line')
  const relics = r.relics.map((id) => RELICS[id].icon).join(' ')
  line.textContent = `${heartsText(r)} \u00B7 Floor ${r.floor}${relics ? ` \u00B7 ${relics}` : ''}`
  return line
}

function modeButton(title: string, hint: string, run: () => void, cls = ''): HTMLButtonElement {
  const b = el('button', `mode wide ${cls}`.trim())
  b.append(el('b', '', title), el('span', '', hint))
  b.addEventListener('click', run)
  return b
}

// The bar with the floor type, the relics you own and the Undo / Skip buttons
function rogueUiRefresh(): void {
  const r = runNow()
  document.body.classList.toggle('rogue', r !== null)
  const caps = $('stats').querySelectorAll('small')
  caps[0].textContent = r ? 'Floor' : 'Puzzle'
  caps[2].textContent = r ? 'Hearts' : 'Par'
  let bar = document.getElementById('rogue-bar')
  if (!bar) {
    bar = el('div')
    bar.id = 'rogue-bar'
    bar.hidden = true
    document.body.append(bar)
  }
  if (!r) {
    bar.hidden = true
    mirrorNow = false
    $('moves').parentElement?.classList.remove('warn')
    return
  }
  const kind = floorKind(r.seed, r.floor)
  mirrorNow = kind === 'mirror' && r.phase === 'play'
  $('label').textContent = String(r.floor)
  $('par').textContent = heartsText(r)
  const used = coopSession ? coopSession.game.moves : game.moves
  $('moves').parentElement?.classList.toggle('warn', budgetNow() - used <= 1)

  bar.replaceChildren()
  bar.hidden = false
  if (kind !== 'normal') bar.append(el('span', `rchip kind ${kind}`, KIND_LABEL[kind].toUpperCase()))
  const counts = new Map<string, number>()
  for (const id of r.relics) counts.set(id, (counts.get(id) ?? 0) + 1)
  for (const [id, n] of counts) {
    const chip = el('span', 'rchip', `${RELICS[id as keyof typeof RELICS].icon}${n > 1 ? `\u00D7${n}` : ''}`)
    chip.title = RELICS[id as keyof typeof RELICS].name
    bar.append(chip)
  }
  if (r.shield > 0) bar.append(el('span', 'rchip', `\u{1F6E1}\uFE0F${r.shield}`))
  if (r.rewinds > 0) {
    const b = el('button', '', `\u23EA ${r.rewinds - r.undone}`)
    b.title = 'Undo the last move (U)'
    b.disabled = !canUndo(r)
    b.addEventListener('click', rogueUndo)
    bar.append(b)
  }
  if (r.keys > 0) {
    const b = el('button', '', `\u{1F5DD}\uFE0F ${r.keys}`)
    b.title = 'Skip this floor'
    b.addEventListener('click', rogueSkip)
    bar.append(b)
  }
}

function openRogueStart(): void {
  closeMenu()
  hideToast()
  const saved = rogue && rogue.phase !== 'over' ? rogue : null
  showRogue((card) => {
    card.append(el('h2', '', 'The Descent'), el('p', 'sub', 'Roguelike mode'))
    const rules = el('div', 'rogue-rules')
    for (const t of [
      'Every floor is a puzzle with a strict move budget. Go over it and you lose a heart. No hearts left: the run is over.',
      'Clear a floor and pick 1 of 3 cards. They stack for the whole run: hearts, extra moves, undo, shields... and a few cursed deals.',
      'Watch out for Mirror floors (left and right swapped), Elite and Boss floors. Rest at the Campfire.',
      'No hints. Restarting a floor costs a heart. Hard from the start.',
    ]) rules.append(el('p', '', t))
    card.append(rules)
    if (rogueBest.solo > 0) card.append(el('p', 'rogue-line', `Your best: ${rogueBest.solo} floors cleared`))
    const list = el('div', 'rogue-cards')
    if (saved) list.append(modeButton(`Continue run \u00B7 Floor ${saved.floor}`, `${heartsText(saved)} \u00B7 ${saved.cleared} cleared`, () => startRogue(saved), 'rare'))
    list.append(modeButton('New run', 'A random descent', () => startRogue(newRun(Math.floor(Math.random() * 1e9) + 1, false))))
    list.append(modeButton('Daily run', 'Same floors for everyone today', () => startRogue(newRun(dailySeed(), false))))
    card.append(list)
    const close = el('button', 'rogue-close', 'Close')
    close.addEventListener('click', hideRogue)
    card.append(close)
  }, true)
}

function startRogue(run: RunState): void {
  hideRogue()
  rogue = run
  saveRogue()
  startMode({ kind: 'rogue' })
  rogueCheckPhase()
}

function openRogueCards(run: RunState, onPick: (i: number) => void): void {
  hideToast()
  const camp = floorKind(run.seed, run.floor) === 'camp'
  showRogue((card) => {
    card.append(el('h2', '', camp ? 'Campfire' : `Floor ${run.floor} cleared!`))
    card.append(el('p', 'sub', camp ? 'You rest and heal 1 heart. Pick a card.' : 'Pick a card for the rest of the run.'))
    card.append(runSummary(run))
    const list = el('div', 'rogue-cards')
    run.offers.forEach((id, i) => {
      const relic = RELICS[id]
      const b = modeButton(`${relic.icon} ${relic.name}`, relic.text, () => {
        list.querySelectorAll('button').forEach((x) => (x.disabled = true))
        window.setTimeout(() => list.querySelectorAll('button').forEach((x) => (x.disabled = false)), 4000)
        onPick(i)
      }, relic.cursed ? 'cursed' : relic.rarity === 2 ? 'rare' : '')
      list.append(b)
    })
    card.append(list)
  })
}

function showRogueOver(run: RunState): void {
  hideToast()
  const key = run.coop ? 'coop' : 'solo'
  if (run.cleared > rogueBest[key]) {
    rogueBest[key] = run.cleared
    writeJson('embigo-rogue-best', rogueBest)
  }
  const onlineSession = coopSession?.online ?? null
  showRogue((card) => {
    card.append(el('h2', '', 'Run over'))
    card.append(el('p', 'sub', `You cleared ${run.cleared} ${run.cleared === 1 ? 'floor' : 'floors'} and fell on floor ${run.floor}.`))
    card.append(el('p', 'rogue-line', `Best: ${rogueBest[key]} floors cleared`))
    if (run.relics.length > 0) card.append(el('p', 'rogue-line', run.relics.map((id) => RELICS[id].icon).join(' ')))
    const list = el('div', 'rogue-cards')
    list.append(
      modeButton('New run', run.coop ? 'Another descent together' : 'Try again', () => {
        if (run.coop) {
          if (onlineSession) onlineSession.send({ t: 'newrun' })
          else startLocalRogue()
        } else startRogue(newRun(Math.floor(Math.random() * 1e9) + 1, false))
      }, 'rare'),
    )
    card.append(list)
    const close = el('button', 'rogue-close', 'Close')
    close.addEventListener('click', hideRogue)
    card.append(close)
  }, true)
}

function rogueCheckPhase(): void {
  const run = rogue
  if (!run || mode.kind !== 'rogue') return
  if (run.phase === 'over') showRogueOver(run)
  else if (run.phase === 'pick') openRogueCards(run, soloPick)
}

function soloPick(i: number): void {
  const run = rogue
  if (!run || !pickRelic(run, i)) return
  ensureAudio()
  sfxRelic()
  saveRogue()
  hideRogue()
  startMode({ kind: 'rogue' })
  rogueCheckPhase() // the campfire shows its cards right away
}

async function rogueSoloWin(): Promise<void> {
  const run = rogue
  if (!run) return
  clearFloor(run)
  saveRogue()
  hidePill()
  rogueUiRefresh()
  await sleep(800)
  rogueCheckPhase()
}

function failText(outcome: 'retry' | 'shielded' | 'over', run: RunState, why: string): string {
  return outcome === 'shielded' ? `${why} Your Frost Shield broke, no heart lost.` : `${why} You lost a heart: ${heartsText(run)}.`
}

async function rogueFail(why: string): Promise<void> {
  const run = rogue
  if (!run) return
  ensureAudio()
  rogueLocked = true
  queued = null
  const outcome = failFloor(run)
  saveRogue()
  view.sparkle('bad')
  view.setMood('worried', 4)
  vibrate([30, 50, 30])
  updateHud()
  rogueUiRefresh()
  if (outcome === 'over') {
    sfxFail()
    await sleep(600)
    showRogueOver(run)
    return
  }
  if (outcome === 'shielded') sfxShield()
  else sfxFail()
  showToast(outcome === 'shielded' ? 'Shield broken!' : 'Floor failed', failText(outcome, run, why), [
    { label: 'Retry floor', primary: true, run: () => startMode({ kind: 'rogue' }) },
  ])
}

function localCoopFail(s: CoopSession, why: string): void {
  const run = s.run
  if (!run) return
  rogueLocked = true
  const outcome = failFloor(run)
  view.sparkle('bad')
  vibrate([30, 50, 30])
  updateHud()
  rogueUiRefresh()
  if (outcome === 'over') {
    showRogueOver(run)
    return
  }
  showToast(outcome === 'shielded' ? 'Shield broken!' : 'Floor failed', failText(outcome, run, why), [
    { label: 'Retry floor', primary: true, run: () => loadCoop(0, null, null, s.names, '', true, run) },
  ])
}

function rogueRestart(): void {
  const run = runNow()
  if (!run || run.phase !== 'play') return
  const moves = coopSession ? coopSession.game.moves : game.moves
  if (moves === 0 || rogueLocked) return
  showToast('Restart the floor?', 'It costs a heart.', [
    {
      label: 'Restart',
      primary: true,
      run: () => {
        hideToast()
        const s = coopSession
        if (s) {
          if (s.online) s.online.send({ t: 'restart' }) // the room takes the heart
          else localCoopFail(s, 'You restarted the floor.')
        } else void rogueFail('You restarted the floor.')
      },
    },
    { label: 'Keep playing', run: hideToast },
  ])
}

function rogueUndo(): void {
  const run = runNow()
  if (!run || !canUndo(run) || rogueLocked || overlayOpen()) return
  const s = coopSession
  if (s) {
    if (s.game.history.length === 0 || coopBusy) return
    if (s.online) {
      s.online.send({ t: 'undo' })
      return
    }
    useUndo(run)
    loadCoop(0, null, null, s.names, s.game.history.slice(0, -1).join(''), true, run)
    return
  }
  if (busy || game.history.length === 0) return
  const keep = game.history.slice(0, -1)
  game.restart()
  for (const a of keep) game.apply(a)
  useUndo(run)
  saveRogue()
  game.setTracking(hintsActive())
  view.setLevel(game, false)
  streak = 0
  queued = null
  hidePill()
  renderRoster()
  updateHud()
  rogueUiRefresh()
}

function rogueSkip(): void {
  const run = runNow()
  if (!run || run.keys <= 0 || run.phase !== 'play' || rogueLocked || overlayOpen()) return
  const s = coopSession
  if (s) {
    if (s.online) {
      s.online.send({ t: 'skip' })
      return
    }
    skipFloor(run)
    loadCoop(0, null, null, s.names, '', true, run)
    return
  }
  skipFloor(run)
  saveRogue()
  startMode({ kind: 'rogue' })
  rogueCheckPhase()
}

// ----- roguelike co-op -----

function startLocalRogue(): void {
  loadCoop(0, null, null, ['Player 1', 'Player 2'], '', true, newRun(Math.floor(Math.random() * 1e9) + 1, true))
}

function maybeCoopCards(s: CoopSession): void {
  const run = s.run
  if (!run || coopSession !== s || rogueOpen || coopBusy) return
  if (run.phase === 'over') {
    showRogueOver(run)
    return
  }
  const camp = floorKind(run.seed, run.floor) === 'camp'
  if (run.phase === 'pick' && (s.game.won || camp)) openRogueCards(run, (i) => pickCoop(s, i))
}

function pickCoop(s: CoopSession, i: number): void {
  const run = s.run
  if (!run) return
  if (s.online) {
    s.online.send({ t: 'pick', i }) // the room applies it and starts the next floor for both
    return
  }
  if (!pickRelic(run, i)) return
  ensureAudio()
  sfxRelic()
  loadCoop(0, null, null, s.names, '', true, run)
}

// roguelike buttons: created here, so index.html stays as it is
let coopRogueMode = false
{
  const title = el('h3', '', 'Roguelike')
  const button = modeButton('\u{1F5E1}\uFE0F The Descent', 'Endless hard floors, hearts and cards', openRogueStart)
  button.id = 'btn-rogue'
  $('levels').insertAdjacentElement('afterend', button)
  $('levels').insertAdjacentElement('afterend', title)

  const toggle = el('button', 'mode wide')
  toggle.id = 'btn-coop-rogue'
  const t1 = el('b')
  const t2 = el('span')
  const paint = () => {
    t1.textContent = coopRogueMode ? 'Mode: Roguelike' : 'Mode: Co-op levels'
    t2.textContent = coopRogueMode ? 'Endless hard floors with cards (tap to switch)' : 'The 24 handmade levels (tap to switch)'
  }
  paint()
  toggle.append(t1, t2)
  toggle.addEventListener('click', () => {
    coopRogueMode = !coopRogueMode
    paint()
  })
  document.querySelector('#lobby-start .stepper')?.insertAdjacentElement('beforebegin', toggle)
}

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
