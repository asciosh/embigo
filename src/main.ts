import './style.css'
import { generateLevel, dailySeed, TARGET_MOVES, type GeneratedLevel } from './generator'
import { getDailyPuzzle } from './puzzles'
import { Game, type Dir } from './game'
import { View } from './scene'
import { ApiError, fetchLeaderboard, loadSession, login, logout, register, saveSession, submitScore, type Board, type Session } from './api'

const canvas = document.getElementById('game') as HTMLCanvasElement
const view = new View(canvas)

const $ = (id: string) => document.getElementById(id)!

const CREATURES = {
  fire: { name: 'Embi', power: 'Fire sprite: burns bushes', color: '#ff7a1a' },
  water: { name: 'Drip', power: 'Water sprite: swims across lakes', color: '#3fa9ff' },
}

let game: Game
let par = 0
let busy = false
let currentDay: number | null = null // set only for the daily puzzle (the one with a leaderboard)
let session: Session | null = loadSession()
let pendingWin: { day: number; moves: string } | null = null

let introOpen = false
let boardOpen = false
const overlayOpen = () => introOpen || boardOpen

// ---------- toast ----------

function showToast(title: string, text: string, actionLabel?: string, onAction?: () => void): void {
  const toast = $('toast')
  toast.replaceChildren()
  const b = document.createElement('b')
  b.textContent = title
  const span = document.createElement('span')
  span.textContent = text
  toast.append(b, span)
  if (actionLabel && onAction) {
    const button = document.createElement('button')
    button.textContent = actionLabel
    button.addEventListener('click', onAction)
    toast.append(button)
  }
  toast.classList.remove('hidden')
}

function hideToast(): void {
  $('toast').classList.add('hidden')
}

// ---------- intro ----------

const INTRO_KEY = 'embigo-intro-seen'

function openIntro(): void {
  introOpen = true
  $('intro').classList.remove('hidden')
}

function closeIntro(): void {
  introOpen = false
  $('intro').classList.add('hidden')
  try {
    localStorage.setItem(INTRO_KEY, '1')
  } catch {
    // storage can be blocked (private mode): the intro will simply show again next time
  }
}

// ---------- puzzles ----------

function updateHud(): void {
  $('moves').textContent = String(game.moves)
}

function loadLevel(level: GeneratedLevel, label: string, day: number | null): void {
  game = new Game(level.rows, level.creature)
  par = level.moves
  currentDay = day
  view.setLevel(game)
  busy = false

  const c = CREATURES[game.creature]
  $('label').textContent = label
  $('par').textContent = String(par)
  $('cname').textContent = c.name
  $('cpower').textContent = c.power
  $('dot').style.background = c.color
  $('dot').style.boxShadow = `0 0 12px ${c.color}`
  hideToast()
  updateHud()
}

function restart(): void {
  game.restart()
  view.setLevel(game)
  busy = false
  hideToast()
  updateHud()
}

const newPuzzle = () => loadLevel(generateLevel(Math.floor(Math.random() * 1e9), TARGET_MOVES), 'Random', null)

const dailyPuzzle = () => {
  const day = dailySeed()
  loadLevel(getDailyPuzzle(day), 'Daily', day)
}

// ---------- moves and scores ----------

async function sendScore(day: number, moves: string, title: string, base: string): Promise<void> {
  if (!session) {
    pendingWin = { day, moves }
    showToast(title, `${base} Log in to save your score.`, 'Log in', openBoard)
    return
  }
  try {
    const r = await submitScore(day, moves, session.token)
    pendingWin = null
    const best = r.improved ? '' : ` Your best today is ${r.moves}.`
    showToast(title, `${base} You are #${r.rank} today.${best}`, 'Leaderboard', openBoard)
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      session = null
      saveSession(null)
      pendingWin = { day, moves }
      showToast(title, `${base} Please log in again to save your score.`, 'Log in', openBoard)
    } else {
      const reason = e instanceof Error ? e.message : 'unknown error'
      showToast(title, `${base} Could not save the score: ${reason}.`, 'Try again', () => void sendScore(day, moves, title, base))
    }
  }
}

