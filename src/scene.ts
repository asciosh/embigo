import * as THREE from 'three'
import type { Game, Pos } from './game'
import type { Creature } from './generator'
import type { CoopGame } from './coop'
import { makeDrip, makeEmbi, makeZefi, type CreatureModel } from './creatures'

type Spark = {
  mesh: THREE.Mesh
  mat: THREE.MeshBasicMaterial
  vel: THREE.Vector3
  life: number
  max: number
  gravity: number
}

type Tween = {
  from: THREE.Vector3
  to: THREE.Vector3
  start: number
  dur: number
  dx: number
  dz: number
  hop: { p0: number; p1: number } | null // part of the slide (0..1) where Zefi is in the air
  resolve: () => void
}

type Burning = { group: THREE.Group; pos: THREE.Vector3; start: number; fired: boolean }

// One creature on the board (single player: one actor; co-op: two)
type Actor = { model: CreatureModel; creature: Creature; tween: Tween | null; impactAt: number; popAt: number }

// What the board needs to know to be drawn (both Game and CoopGame provide it)
type BoardState = {
  cols: number
  rows: number
  tile(x: number, y: number): string
  isBush(x: number, y: number): boolean
  wasBurnt(x: number, y: number): boolean
}

// Deterministic "random" number from an integer (for rock shapes etc.)
function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

const FIRE_COLORS = [0xffa733, 0xffd166, 0xff5a1a]
const WATER_COLORS = [0x7cc8ff, 0xbfe6ff, 0x3fa9ff]
const AIR_COLORS = [0xffffff, 0xcfe9ff, 0xa8d4ff]

function makeModel(creature: Creature): CreatureModel {
  return creature === 'fire' ? makeEmbi() : creature === 'water' ? makeDrip() : makeZefi()
}

const colorsOf = (c: Creature) => (c === 'fire' ? FIRE_COLORS : c === 'water' ? WATER_COLORS : AIR_COLORS)

