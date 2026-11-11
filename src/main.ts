import './style.css'
import { EMBI_FRAMES, EMBI_PALETTE } from './embi'
import { generateLevel, dailySeed } from './generator'

const TILE = 48
const TARGET_MOVES = 6

// Tiles: '#' rock, '.' ice, 'B' bush (Embi burns it), 'E' Embi start, 'G' goal
type Position = { x: number; y: number }

// ================= GAME LOGIC (no drawing here) =================

let LEVEL: string[] = generateLevel(dailySeed(), TARGET_MOVES).rows

const rows = LEVEL.length
const cols = LEVEL[0].length

function findTile(symbol: string): Position {
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (LEVEL[y][x] === symbol) return { x, y }
    }
  }
  throw new Error(`Tile ${symbol} not found`)
}

const burnt = new Set<string>() // bushes already burnt, as "x,y"

function isRock(x: number, y: number): boolean {
  return (LEVEL[y]?.[x] ?? '#') === '#'
}

function isBush(x: number, y: number): boolean {
  return LEVEL[y]?.[x] === 'B' && !burnt.has(`${x},${y}`)
}

function isBlocked(x: number, y: number): boolean {
  return isRock(x, y) || isBush(x, y)
}

let start = findTile('E')
let goal = findTile('G')

let embi: Position = { ...start }
let moves = 0
let won = false
let label = 'Daily puzzle'

function slide(dx: number, dy: number): void {
  if (won) return
  let { x, y } = embi

  while (!isBlocked(x + dx, y + dy)) {
    x += dx
    y += dy
    if (x === goal.x && y === goal.y) break
  }

  const atGoal = x === goal.x && y === goal.y

  // Embi is a fire creature: a bush in front of it burns away
  let burned = false
  if (!atGoal && isBush(x + dx, y + dy)) {
    burnt.add(`${x + dx},${y + dy}`)
    burned = true
  }

  if (x === embi.x && y === embi.y && !burned) return // nothing happened: not a move
  embi = { x, y }
  moves++
  won = atGoal
}

function restart(): void {
  embi = { ...start }
  moves = 0
  won = false
  burnt.clear()
}

function loadLevel(newRows: string[], newLabel: string): void {
  LEVEL = newRows
  label = newLabel
  start = findTile('E')
  goal = findTile('G')
  restart()
}

// ================= RENDERING (only this part changes later) =================

const canvas = document.getElementById('game') as HTMLCanvasElement
canvas.width = cols * TILE
canvas.height = rows * TILE
const ctx = canvas.getContext('2d')!

// Pre-render each Embi frame once on a small offscreen canvas
function makeFrameCanvas(frame: string[]): HTMLCanvasElement {
  const px = TILE / frame.length
  const c = document.createElement('canvas')
  c.width = TILE
  c.height = TILE
  const cctx = c.getContext('2d')!
  frame.forEach((row, y) => {
    ;[...row].forEach((ch, x) => {
      if (ch === '.') return
      cctx.fillStyle = EMBI_PALETTE[ch]
      cctx.fillRect(x * px, y * px, px, px)
    })
  })
  return c
}
const embiFrames = EMBI_FRAMES.map(makeFrameCanvas)

function drawTile(x: number, y: number): void {
  const px = x * TILE
  const py = y * TILE
  if (isRock(x, y)) {
    ctx.fillStyle = '#4a4a6a'
    ctx.fillRect(px, py, TILE, TILE)
    ctx.fillStyle = '#5d5d82'
    ctx.fillRect(px + 4, py + 4, TILE - 8, 8)
    return
  }

  // ice floor
  ctx.fillStyle = (x + y) % 2 === 0 ? '#cfe8f5' : '#c2e0f0'
  ctx.fillRect(px, py, TILE, TILE)

  if (isBush(x, y)) {
    ctx.fillStyle = '#2f8f4e'
    ctx.beginPath()
    ctx.arc(px + TILE / 2, py + TILE / 2 + 2, 19, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#4fc477'
    ctx.beginPath()
    ctx.arc(px + TILE / 2 - 6, py + TILE / 2 - 4, 8, 0, Math.PI * 2)
    ctx.fill()
  } else if (burnt.has(`${x},${y}`)) {
    // ash left by a burnt bush
    ctx.fillStyle = '#8d99a6'
    ctx.beginPath()
    ctx.ellipse(px + TILE / 2, py + TILE / 2 + 8, 14, 6, 0, 0, Math.PI * 2)
    ctx.fill()
  }
}

function draw(time: number): void {
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) drawTile(x, y)
  }

  // Goal: a yellow diamond
  const gx = goal.x * TILE + TILE / 2
  const gy = goal.y * TILE + TILE / 2
  ctx.fillStyle = '#ffd166'
  ctx.beginPath()
  ctx.moveTo(gx, gy - 16)
  ctx.lineTo(gx + 16, gy)
  ctx.lineTo(gx, gy + 16)
  ctx.lineTo(gx - 16, gy)
  ctx.closePath()
  ctx.fill()

  // Embi: 2 idle frames + a small bounce
  const frame = embiFrames[Math.floor(time / 400) % embiFrames.length]
  const bounce = Math.round(Math.sin(time / 200) * 2)
  ctx.drawImage(frame, embi.x * TILE, embi.y * TILE + bounce)

  // HUD
  ctx.fillStyle = 'white'
  ctx.font = '14px system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText(`${label}   Moves: ${moves}   R restart  N new  D daily`, 8, 28)

  if (won) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)'
    ctx.fillRect(0, canvas.height / 2 - 45, canvas.width, 90)
    ctx.fillStyle = 'white'
    ctx.textAlign = 'center'
    ctx.font = 'bold 26px system-ui, sans-serif'
    ctx.fillText(`Embi made it in ${moves} moves!`, canvas.width / 2, canvas.height / 2)
    ctx.font = '16px system-ui, sans-serif'
    ctx.fillText('Press R to play again', canvas.width / 2, canvas.height / 2 + 28)
  }

  requestAnimationFrame(draw)
}

// ================= INPUT =================

window.addEventListener('keydown', (e) => {
  switch (e.key) {
    case 'ArrowUp': slide(0, -1); break
    case 'ArrowDown': slide(0, 1); break
    case 'ArrowLeft': slide(-1, 0); break
    case 'ArrowRight': slide(1, 0); break
    case 'r': case 'R': restart(); break
    case 'n': case 'N':
      loadLevel(generateLevel(Math.floor(Math.random() * 1e9), TARGET_MOVES).rows, 'Random puzzle')
      break
    case 'd': case 'D':
      loadLevel(generateLevel(dailySeed(), TARGET_MOVES).rows, 'Daily puzzle')
      break
    default: return
  }
  e.preventDefault()
})

requestAnimationFrame(draw)