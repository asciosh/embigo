import './style.css'
import { generateLevel, dailySeed } from './generator'
import { Game, type Dir } from './game'
import { View } from './scene'

const TARGET_MOVES = 6

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
let introOpen = false

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

function showToast(title: string, text: string): void {
  $('toast').innerHTML = `<b>${title}</b><span>${text}</span>`
  $('toast').classList.remove('hidden')
}

function hideToast(): void {
  $('toast').classList.add('hidden')
}

function updateHud(): void {
  $('moves').textContent = String(game.moves)
}

function loadPuzzle(seed: number, label: string): void {
  const level = generateLevel(seed, TARGET_MOVES)
  game = new Game(level.rows, level.creature)
  par = level.moves
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

const newPuzzle = () => loadPuzzle(Math.floor(Math.random() * 1e9), 'Random')
const dailyPuzzle = () => loadPuzzle(dailySeed(), 'Daily')

async function tryMove(dir: Dir): Promise<void> {
  if (busy || introOpen) return
  const res = game.move(dir)
  if (!res) return
  busy = true
  updateHud()
  await view.animateMove(res)
  busy = false
  if (res.won) {
    view.celebrate()
    const c = CREATURES[game.creature]
    const verdict = game.moves <= par ? 'Perfect!' : `Par was ${par}`
    showToast(`${c.name} made it!`, `${game.moves} moves. ${verdict} Press N for a new puzzle.`)
  }
}

// ---------- input ----------
const KEYS: Record<string, Dir> = {
  ArrowUp: 'U', ArrowDown: 'D', ArrowLeft: 'L', ArrowRight: 'R',
  w: 'U', s: 'D', a: 'L', d: 'R',
}

window.addEventListener('keydown', (e) => {
  if (introOpen) {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') closeIntro()
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
})

// swipe for phones
let touchStart: { x: number; y: number } | null = null
window.addEventListener('pointerdown', (e) => {
  if (introOpen) return
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

// Open a specific puzzle with ?seed=123 (handy to share a puzzle with friends)
const seedParam = Number(new URLSearchParams(window.location.search).get('seed'))
if (Number.isInteger(seedParam) && seedParam > 0) loadPuzzle(seedParam, `#${seedParam}`)
else dailyPuzzle()

// First visit: show the "how to play" card
let seen = false
try {
  seen = localStorage.getItem(INTRO_KEY) === '1'
} catch {
  seen = false
}
if (!seen) openIntro()