async function tryMove(dir: Dir): Promise<void> {
  if (busy || overlayOpen()) return
  const res = game.move(dir)
  if (!res) return
  busy = true
  updateHud()
  await view.animateMove(res)
  busy = false
  if (!res.won) return

  view.celebrate()
  const c = CREATURES[game.creature]
  const title = `${c.name} made it!`
  const verdict = game.moves <= par ? 'Perfect!' : `Par was ${par}.`
  const base = `${game.moves} moves. ${verdict}`
  if (currentDay === null) {
    showToast(title, `${base} Press N for a new puzzle.`)
  } else {
    showToast(title, base)
    await sendScore(currentDay, game.history.join(''), title, base)
  }
}

// ---------- leaderboard window ----------

function formatDay(day: number): string {
  const d = new Date(Date.UTC(Math.floor(day / 10000), (Math.floor(day / 100) % 100) - 1, day % 100))
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

function renderBoard(board: Board): void {
  $('board-sub').textContent = `${formatDay(board.day)} · ${CREATURES[board.creature].name} · par ${board.par}`
  const list = $('board-list')
  list.replaceChildren()
  if (board.scores.length === 0) {
    const li = document.createElement('li')
    li.className = 'empty'
    li.textContent = 'No scores yet. Be the first!'
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
    const moves = document.createElement('span')
    moves.className = 'mv'
    moves.textContent = `${row.moves} moves`
    li.append(rank, name, moves)
    list.append(li)
  })
}

async function refreshBoard(): Promise<void> {
  try {
    renderBoard(await fetchLeaderboard(dailySeed()))
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
    // if the player had just won the daily puzzle without being logged in, save that score now
    if (pendingWin) {
      const win = pendingWin
      const r = await submitScore(win.day, win.moves, session.token)
      pendingWin = null
      showToast('Score saved!', `${win.moves.length} moves. You are #${r.rank} today.`)
    }
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

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) {
    if (e.key === 'Enter') void authenticate('login')
    else if (e.key === 'Escape') closeBoard()
    return
  }
  if (introOpen) {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') closeIntro()
    return
  }
  if (boardOpen) {
    if (e.key === 'Escape') closeBoard()
    return
  }
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
  const dir = KEYS[key]
  if (dir) {
    e.preventDefault()
    void tryMove(dir)
  } else if (key === 'r') restart()
  else if (key === 'n') newPuzzle()
  else if (key === 't') dailyPuzzle()
  else if (key === 'l') openBoard()
})

// swipe for phones
let touchStart: { x: number; y: number } | null = null
window.addEventListener('pointerdown', (e) => {
  if (overlayOpen()) return
  touchStart = { x: e.clientX, y: e.clientY }
})
window.addEventListener('pointerup', (e) => {
  if (!touchStart) return
  const dx = e.clientX - touchStart.x
  const dy = e.clientY - touchStart.y
  touchStart = null
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 30) return
  if (Math.abs(dx) > Math.abs(dy)) void tryMove(dx > 0 ? 'R' : 'L')
  else void tryMove(dy > 0 ? 'D' : 'U')
})

$('btn-restart').addEventListener('click', restart)
$('btn-new').addEventListener('click', newPuzzle)
$('btn-daily').addEventListener('click', dailyPuzzle)
$('btn-help').addEventListener('click', openIntro)
$('btn-play').addEventListener('click', closeIntro)
$('btn-board').addEventListener('click', openBoard)
$('board-close').addEventListener('click', closeBoard)
$('btn-login').addEventListener('click', () => void authenticate('login'))
$('btn-register').addEventListener('click', () => void authenticate('register'))
$('btn-logout').addEventListener('click', () => void doLogout())

// Open a specific puzzle with ?seed=123 (handy to share a puzzle with friends)
const seedParam = Number(new URLSearchParams(window.location.search).get('seed'))
if (Number.isInteger(seedParam) && seedParam > 0) loadLevel(generateLevel(seedParam, TARGET_MOVES), `#${seedParam}`, null)
else dailyPuzzle()

// First visit: show the "how to play" card
let seen = false
try {
  seen = localStorage.getItem(INTRO_KEY) === '1'
} catch {
  seen = false
}
if (!seen) openIntro()