export class View {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100)
  private levelGroup = new THREE.Group()
  private game: Game | null = null
  private coop: CoopGame | null = null
  private actors: Actor[] = []
  private goalMeshes: THREE.Mesh[] = []
  private plates: THREE.Mesh[] = []
  private gates: THREE.Mesh[] = []
  private turnRing: THREE.Mesh | null = null
  private lakes: { mesh: THREE.Mesh; baseY: number }[] = []
  private pads: THREE.Mesh[] = []
  private bushes = new Map<string, THREE.Group>()
  private burning: Burning[] = []
  private sparks: Spark[] = []
  private snow: THREE.Points
  private cheerAt = -10
  private time = 0
  private canvas: HTMLCanvasElement
  private sun: THREE.DirectionalLight
  private boardCols = 10
  private boardRows = 8
  // tall screens (phones in portrait) show the board turned by 90 degrees
  private portrait = false
  private coarse = window.matchMedia('(pointer: coarse)').matches
  private compactQuery = window.matchMedia('(max-width: 700px), (max-height: 520px)')
  private lastRender = 0

  // shared geometry and materials
  private tileGeo = new THREE.BoxGeometry(1, 0.3, 1)
  private rockGeo = new THREE.IcosahedronGeometry(0.5, 0)
  private bushGeo = new THREE.IcosahedronGeometry(0.27, 1)
  private iceA = new THREE.MeshStandardMaterial({ color: 0xbfe0f3, roughness: 0.22, metalness: 0.05, emissive: 0x0d2a44, emissiveIntensity: 0.3 })
  private iceB = new THREE.MeshStandardMaterial({ color: 0xa9d2ea, roughness: 0.22, metalness: 0.05, emissive: 0x0d2a44, emissiveIntensity: 0.35 })
  private rockMats = [
    new THREE.MeshStandardMaterial({ color: 0x5b6190, roughness: 0.85, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x4a4f7a, roughness: 0.85, flatShading: true }),
  ]
  private bushMats = [
    new THREE.MeshStandardMaterial({ color: 0x2f9a55, roughness: 0.8, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x3fb869, roughness: 0.8, flatShading: true }),
  ]
  private lakeBase = new THREE.MeshStandardMaterial({ color: 0x1b5fa8, roughness: 0.4 })
  private lakeWater = new THREE.MeshStandardMaterial({
    color: 0x35a2ff,
    emissive: 0x0b4a8a,
    emissiveIntensity: 0.5,
    roughness: 0.1,
    transparent: true,
    opacity: 0.88,
  })
  private padMat = new THREE.MeshStandardMaterial({ color: 0x9b7bff, emissive: 0x5a3df0, emissiveIntensity: 0.5, roughness: 0.35 })
  private padRingMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xcdb8ff, emissiveIntensity: 0.8, roughness: 0.3 })
  private plateMat = new THREE.MeshStandardMaterial({ color: 0xffb347, emissive: 0xff8a00, emissiveIntensity: 0.4, roughness: 0.4 })
  private gateMat = new THREE.MeshStandardMaterial({ color: 0x6fb7e8, emissive: 0x2b7fc2, emissiveIntensity: 0.45, roughness: 0.2, transparent: true, opacity: 0.85 })
  private ashMat = new THREE.MeshStandardMaterial({ color: 0x7d8896, roughness: 1 })

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !(this.coarse && window.devicePixelRatio >= 2) })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.0

    this.scene.background = new THREE.Color(0x0b1626)
    this.scene.fog = new THREE.Fog(0x0b1626, 16, 34)
    this.scene.add(this.levelGroup)

    const hemi = new THREE.HemisphereLight(0xbfe3ff, 0x1a2540, 1.0)
    this.scene.add(hemi)
    const sun = new THREE.DirectionalLight(0xffffff, 1.9)
    this.sun = sun
    sun.position.set(-5, 11, 7)
    sun.castShadow = true
    sun.shadow.mapSize.set(this.coarse ? 1024 : 2048, this.coarse ? 1024 : 2048)
    sun.shadow.camera.left = -8
    sun.shadow.camera.right = 8
    sun.shadow.camera.top = 7
    sun.shadow.camera.bottom = -7
    sun.shadow.camera.near = 1
    sun.shadow.camera.far = 30
    sun.shadow.bias = -0.0004
    sun.shadow.normalBias = 0.02
    this.scene.add(sun)

    // dark floor far below, so the cave never shows the void
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshBasicMaterial({ color: 0x08101c }))
    floor.rotation.x = -Math.PI / 2
    floor.position.y = -0.32
    this.scene.add(floor)

    // spark pool
    const sparkGeo = new THREE.SphereGeometry(0.05, 6, 6)
    for (let i = 0; i < 90; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true })
      const mesh = new THREE.Mesh(sparkGeo, mat)
      mesh.visible = false
      this.scene.add(mesh)
      this.sparks.push({ mesh, mat, vel: new THREE.Vector3(), life: 0, max: 1, gravity: 0 })
    }

    // falling snow
    const count = this.coarse ? 140 : 260
    const pos = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 16
      pos[i * 3 + 1] = Math.random() * 8
      pos[i * 3 + 2] = (Math.random() - 0.5) * 12
    }
    const snowGeo = new THREE.BufferGeometry()
    snowGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    // round, soft flakes (a small gradient circle used as the point texture)
    const flake = document.createElement('canvas')
    flake.width = flake.height = 32
    const fctx = flake.getContext('2d')!
    const fgrad = fctx.createRadialGradient(16, 16, 0, 16, 16, 16)
    fgrad.addColorStop(0, 'rgba(255,255,255,1)')
    fgrad.addColorStop(0.45, 'rgba(255,255,255,0.7)')
    fgrad.addColorStop(1, 'rgba(255,255,255,0)')
    fctx.fillStyle = fgrad
    fctx.fillRect(0, 0, 32, 32)
    this.snow = new THREE.Points(
      snowGeo,
      new THREE.PointsMaterial({
        map: new THREE.CanvasTexture(flake),
        color: 0xffffff,
        size: 4 * Math.min(window.devicePixelRatio, 2),
        sizeAttenuation: false,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      }),
    )
    this.scene.add(this.snow)

    window.addEventListener('resize', () => this.resize())
    this.resize()
    requestAnimationFrame((ms) => this.frame(ms))
  }

  private resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || window.innerHeight
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h

    // Tall screens show the board turned by 90 degrees: its long side runs up and down the
    // screen, so the tiles come out much bigger. Turning the phone rebuilds the level.
    const portrait = this.camera.aspect < 1
    if (portrait !== this.portrait) {
      this.portrait = portrait
      if (this.game || this.coop) {
        this.finishTween()
        if (this.coop) this.setCoopLevel(this.coop)
        else if (this.game) this.setLevel(this.game) // calls resize() again with the new orientation
        return
      }
    }

    if (portrait || this.compactQuery.matches) this.fitToScreen(w, h)
    else this.classicFit()
  }

  // The original framing, used on desktop (unchanged)
  private classicFit(): void {
    this.camera.fov = 38
    const tanHalf = Math.tan((this.camera.fov * Math.PI) / 360)
    const sizeFactor = Math.max(this.boardCols / 10, this.boardRows / 8) // 1 for the original 10x8 board
    const dist = Math.max(12 * sizeFactor, (this.boardCols + 1.4) / (2 * tanHalf * this.camera.aspect))
    const pitch = (57 * Math.PI) / 180
    this.camera.position.set(0, dist * Math.sin(pitch), dist * Math.cos(pitch) + 0.4)
    const fog = this.scene.fog as THREE.Fog
    fog.near = dist * 1.3
    fog.far = dist * 3.2
    this.camera.lookAt(0, 0, 0.4)
    this.camera.updateProjectionMatrix()
  }

  // Space taken by the interface at the top and at the bottom of the screen, in pixels
  private uiInsets(h: number): { top: number; bottom: number } {
    let top = 6
    let bottom = 6
    for (const id of ['hud', 'creature', 'roster', 'controls', 'coopbar']) {
      const el = document.getElementById(id)
      if (!el) continue
      const r = el.getBoundingClientRect()
      if (r.height === 0) continue
      if (r.top + r.height / 2 < h / 2) top = Math.max(top, r.bottom + 6)
      else bottom = Math.max(bottom, h - r.top + 6)
    }
    const safe = document.getElementById('safe-bottom')
    if (safe) bottom = Math.max(bottom, safe.offsetHeight + 8)
    return { top, bottom }
  }

  // Phones: zoom in as much as possible while the whole board stays inside the free area
  // between the top bar and the bottom of the screen, and center it there.
  private fitToScreen(w: number, h: number): void {
    const insets = this.uiInsets(h)
    const worldW = this.portrait ? this.boardRows : this.boardCols
    const worldD = this.portrait ? this.boardCols : this.boardRows
    const halfX = worldW / 2 + 0.25
    const halfZ = worldD / 2 + 0.25

    this.camera.fov = this.portrait ? 42 : 38
    this.camera.updateProjectionMatrix()
    const pitch = ((this.portrait ? 62 : 57) * Math.PI) / 180
    const topN = 1 - (2 * insets.top) / h
    const botN = -1 + (2 * insets.bottom) / h
    const sideN = 1 - (2 * 6) / w

    const corners: THREE.Vector3[] = []
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        for (const y of [0, 1.1]) corners.push(new THREE.Vector3(sx * halfX, y, sz * halfZ))
      }
    }

    const place = (dist: number, shift: number) => {
      this.camera.position.set(0, dist * Math.sin(pitch), shift + dist * Math.cos(pitch))
      this.camera.lookAt(0, 0, shift)
      this.camera.updateMatrixWorld(true)
    }
    const measure = (dist: number, shift: number) => {
      place(dist, shift)
      let minX = Infinity
      let maxX = -Infinity
      let minY = Infinity
      let maxY = -Infinity
      for (const c of corners) {
        const v = c.clone().project(this.camera)
        minX = Math.min(minX, v.x)
        maxX = Math.max(maxX, v.x)
        minY = Math.min(minY, v.y)
        maxY = Math.max(maxY, v.y)
      }
      return { minX, maxX, minY, maxY }
    }

    let dist = 14
    let shift = 0
    for (let i = 0; i < 10; i++) {
      const b = measure(dist, shift)
      const needW = (b.maxX - b.minX) / (2 * sideN)
      const needH = (b.maxY - b.minY) / (topN - botN)
      dist = Math.min(60, Math.max(7, dist * Math.max(needW, needH)))

      const a = measure(dist, shift)
      const center = (a.minY + a.maxY) / 2
      const probe = measure(dist, shift + 0.5)
      const slope = ((probe.minY + probe.maxY) / 2 - center) / 0.5
      if (Math.abs(slope) > 1e-4) shift += ((topN + botN) / 2 - center) / slope
    }

    place(dist, shift)
    const fog = this.scene.fog as THREE.Fog
    fog.near = dist * 1.3
    fog.far = dist * 3.2
    this.camera.updateProjectionMatrix()
  }

  get isPortrait(): boolean {
    return this.portrait
  }

  private finishTween(): void {
    for (const a of this.actors) {
      if (!a.tween) continue
      const done = a.tween.resolve
      a.tween = null
      done()
    }
  }

  private cell(p: Pos): THREE.Vector3 {
    const cx = p.x - (this.boardCols - 1) / 2
    const cy = p.y - (this.boardRows - 1) / 2
    // portrait: game x runs down the screen and game y runs across it
    return this.portrait ? new THREE.Vector3(cy, 0, cx) : new THREE.Vector3(cx, 0, cy)
  }

  // Camera, shadows and the board itself (floor, rocks, lakes, bushes, plates, gates)
  private buildBoard(state: BoardState): void {
    this.boardCols = state.cols
    this.boardRows = state.rows
    const sh = this.sun.shadow.camera
    const span = Math.max(state.cols, state.rows) / 2 + 2
    sh.left = -span
    sh.right = span
    sh.top = span
    sh.bottom = -span
    sh.updateProjectionMatrix()
    this.resize()
    this.scene.remove(this.levelGroup)
    this.levelGroup = new THREE.Group()
    this.scene.add(this.levelGroup)
    this.lakes = []
    this.pads = []
    this.plates = []
    this.gates = []
    this.turnRing = null
    this.goalMeshes = []
    this.bushes.clear()
    this.burning = []
    this.cheerAt = -10

    for (let y = 0; y < state.rows; y++) {
      for (let x = 0; x < state.cols; x++) {
        const t = state.tile(x, y)
        const p = this.cell({ x, y })
        const border = x === 0 || y === 0 || x === state.cols - 1 || y === state.rows - 1
        const n = x * 31 + y * 17
        const backEdge = this.portrait ? x === 0 : y === 0
        const frontEdge = this.portrait ? x === state.cols - 1 : y === state.rows - 1

        if (t === '#') {
          const scale = border ? 0.95 : 0.82
          const tall = border ? (backEdge ? 0.75 : frontEdge ? 0.5 : 1.15) : 1
          if (!border) this.addTile(p, x, y)
          const rock = new THREE.Mesh(this.rockGeo, this.rockMats[Math.floor(hash(n) * 2)])
          rock.scale.set((0.95 + hash(n + 1) * 0.3) * scale, (0.8 + hash(n + 2) * 0.6) * scale * tall, (0.95 + hash(n + 3) * 0.3) * scale)
          rock.position.set(p.x, 0.28 * rock.scale.y, p.z)
          rock.rotation.y = hash(n + 4) * Math.PI * 2
          rock.castShadow = true
          rock.receiveShadow = true
          this.levelGroup.add(rock)
        } else if (t === 'L') {
          const base = new THREE.Mesh(this.tileGeo, this.lakeBase)
          base.position.set(p.x, -0.24, p.z)
          this.levelGroup.add(base)
          const water = new THREE.Mesh(new THREE.PlaneGeometry(0.98, 0.98), this.lakeWater)
          water.rotation.x = -Math.PI / 2
          water.position.set(p.x, -0.07, p.z)
          water.receiveShadow = true
          this.levelGroup.add(water)
          this.lakes.push({ mesh: water, baseY: -0.07 })
        } else {
          this.addTile(p, x, y)
          if (t === 'P') {
            const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.42, 0.05, 28), this.plateMat)
            disc.position.set(p.x, 0.025, p.z)
            disc.receiveShadow = true
            this.levelGroup.add(disc)
            this.plates.push(disc)
          }
          if (t === 'D') {
            const gate = new THREE.Mesh(new THREE.BoxGeometry(0.92, 1, 0.92), this.gateMat)
            gate.position.set(p.x, 0.5, p.z)
            gate.castShadow = true
            this.levelGroup.add(gate)
            this.gates.push(gate)
          }
          if (t === 'W') {
            const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.4, 0.06, 32), this.padMat)
            disc.position.set(p.x, 0.03, p.z)
            disc.receiveShadow = true
            this.levelGroup.add(disc)
            const ring = new THREE.Mesh(new THREE.TorusGeometry(0.29, 0.028, 10, 40), this.padRingMat)
            ring.rotation.x = Math.PI / 2
            ring.position.set(p.x, 0.08, p.z)
            this.levelGroup.add(ring)
            this.pads.push(ring)
          }
          if (t === 'B') {
            if (state.isBush(x, y)) {
              const bush = new THREE.Group()
              bush.position.copy(p)
              const parts: [number, number, number, number][] = [
                [0, 0.24, 0, 1],
                [-0.2, 0.18, 0.12, 0.8],
                [0.2, 0.17, 0.1, 0.75],
              ]
              parts.forEach(([ox, oy, oz, s], i) => {
                const m = new THREE.Mesh(this.bushGeo, this.bushMats[i % 2])
                m.position.set(ox, oy, oz)
                m.scale.setScalar(s)
                m.castShadow = true
                m.receiveShadow = true
                bush.add(m)
              })
              this.levelGroup.add(bush)
              this.bushes.set(`${x},${y}`, bush)
            }
          }
        }
        if (state.wasBurnt(x, y)) this.addAsh(p)
      }
    }

  }

  // (Re)build the whole level from the single player game state
  setLevel(game: Game): void {
    this.game = game
    this.coop = null
    this.buildBoard(game)
    this.addGoal(game.goal, 0xffd166, 0xffb300)
    this.setActors([game.creature], [game.pos])
  }

  // The same for a co-op level: two creatures, two goals, a ring under the one whose turn it is
  setCoopLevel(coop: CoopGame): void {
    this.coop = coop
    this.game = null
    this.buildBoard(coop)
    const tint = (c: Creature) => (c === 'fire' ? [0xff9a4d, 0xff6a00] : c === 'water' ? [0x7cc8ff, 0x1d8fff] : [0xeaf6ff, 0x9ad0ff])
    this.addGoal(coop.goals[0], tint(coop.roster[0])[0], tint(coop.roster[0])[1])
    this.addGoal(coop.goals[1], tint(coop.roster[1])[0], tint(coop.roster[1])[1])
    this.setActors(coop.roster, coop.pos)
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.5, 0.045, 10, 40),
      new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.9 }),
    )
    ring.rotation.x = Math.PI / 2
    this.levelGroup.add(ring)
    this.turnRing = ring
  }

  private addGoal(pos: Pos, color: number, glow: number): void {
    const g = this.cell(pos)
    const mat = new THREE.MeshStandardMaterial({ color, emissive: glow, emissiveIntensity: 1.1, roughness: 0.2, flatShading: true })
    const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.26), mat)
    mesh.scale.y = 1.6
    mesh.position.set(g.x, 0.5, g.z)
    mesh.castShadow = true
    const light = new THREE.PointLight(color, 5, 4, 2)
    light.position.set(0, 0.3, 0)
    mesh.add(light)
    this.levelGroup.add(mesh)
    this.goalMeshes.push(mesh)
  }

  private setActors(creatures: Creature[], positions: Pos[]): void {
    for (const a of this.actors) this.scene.remove(a.model.group)
    this.actors = creatures.map((creature, i) => {
      const model = makeModel(creature)
      model.group.scale.setScalar(1.35)
      model.group.position.copy(this.cell(positions[i]))
      this.scene.add(model.group)
      return { model, creature, tween: null, impactAt: -10, popAt: -10 }
    })
  }

  private addTile(p: THREE.Vector3, x: number, y: number): void {
    const tile = new THREE.Mesh(this.tileGeo, (x + y) % 2 === 0 ? this.iceA : this.iceB)
    tile.position.set(p.x, -0.15, p.z)
    tile.receiveShadow = true
    this.levelGroup.add(tile)
  }

  private addAsh(p: THREE.Vector3): void {
    const ash = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.02, 14), this.ashMat)
    ash.position.set(p.x, 0.01, p.z)
    ash.receiveShadow = true
    this.levelGroup.add(ash)
  }

  // Smoothly slide a creature along the move that the game already computed
  // (who = which creature: always 0 in single player, 0 or 1 in co-op)
  animateMove(res: { from: Pos; to: Pos; burned: Pos | null; jumped: Pos | null }, who = 0): Promise<void> {
    return new Promise((resolve) => {
      const actor = this.actors[who]
      if (!actor) return resolve()
      const from = this.cell(res.from)
      const to = this.cell(res.to)
      const dist = Math.abs(res.to.x - res.from.x) + Math.abs(res.to.y - res.from.y)
      const dur = dist === 0 ? 0.3 : 0.12 + 0.07 * dist
      actor.tween = {
        from,
        to,
        start: this.time,
        dur,
        dx: Math.sign(to.x - from.x),
        dz: Math.sign(to.z - from.z),
        hop: this.hopOf(res, dist),
        resolve,
      }
      if (res.burned) {
        const group = this.bushes.get(`${res.burned.x},${res.burned.y}`)
        if (group) {
          this.burning.push({ group, pos: this.cell(res.burned), start: this.time + dur * 0.8, fired: false })
        }
      }
    })
  }

  // Little burst around the creature: green-gold for a best move, grey for a dead end
  sparkle(kind: 'good' | 'bad', who = 0): void {
    const actor = this.actors[who]
    if (!actor) return
    const at = actor.model.group.position.clone().setY(0.7)
    if (kind === 'good') this.burst(at, 16, [0x7dffb0, 0xffd166, 0xffffff], 2.4, -0.6)
    else this.burst(at, 12, [0x8d99a6, 0x5b6190, 0xff8f8f], 1.8, 2)
  }

  // The part of a slide (0..1) during which Zefi is hopping over an obstacle
  private hopOf(res: { from: Pos; jumped: Pos | null }, dist: number): { p0: number; p1: number } | null {
    if (!res.jumped || dist === 0) return null
    const over = Math.abs(res.jumped.x - res.from.x) + Math.abs(res.jumped.y - res.from.y)
    return { p0: (over - 1) / dist, p1: (over + 1) / dist }
  }

  // The player switched creature on a swap pad: same place, new model, a little puff
  swapModel(game: Game): void {
    const actor = this.actors[0]
    if (!actor) return
    const at = actor.model.group.position.clone()
    this.scene.remove(actor.model.group)
    actor.creature = game.creature
    actor.model = makeModel(game.creature)
    actor.model.group.scale.setScalar(0.01)
    actor.model.group.position.copy(at)
    this.scene.add(actor.model.group)
    actor.popAt = this.time
    this.burst(at.clone().setY(0.6), 26, [...colorsOf(game.creature), 0xcdb8ff, 0xffffff], 3.2, 1.2)
  }

  celebrate(): void {
    this.cheerAt = this.time
    for (const g of this.goalMeshes) {
      this.burst(g.position.clone().setY(0.6), 40, [0xffd166, 0xff7a1a, 0x7cc8ff, 0x7dffb0, 0xff8fb1], 4, 3)
    }
  }

  private burst(at: THREE.Vector3, count: number, colors: number[], speed: number, gravity: number): void {
    let n = 0
    for (const s of this.sparks) {
      if (n >= count) break
      if (s.life > 0) continue
      s.mesh.position.copy(at)
      s.vel.set((Math.random() - 0.5) * speed, Math.random() * speed * 0.9 + 0.5, (Math.random() - 0.5) * speed)
      s.max = 0.5 + Math.random() * 0.5
      s.life = s.max
      s.gravity = gravity
      s.mat.color.setHex(colors[Math.floor(Math.random() * colors.length)])
      s.mesh.visible = true
      n++
    }
  }

  // True when nothing is moving: on touch devices we then draw fewer frames to save battery
  private isIdle(): boolean {
    return !this.actors.some((a) => a.tween) && this.burning.length === 0 && this.time - this.cheerAt > 1.5 && !this.sparks.some((sp) => sp.life > 0)
  }

  private frame(ms: number): void {
    if (this.coarse && this.isIdle() && ms - this.lastRender < 30) {
      requestAnimationFrame((next) => this.frame(next))
      return
    }
    this.lastRender = ms
    const t = ms / 1000
    const dt = Math.min(0.05, Math.max(0, t - this.time))
    this.time = t

    this.updateCreature(t, dt)
    this.updateWorld(t, dt)

    this.renderer.render(this.scene, this.camera)
    requestAnimationFrame((next) => this.frame(next))
  }

  private updateCreature(t: number, dt: number): void {
    for (const a of this.actors) this.updateActor(a, t, dt)
  }

  private updateActor(a: Actor, t: number, dt: number): void {
    const m = a.model
    m.update(t)

    let leanZ = 0
    let leanX = 0
    let hop = 0

    if (a.tween) {
      const tw = a.tween
      const p = Math.min(1, Math.max(0, (t - tw.start) / tw.dur))
      const e = 1 - Math.pow(1 - p, 3)
      m.group.position.lerpVectors(tw.from, tw.to, e)
      leanZ = -tw.dx * 0.28
      leanX = tw.dz * 0.28
      if (tw.from.equals(tw.to)) hop = Math.sin(p * Math.PI) * 0.2

      const colors = colorsOf(a.creature)
      this.burst(m.group.position.clone().setY(0.25), 1, colors, 0.8, a.creature === 'fire' ? -1.2 : a.creature === 'air' ? 0.4 : 5)
      if (tw.hop) {
        const q = (e - tw.hop.p0) / (tw.hop.p1 - tw.hop.p0)
        if (q > 0 && q < 1) hop = Math.max(hop, Math.sin(q * Math.PI) * 0.9)
      }

      if (p >= 1) {
        const done = tw.resolve
        a.tween = null
        a.impactAt = t
        done()
      }
    }

    // cheer: little jumps after winning
    const c = t - this.cheerAt
    if (c >= 0 && c < 1.4) hop = Math.abs(Math.sin(c * 9)) * 0.28

    m.group.position.y = hop

    // pop-in after a swap (overshoots a little, then settles at the normal size)
    const pop = Math.min(1, Math.max(0, (t - a.popAt) / 0.4))
    if (pop < 1) {
      const c1 = 1.70158
      const c3 = c1 + 1
      m.group.scale.setScalar(1.35 * Math.max(0.01, 1 + c3 * Math.pow(pop - 1, 3) + c1 * Math.pow(pop - 1, 2)))
    }
    m.group.rotation.z += (leanZ - m.group.rotation.z) * Math.min(1, dt * 14)
    m.group.rotation.x += (leanX - m.group.rotation.x) * Math.min(1, dt * 14)

    // squash and stretch + idle breathing
    const since = t - a.impactAt
    const k = Math.exp(-since * 9) * Math.sin(since * 28)
    const breathe = Math.sin(t * 3) * 0.018
    m.body.scale.set(1 + 0.16 * k - breathe * 0.5, 1 - 0.2 * k + breathe, 1 + 0.16 * k - breathe * 0.5)
  }

  private updateWorld(t: number, dt: number): void {
    this.goalMeshes.forEach((g, i) => {
      g.rotation.y += dt * 1.6
      g.position.y = 0.5 + Math.sin(t * 2.5 + i * 1.3) * 0.07
    })

    // co-op: gates lower while a creature stands on a plate, and a ring marks whose turn it is
    if (this.coop) {
      const open = this.coop.gatesOpen()
      for (const g of this.gates) {
        const target = open ? 0.06 : 1
        g.scale.y += (target - g.scale.y) * Math.min(1, dt * 10)
        g.position.y = 0.5 * g.scale.y
      }
      this.plateMat.emissiveIntensity = open ? 1.6 + Math.sin(t * 6) * 0.4 : 0.4
      const turner = this.actors[this.coop.turn]
      if (turner && this.turnRing) {
        this.turnRing.position.set(turner.model.group.position.x, 0.04, turner.model.group.position.z)
        this.turnRing.scale.setScalar(1 + Math.sin(t * 5) * 0.06)
      }
    }
    // swap pads turn slowly and glow when the creature is standing on one
    const onPad = !!this.game && this.game.onPad()
    this.padRingMat.emissiveIntensity = onPad ? 1.8 + Math.sin(t * 6) * 0.5 : 0.8
    for (const ring of this.pads) ring.rotation.z += dt * (onPad ? 3 : 0.8)
    this.lakes.forEach((l, i) => {
      l.mesh.position.y = l.baseY + Math.sin(t * 2 + i * 1.7) * 0.012
    })

    // bushes burning away
    for (const b of this.burning) {
      const p = (t - b.start) / 0.45
      if (p < 0) continue
      if (!b.fired) {
        b.fired = true
        this.burst(b.pos.clone().setY(0.3), 22, [0xff8a2a, 0xffd166, 0xff4a12], 2.6, -0.5)
      }
      b.group.scale.setScalar(Math.max(0.001, 1 - p))
      if (p >= 1) {
        this.levelGroup.remove(b.group)
        this.addAsh(b.pos)
      }
    }
    this.burning = this.burning.filter((b) => (t - b.start) / 0.45 < 1)

    // sparks
    for (const s of this.sparks) {
      if (s.life <= 0) continue
      s.life -= dt
      if (s.life <= 0) {
        s.mesh.visible = false
        continue
      }
      s.vel.y -= s.gravity * dt
      s.mesh.position.addScaledVector(s.vel, dt)
      const k = s.life / s.max
      s.mat.opacity = k
      s.mesh.scale.setScalar(0.5 + k)
    }

    // snow
    const arr = this.snow.geometry.getAttribute('position') as THREE.BufferAttribute
    for (let i = 0; i < arr.count; i++) {
      let y = arr.getY(i) - dt * 0.45
      if (y < -0.2) y = 8
      arr.setY(i, y)
      arr.setX(i, arr.getX(i) + Math.sin(t * 0.7 + i) * dt * 0.08)
    }
    arr.needsUpdate = true
  }
}
