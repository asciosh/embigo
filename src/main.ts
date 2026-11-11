import './style.css'

const TILE = 48

// '#' = rock, '.' = floor, 'E' = Embi's start, 'G' = goal
const LEVEL: string[] = [
  '##########',
  '#E.......#',
  '#..##....#',
  '#........#',
  '#....##..#',
  '#........#',
  '#......G.#',
  '##########',
]

type Position = { x: number; y: number }

const rows = LEVEL.length
const cols = LEVEL[0].length

const canvas = document.getElementById('game') as HTMLCanvasElement
canvas.width = cols * TILE
canvas.height = rows * TILE
const ctx = canvas.getContext('2d')!

function findTile(symbol: string): Position {
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (LEVEL[y][x] === symbol) return { x, y }
    }
  }
  throw new Error(`Tile ${symbol} not found`)
}

function isWall(x: number, y: number): boolean {
  return (LEVEL[y]?.[x] ?? '#') === '#'
}

let embi: Position = findTile('E')
const goal: Position = findTile('G')
let won = false

function draw(): void {
  // Map
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      ctx.fillStyle = isWall(x, y) ? '#4a4a6a' : '#cfe8f5'
      ctx.fillRect(x * TILE, y * TILE, TILE, TILE)
    }
  }

  // Goal
  ctx.fillStyle = '#ffd166'
  ctx.fillRect(goal.x * TILE + 12, goal.y * TILE + 12, TILE - 24, TILE - 24)

  // Embi: orange body with two eyes
  const px = embi.x * TILE
  const py = embi.y * TILE
  ctx.fillStyle = '#ff7a1a'
  ctx.beginPath()
  ctx.arc(px + TILE / 2, py + TILE / 2, TILE / 2 - 6, 0, Math.PI * 2)
  ctx.fill()

  for (const eyeX of [px + 17, px + 31]) {
    ctx.fillStyle = 'white'
    ctx.beginPath()
    ctx.arc(eyeX, py + 20, 5, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#222'
    ctx.beginPath()
    ctx.arc(eyeX, py + 21, 2.5, 0, Math.PI * 2)
    ctx.fill()
  }

  // Victory message
  if (won) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'
    ctx.fillRect(0, canvas.height / 2 - 40, canvas.width, 80)
    ctx.fillStyle = 'white'
    ctx.font = 'bold 28px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('Embi made it!', canvas.width / 2, canvas.height / 2 + 10)
  }
}

function tryMove(dx: number, dy: number): void {
  if (won) return
  const nx = embi.x + dx
  const ny = embi.y + dy
  if (isWall(nx, ny)) return
  embi = { x: nx, y: ny }
  won = embi.x === goal.x && embi.y === goal.y
  draw()
}

window.addEventListener('keydown', (e) => {
  switch (e.key) {
    case 'ArrowUp': tryMove(0, -1); break
    case 'ArrowDown': tryMove(0, 1); break
    case 'ArrowLeft': tryMove(-1, 0); break
    case 'ArrowRight': tryMove(1, 0); break
    default: return
  }
  e.preventDefault()
})

draw()