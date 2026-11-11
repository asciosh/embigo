import * as THREE from 'three'
import type { Game, MoveResult, Pos } from './game'
import { makeDrip, makeEmbi, type CreatureModel } from './creatures'

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
  resolve: () => void
}

type Burning = { group: THREE.Group; pos: THREE.Vector3; start: number; fired: boolean }

// Deterministic "random" number from an integer (for rock shapes etc.)
function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

const FIRE_COLORS = [0xffa733, 0xffd166, 0xff5a1a]
const WATER_COLORS = [0x7cc8ff, 0xbfe6ff, 0x3fa9ff]

export class View {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100)
  private levelGroup = new THREE.Group()
  private game: Game | null = null
  private model: CreatureModel | null = null
  private goalMesh: THREE.Mesh | null = null
  private lakes: { mesh: THREE.Mesh; baseY: number }[] = []
  private bushes = new Map<string, THREE.Group>()
  private burning: Burning[] = []
  private sparks: Spark[] = []
  private snow: THREE.Points
  private tween: Tween | null = null
  private impactAt = -10
  private cheerAt = -10
  private time = 0
  private canvas: HTMLCanvasElement

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
  private ashMat = new THREE.MeshStandardMaterial({ color: 0x7d8896, roughness: 1 })
  private goalMat = new THREE.MeshStandardMaterial({ color: 0xffd166, emissive: 0xffb300, emissiveIntensity: 1.1, roughness: 0.2, flatShading: true })

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
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
    sun.position.set(-5, 11, 7)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
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
    const count = 260
    const pos = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 16
      pos[i * 3 + 1] = Math.random() * 8
      pos[i * 3 + 2] = (Math.random() - 0.5) * 12
    }
    const snowGeo = new THREE.BufferGeometry()
    snowGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this.snow = new THREE.Points(snowGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.07, transparent: true, opacity: 0.8 }))
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
    // wider field of view on tall (phone) screens, and enough distance to fit the board width
    this.camera.fov = this.camera.aspect < 1 ? 55 : 38
    const tanHalf = Math.tan((this.camera.fov * Math.PI) / 360)
    const dist = Math.max(12, 11.4 / (2 * tanHalf * this.camera.aspect))
    const pitch = (57 * Math.PI) / 180
    this.camera.position.set(0, dist * Math.sin(pitch), dist * Math.cos(pitch) + 0.4)
    const fog = this.scene.fog as THREE.Fog
    fog.near = dist * 1.3
    fog.far = dist * 3.2
    this.camera.lookAt(0, 0, 0.4)
    this.camera.updateProjectionMatrix()
  }

  private cell(p: Pos): THREE.Vector3 {
    const g = this.game!
    return new THREE.Vector3(p.x - (g.cols - 1) / 2, 0, p.y - (g.rows - 1) / 2)
  }

  // (Re)build the whole level from the game state
  setLevel(game: Game): void {
    this.game = game
    this.scene.remove(this.levelGroup)
    this.levelGroup = new THREE.Group()
    this.scene.add(this.levelGroup)
    this.lakes = []
    this.bushes.clear()
    this.burning = []
    this.tween = null
    this.cheerAt = -10

    for (let y = 0; y < game.rows; y++) {
      for (let x = 0; x < game.cols; x++) {
        const t = game.tile(x, y)
        const p = this.cell({ x, y })
        const border = x === 0 || y === 0 || x === game.cols - 1 || y === game.rows - 1
        const n = x * 31 + y * 17

        if (t === '#') {
          const scale = border ? 0.95 : 0.82
          const tall = border ? (y === 0 ? 0.75 : y === game.rows - 1 ? 0.5 : 1.15) : 1
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
          if (t === 'B') {
            if (game.isBush(x, y)) {
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
        if (game.wasBurnt(x, y)) this.addAsh(p)
      }
    }

    // goal crystal
    const g = this.cell(game.goal)
    this.goalMesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.26), this.goalMat)
    this.goalMesh.scale.y = 1.6
    this.goalMesh.position.set(g.x, 0.5, g.z)
    this.goalMesh.castShadow = true
    const goalLight = new THREE.PointLight(0xffd166, 5, 4, 2)
    goalLight.position.set(0, 0.3, 0)
    this.goalMesh.add(goalLight)
    this.levelGroup.add(this.goalMesh)

    // creature
    if (this.model) this.scene.remove(this.model.group)
    this.model = game.creature === 'fire' ? makeEmbi() : makeDrip()
    this.model.group.scale.setScalar(1.35)
    this.model.group.position.copy(this.cell(game.pos))
    this.scene.add(this.model.group)
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

  // Smoothly slide the creature along the move that Game already computed
  animateMove(res: MoveResult): Promise<void> {
    return new Promise((resolve) => {
      if (!this.game || !this.model) return resolve()
      const from = this.cell(res.from)
      const to = this.cell(res.to)
      const dist = Math.abs(res.to.x - res.from.x) + Math.abs(res.to.y - res.from.y)
      const dur = dist === 0 ? 0.3 : 0.12 + 0.07 * dist
      this.tween = {
        from,
        to,
        start: this.time,
        dur,
        dx: Math.sign(to.x - from.x),
        dz: Math.sign(to.z - from.z),
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

  celebrate(): void {
    if (!this.game) return
    this.cheerAt = this.time
    const g = this.cell(this.game.goal)
    this.burst(g.clone().setY(0.6), 40, [0xffd166, 0xff7a1a, 0x7cc8ff, 0x7dffb0, 0xff8fb1], 4, 3)
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

  private frame(ms: number): void {
    const t = ms / 1000
    const dt = Math.min(0.05, Math.max(0, t - this.time))
    this.time = t

    this.updateCreature(t, dt)
    this.updateWorld(t, dt)

    this.renderer.render(this.scene, this.camera)
    requestAnimationFrame((next) => this.frame(next))
  }

  private updateCreature(t: number, dt: number): void {
    const m = this.model
    if (!m || !this.game) return
    m.update(t)

    let leanZ = 0
    let leanX = 0
    let hop = 0

    if (this.tween) {
      const tw = this.tween
      const p = Math.min(1, Math.max(0, (t - tw.start) / tw.dur))
      const e = 1 - Math.pow(1 - p, 3)
      m.group.position.lerpVectors(tw.from, tw.to, e)
      leanZ = -tw.dx * 0.28
      leanX = tw.dz * 0.28
      if (tw.from.equals(tw.to)) hop = Math.sin(p * Math.PI) * 0.2

      const colors = this.game.creature === 'fire' ? FIRE_COLORS : WATER_COLORS
      this.burst(m.group.position.clone().setY(0.25), 1, colors, 0.8, this.game.creature === 'fire' ? -1.2 : 5)

      if (p >= 1) {
        const done = tw.resolve
        this.tween = null
        this.impactAt = t
        done()
      }
    }

    // cheer: little jumps after winning
    const c = t - this.cheerAt
    if (c >= 0 && c < 1.4) hop = Math.abs(Math.sin(c * 9)) * 0.28

    m.group.position.y = hop
    m.group.rotation.z += (leanZ - m.group.rotation.z) * Math.min(1, dt * 14)
    m.group.rotation.x += (leanX - m.group.rotation.x) * Math.min(1, dt * 14)

    // squash and stretch + idle breathing
    const since = t - this.impactAt
    const k = Math.exp(-since * 9) * Math.sin(since * 28)
    const breathe = Math.sin(t * 3) * 0.018
    m.body.scale.set(1 + 0.16 * k - breathe * 0.5, 1 - 0.2 * k + breathe, 1 + 0.16 * k - breathe * 0.5)
  }

  private updateWorld(t: number, dt: number): void {
    if (this.goalMesh) {
      this.goalMesh.rotation.y += dt * 1.6
      this.goalMesh.position.y = 0.5 + Math.sin(t * 2.5) * 0.07
    }
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
