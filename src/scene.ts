import * as THREE from 'three'
import type { Game, Pos } from './game'
import type { Creature } from './generator'
import type { CoopGame } from './coop'
import { makeDrip, makeEmbi, makeZefi, type CreatureModel, type Mood } from './creatures'
import { makeEnvironment } from './env'
import { QUALITY, readAutoTier, readQualitySetting, saveAutoTier, saveQualitySetting, type Quality, type QualitySetting } from './quality'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

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
type Actor = { model: CreatureModel; creature: Creature; tween: Tween | null; impactAt: number; popAt: number; mood: Mood; moodUntil: number; blob: THREE.Mesh }

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

// Cheap-but-nice looking textures drawn with a canvas, once
function radialTexture(stops: [number, string][]): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  for (const [at, color] of stops) g.addColorStop(at, color)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(c)
}

function beamTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 4
  c.height = 64
  const ctx = c.getContext('2d')!
  const g = ctx.createLinearGradient(0, 0, 0, 64)
  g.addColorStop(0, 'rgba(255,255,255,0)')
  g.addColorStop(1, 'rgba(255,255,255,0.8)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 4, 64)
  return new THREE.CanvasTexture(c)
}

// Frosted ice: soft blotches, a few hairline cracks and tiny sparkles
export function frostTexture(seed: number): THREE.CanvasTexture {
  const size = 128
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#eef6ff'
  ctx.fillRect(0, 0, size, size)
  for (let i = 0; i < 26; i++) {
    const x = hash(seed * 50 + i * 3 + 1) * size
    const y = hash(seed * 50 + i * 3 + 2) * size
    const r = 10 + hash(seed * 50 + i * 3 + 3) * 28
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    const dark = hash(seed * 70 + i) > 0.5
    g.addColorStop(0, dark ? 'rgba(150,190,225,0.35)' : 'rgba(255,255,255,0.55)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }
  ctx.strokeStyle = 'rgba(110,155,200,0.45)'
  ctx.lineWidth = 1
  for (let k = 0; k < 3; k++) {
    let x = hash(seed * 90 + k * 5) * size
    let y = hash(seed * 90 + k * 5 + 1) * size
    ctx.beginPath()
    ctx.moveTo(x, y)
    for (let j = 0; j < 7; j++) {
      x += (hash(seed * 110 + k * 17 + j) - 0.5) * 34
      y += (hash(seed * 130 + k * 19 + j) - 0.5) * 34
      ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  for (let i = 0; i < 18; i++) ctx.fillRect(hash(seed * 150 + i) * size, hash(seed * 170 + i) * size, 1.5, 1.5)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// Irregular, low-poly stones painted dark at the bottom and lighter on top
export function makeRockGeo(seed: number): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(0.5, 1)
  const pos = geo.getAttribute('position')
  const colors = new Float32Array(pos.count * 3)
  const lo = new THREE.Color(0x161b3a)
  const hi = new THREE.Color(0x4a5690)
  const c = new THREE.Color()
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const k = 1 + (hash(Math.round(v.x * 40) * 7 + Math.round(v.y * 40) * 13 + Math.round(v.z * 40) * 29 + seed * 101) - 0.5) * 0.34
    v.multiplyScalar(k)
    v.y *= 0.9
    pos.setXYZ(i, v.x, v.y, v.z)
    c.copy(lo).lerp(hi, THREE.MathUtils.clamp((v.y + 0.45) / 0.9, 0, 1))
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.computeVertexNormals()
  return geo
}

const easeOutBack = (x: number) => {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2)
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
  private composer: EffectComposer | null = null
  private quality: Quality = 'high'
  private qualitySetting: QualitySetting = 'auto'
  private groundMat!: THREE.ShaderMaterial
  private haloTex = radialTexture([[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']])
  private beamTex = beamTexture()
  private rockGeos = [makeRockGeo(1), makeRockGeo(2), makeRockGeo(3)]
  private rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, flatShading: true })
  private capGeo = new THREE.IcosahedronGeometry(0.5, 1)
  private capMat = new THREE.MeshStandardMaterial({ color: 0xdce9f6, roughness: 0.75, flatShading: true, emissive: 0x6aa8ee, emissiveIntensity: 0.05 })
  private crystalGeo = new THREE.ConeGeometry(0.085, 0.34, 5)
  private crystalMat = new THREE.MeshStandardMaterial({ color: 0xa8e8ff, emissive: 0x4fc3ff, emissiveIntensity: 1.1, roughness: 0.12, transparent: true, opacity: 0.88 })
  private iceMats: THREE.MeshStandardMaterial[] = []
  private goalFx: { beam: THREE.Mesh; halo: THREE.Sprite; sparks: THREE.Mesh[]; base: THREE.Vector3 }[] = []
  private introItems: { obj: THREE.Object3D; delay: number; baseY: number; baseScale: THREE.Vector3; slide: boolean }[] = []
  private introStart = -10
  private camBase = new THREE.Vector3()
  private camLook = new THREE.Vector3()
  private frameSamples: number[] = []
  private lastFrameAt = 0
  private snowMax = 300
  private blobTex = radialTexture([[0, 'rgba(0,0,0,0.6)'], [0.55, 'rgba(0,0,0,0.25)'], [1, 'rgba(0,0,0,0)']])
  private blobGeo = new THREE.PlaneGeometry(1.5, 1.5)
  private rockBlobMat = new THREE.MeshBasicMaterial({ map: this.blobTex, transparent: true, depthWrite: false, opacity: 0.75 })
  private borderCrystalMats = [0x7fe3ff, 0xc9a2ff, 0x8affd6].map(
    (c) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.1, roughness: 0.12, transparent: true, opacity: 0.9 }),
  )
  private dust!: THREE.Points
  private dustBase: Float32Array = new Float32Array(0)
  // lakes: moving water with light patterns (caustics) and a foamy edge
  private waterMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    transparent: true,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform float uTime; varying vec2 vUv;
      void main(){
        vec2 p = vUv * 6.0;
        float w = (sin(p.x * 3.0 + uTime * 1.5) * 0.5 + 0.5) * (sin(p.y * 3.4 - uTime * 1.2) * 0.5 + 0.5);
        float c = pow(1.0 - abs(sin((p.x + sin(p.y * 2.0 + uTime)) * 5.0)), 8.0) * 0.6
                + pow(1.0 - abs(sin((p.y + cos(p.x * 2.0 - uTime * 0.8)) * 6.0)), 8.0) * 0.5;
        vec3 col = mix(vec3(0.04, 0.33, 0.76), vec3(0.22, 0.72, 1.0), w * 0.65) + vec3(0.7, 0.95, 1.0) * c * 0.32;
        float edge = smoothstep(0.4, 0.5, max(abs(vUv.x - 0.5), abs(vUv.y - 0.5)));
        col += vec3(0.9, 1.0, 1.0) * edge * 0.55;
        gl_FragColor = vec4(col, 0.94);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  })

  // shared geometry and materials
  private tileGeo = new THREE.BoxGeometry(1, 0.3, 1)
  private bushGeo = new THREE.IcosahedronGeometry(0.27, 1)
  private bushMats = [
    new THREE.MeshStandardMaterial({ color: 0x2f9a55, roughness: 0.8, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x3fb869, roughness: 0.8, flatShading: true }),
  ]
  private lakeBase = new THREE.MeshStandardMaterial({ color: 0x1b5fa8, roughness: 0.4 })
  private padMat = new THREE.MeshStandardMaterial({ color: 0x9b7bff, emissive: 0x5a3df0, emissiveIntensity: 0.5, roughness: 0.35 })
  private padRingMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xcdb8ff, emissiveIntensity: 0.8, roughness: 0.3 })
  private plateMat = new THREE.MeshStandardMaterial({ color: 0xffb347, emissive: 0xff8a00, emissiveIntensity: 0.4, roughness: 0.4 })
  private gateMat = new THREE.MeshStandardMaterial({ color: 0x6fb7e8, emissive: 0x2b7fc2, emissiveIntensity: 0.45, roughness: 0.2, transparent: true, opacity: 0.85 })
  private berryMat = new THREE.MeshStandardMaterial({ color: 0xff4d6d, emissive: 0xff2050, emissiveIntensity: 0.35, roughness: 0.3 })
  private ashMat = new THREE.MeshStandardMaterial({ color: 0x7d8896, roughness: 1 })

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !(this.coarse && window.devicePixelRatio >= 2) })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.8

    this.scene.background = new THREE.Color(0x0b1626)
    this.scene.fog = new THREE.Fog(0x0b1626, 16, 34)
    this.scene.environment = makeEnvironment(this.renderer)
    this.scene.environmentIntensity = 0.3

    // four frosted-ice looks x two tints, used by the floor tiles
    const frost = [frostTexture(1), frostTexture(2), frostTexture(3)]
    for (const tint of [0xc4e4f6, 0xa9d2ea]) {
      for (const tex of frost) {
        this.iceMats.push(
          new THREE.MeshStandardMaterial({ color: tint, map: tex, bumpMap: tex, bumpScale: 0.6, roughness: 0.22, metalness: 0.05, emissive: 0x0d2a44, emissiveIntensity: 0.22 }),
        )
      }
    }
    this.scene.add(this.levelGroup)

    const hemi = new THREE.HemisphereLight(0xbfe3ff, 0x1a2540, 0.6)
    this.scene.add(hemi)
    // colored rim lights from behind the cave: cyan on one side, violet on the other
    const rimCyan = new THREE.PointLight(0x4fc3ff, 12, 18, 2)
    rimCyan.position.set(7, 3, -5)
    const rimViolet = new THREE.PointLight(0xb57bff, 10, 18, 2)
    rimViolet.position.set(-7, 3, -5)
    this.scene.add(rimCyan, rimViolet)
    const sun = new THREE.DirectionalLight(0xffffff, 1.55)
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

    // the ground around the cave: dark ice with slow northern lights and twinkling sparkles
    this.groundMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uStrength: { value: 1 } },
      vertexShader: 'varying vec2 vXZ; void main(){ vXZ = (modelMatrix * vec4(position, 1.0)).xz; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        varying vec2 vXZ; uniform float uTime; uniform float uStrength;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
        void main(){
          vec2 p = vXZ * 0.1;
          float n = noise(p * 3.0 + vec2(uTime * 0.05, 0.0)) * 0.6 + noise(p * 7.0 - vec2(0.0, uTime * 0.08)) * 0.4;
          float band = smoothstep(0.35, 0.78, n) * smoothstep(1.0, 0.15, abs(sin(p.x * 2.2 + n * 3.0 + uTime * 0.15)));
          vec3 aur = mix(vec3(0.1, 0.9, 0.7), vec3(0.6, 0.3, 1.0), noise(p * 2.0 + uTime * 0.03));
          float dist = length(vXZ);
          float fade = smoothstep(5.0, 16.0, dist) * (1.0 - smoothstep(34.0, 60.0, dist));
          vec3 col = vec3(0.02, 0.04, 0.09) + aur * band * 0.14 * fade * uStrength;
          float s = hash(floor(vXZ * 2.5));
          float dotShape = smoothstep(0.1, 0.0, length(fract(vXZ * 2.5) - 0.5));
          float tw = step(0.986, s) * dotShape * (0.5 + 0.5 * sin(uTime * 2.0 + s * 40.0));
          col += vec3(0.6, 0.8, 1.0) * tw * 1.2 * uStrength * smoothstep(3.0, 9.0, dist);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    })
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), this.groundMat)
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.32
    this.scene.add(ground)

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
    const count = this.snowMax
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

    // magic dust: slow glowing specks floating around the cave
    const dustCount = 90
    this.dustBase = new Float32Array(dustCount * 3)
    const dustPos = new Float32Array(dustCount * 3)
    for (let i = 0; i < dustCount; i++) {
      this.dustBase[i * 3] = (Math.random() - 0.5) * 15
      this.dustBase[i * 3 + 1] = 0.3 + Math.random() * 3
      this.dustBase[i * 3 + 2] = (Math.random() - 0.5) * 11
    }
    dustPos.set(this.dustBase)
    const dustGeo = new THREE.BufferGeometry()
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3))
    this.dust = new THREE.Points(
      dustGeo,
      new THREE.PointsMaterial({
        map: this.haloTex,
        color: 0xbfe8ff,
        size: 5,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    )
    this.scene.add(this.dust)

    window.addEventListener('resize', () => this.resize())
    this.qualitySetting = readQualitySetting()
    this.applyQuality(this.qualitySetting === 'auto' ? readAutoTier() : this.qualitySetting)
    requestAnimationFrame((ms) => this.frame(ms))
  }

  // ---------- graphics quality ----------

  private buildComposer(): void {
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || window.innerHeight
    const pr = this.renderer.getPixelRatio()
    try {
      const target = new THREE.WebGLRenderTarget(w * pr, h * pr, { type: THREE.HalfFloatType, samples: 4 })
      const composer = new EffectComposer(this.renderer, target)
      composer.addPass(new RenderPass(this.scene, this.camera))
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.28, 0.5, 0.93))
      composer.addPass(new OutputPass())
      composer.setPixelRatio(pr)
      composer.setSize(w, h)
      this.composer = composer
    } catch {
      this.composer = null // no bloom on this device: everything else still works
    }
  }

  private applyQuality(q: Quality): void {
    this.quality = q
    const f = QUALITY[q]
    const dpr = Math.min(window.devicePixelRatio, f.pixelRatio)
    this.renderer.setPixelRatio(dpr)
    const sh = this.sun.shadow
    if (sh.mapSize.x !== f.shadows) {
      sh.map?.dispose()
      sh.map = null
      sh.mapSize.set(f.shadows, f.shadows)
    }
    this.snow.geometry.setDrawRange(0, Math.round(this.snowMax * f.snow))
    this.dust.geometry.setDrawRange(0, f.dust)
    ;(this.dust.material as THREE.PointsMaterial).size = 2.4 * dpr
    ;(this.snow.material as THREE.PointsMaterial).size = 3.2 * dpr
    this.groundMat.uniforms.uStrength.value = f.aurora ? 1 : 0
    if (f.bloom && !this.composer) this.buildComposer()
    else if (!f.bloom && this.composer) {
      this.composer.dispose()
      this.composer = null
    }
    this.resize()
  }

  // Auto mode: if frames take too long while things move, step down one quality level.
  // It looks at the median frame time, so one hiccup (a shader compiling, a tab switch) does not count.
  private sampleFrameTime(ms: number, animating: boolean): void {
    const delta = ms - this.lastFrameAt
    this.lastFrameAt = ms
    if (this.qualitySetting !== 'auto' || !animating || delta > 5000 || this.quality === 'low') return
    this.frameSamples.push(delta)
    const total = this.frameSamples.reduce((a, b) => a + b, 0)
    const enough = this.frameSamples.length >= 40 || (total >= 1200 && this.frameSamples.length >= 6)
    if (!enough) return
    const sorted = [...this.frameSamples].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    this.frameSamples = []
    if (median > 27) {
      const lower: Quality = this.quality === 'high' ? 'medium' : 'low'
      saveAutoTier(lower)
      this.applyQuality(lower)
    }
  }

  setQualitySetting(setting: QualitySetting): void {
    this.qualitySetting = setting
    saveQualitySetting(setting)
    this.frameSamples = []
    if (setting === 'auto') saveAutoTier('high')
    this.applyQuality(setting === 'auto' ? 'high' : setting)
  }

  qualityLabel(): string {
    const names: Record<Quality, string> = { high: 'High', medium: 'Medium', low: 'Low' }
    return this.qualitySetting === 'auto' ? `Auto (${names[this.quality]})` : names[this.quality]
  }

  nextQualitySetting(): QualitySetting {
    const order: QualitySetting[] = ['auto', 'high', 'medium', 'low']
    return order[(order.indexOf(this.qualitySetting) + 1) % order.length]
  }

  private resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || window.innerHeight
    this.renderer.setSize(w, h, false)
    this.composer?.setPixelRatio(this.renderer.getPixelRatio())
    this.composer?.setSize(w, h)
    this.camera.aspect = w / h

    // Tall screens show the board turned by 90 degrees: its long side runs up and down the
    // screen, so the tiles come out much bigger. Turning the phone rebuilds the level.
    const portrait = this.camera.aspect < 1
    if (portrait !== this.portrait) {
      this.portrait = portrait
      if (this.game || this.coop) {
        this.finishTween()
        if (this.coop) this.setCoopLevel(this.coop, false)
        else if (this.game) this.setLevel(this.game, false) // calls resize() again with the new orientation
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
    this.camBase.copy(this.camera.position)
    this.camLook.set(0, 0, 0.4)
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
    this.camBase.copy(this.camera.position)
    this.camLook.set(0, 0, shift)
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
  private buildBoard(state: BoardState, intro: boolean): void {
    this.time = performance.now() / 1000
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
    this.goalFx = []
    this.introItems = []
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
          const rock = new THREE.Mesh(this.rockGeos[Math.floor(hash(n) * 3)], this.rockMat)
          rock.scale.set((0.95 + hash(n + 1) * 0.3) * scale, (0.8 + hash(n + 2) * 0.6) * scale * tall, (0.95 + hash(n + 3) * 0.3) * scale)
          rock.position.set(p.x, 0.28 * rock.scale.y, p.z)
          rock.rotation.y = hash(n + 4) * Math.PI * 2
          rock.castShadow = true
          rock.receiveShadow = true
          this.levelGroup.add(rock)
          if (border && hash(n + 21) > 0.8) {
            // a cluster of glowing crystals on the cave wall
            const mat = this.borderCrystalMats[Math.floor(hash(n + 22) * 3)]
            const base = rock.position.y + 0.45 * rock.scale.y
            for (let k = 0; k < 3; k++) {
              const crystal = new THREE.Mesh(this.crystalGeo, mat)
              crystal.scale.set(1.2 + k * 0.2, 1.9 + k * 0.7 - (k === 2 ? 0.8 : 0), 1.2 + k * 0.2)
              crystal.position.set(p.x + (k - 1) * 0.22, base + 0.18 * (k === 1 ? 1.5 : 1), p.z + (hash(n + 23 + k) - 0.5) * 0.2)
              crystal.rotation.set((hash(n + 26 + k) - 0.5) * 0.5, 0, (k - 1) * 0.3)
              this.levelGroup.add(crystal)
            }
          }
          if (!border) {
            const blob = new THREE.Mesh(this.blobGeo, this.rockBlobMat)
            blob.rotation.x = -Math.PI / 2
            blob.position.set(p.x, 0.012, p.z)
            blob.scale.setScalar(rock.scale.x * 1.15)
            this.levelGroup.add(blob)
            // snow on top of the stones inside the cave, and now and then an ice crystal
            const topY = rock.position.y + 0.5 * rock.scale.y
            const cap = new THREE.Mesh(this.capGeo, this.capMat)
            cap.scale.set(rock.scale.x * 0.74, rock.scale.y * 0.3, rock.scale.z * 0.74)
            cap.position.set(p.x, topY - 0.04, p.z)
            cap.rotation.y = rock.rotation.y
            cap.castShadow = true
            this.levelGroup.add(cap)
            if (hash(n + 9) > 0.62) {
              const crystal = new THREE.Mesh(this.crystalGeo, this.crystalMat)
              crystal.position.set(p.x + (hash(n + 10) - 0.5) * 0.3, topY + 0.1, p.z + (hash(n + 11) - 0.5) * 0.3)
              crystal.rotation.set((hash(n + 12) - 0.5) * 0.5, 0, (hash(n + 13) - 0.5) * 0.5)
              this.levelGroup.add(crystal)
            }
          }
        } else if (t === 'L') {
          const base = new THREE.Mesh(this.tileGeo, this.lakeBase)
          base.position.set(p.x, -0.24, p.z)
          this.levelGroup.add(base)
          const water = new THREE.Mesh(new THREE.PlaneGeometry(0.98, 0.98), this.waterMat)
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
            this.addHalo(p.x, 0.1, p.z, 0xffa43a, 1.5, 0.28)
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
            this.addHalo(p.x, 0.12, p.z, 0xb99bff, 1.7, 0.3)
          }
          if (t === 'B') {
            if (state.isBush(x, y)) {
              const bush = new THREE.Group()
              bush.position.copy(p)
              const parts: [number, number, number, number][] = [
                [0, 0.24, 0, 1],
                [-0.2, 0.18, 0.12, 0.8],
                [0.2, 0.17, 0.1, 0.75],
                [0.05, 0.3, -0.1, 0.7],
                [-0.12, 0.14, -0.15, 0.6],
              ]
              parts.forEach(([ox, oy, oz, s], i) => {
                const m = new THREE.Mesh(this.bushGeo, this.bushMats[i % 2])
                m.position.set(ox, oy, oz)
                m.scale.setScalar(s)
                m.castShadow = true
                m.receiveShadow = true
                bush.add(m)
              })
              for (const [bx, by, bz] of [[0.12, 0.3, 0.14], [-0.14, 0.26, 0.1], [0.02, 0.4, 0.02]] as const) {
                const berry = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), this.berryMat)
                berry.position.set(bx, by, bz)
                bush.add(berry)
              }
              this.levelGroup.add(bush)
              this.bushes.set(`${x},${y}`, bush)
            }
          }
        }
        if (state.wasBurnt(x, y)) this.addAsh(p)
      }
    }

    if (intro) this.prepareIntro()
  }

  // The level builds itself: floor tiles rise from below in a wave from the center, stones pop up
  private prepareIntro(): void {
    this.introStart = this.time
    this.levelGroup.children.forEach((obj, i) => {
      const slide = obj instanceof THREE.Mesh && obj.geometry === this.tileGeo
      const item = {
        obj,
        delay: Math.hypot(obj.position.x, obj.position.z) * 0.05 + hash(i * 7) * 0.06,
        baseY: obj.position.y,
        baseScale: obj.scale.clone(),
        slide,
      }
      if (slide) obj.position.y = item.baseY - 0.9
      else obj.scale.multiplyScalar(0.001)
      this.introItems.push(item)
    })
  }

  private addHalo(x: number, y: number, z: number, color: number, size: number, opacity: number): void {
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.haloTex, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }),
    )
    halo.scale.set(size, size, 1)
    halo.position.set(x, y, z)
    this.levelGroup.add(halo)
  }

  // (Re)build the whole level from the single player game state
  setLevel(game: Game, intro = true): void {
    this.game = game
    this.coop = null
    this.buildBoard(game, intro)
    this.addGoal(game.goal, 0xffd166, 0xffb300)
    this.setActors([game.creature], [game.pos], intro)
  }

  // The same for a co-op level: two creatures, two goals, a ring under the one whose turn it is
  setCoopLevel(coop: CoopGame, intro = true): void {
    this.coop = coop
    this.game = null
    this.buildBoard(coop, intro)
    const tint = (c: Creature) => (c === 'fire' ? [0xff9a4d, 0xff6a00] : c === 'water' ? [0x7cc8ff, 0x1d8fff] : [0xeaf6ff, 0x9ad0ff])
    this.addGoal(coop.goals[0], tint(coop.roster[0])[0], tint(coop.roster[0])[1])
    this.addGoal(coop.goals[1], tint(coop.roster[1])[0], tint(coop.roster[1])[1])
    this.setActors(coop.roster, coop.pos, intro)
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
    const mat = new THREE.MeshStandardMaterial({ color, emissive: glow, emissiveIntensity: 0.7, roughness: 0.15, flatShading: true })
    const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.26), mat)
    mesh.scale.y = 1.6
    mesh.position.set(g.x, 0.5, g.z)
    mesh.castShadow = true
    const light = new THREE.PointLight(color, 2.2, 4, 2)
    light.position.set(0, 0.3, 0)
    mesh.add(light)
    this.levelGroup.add(mesh)
    this.goalMeshes.push(mesh)

    // a soft halo, a beam of light going up, and a few sparkles circling
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.haloTex, color, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }),
    )
    halo.scale.set(1.7, 1.7, 1)
    halo.position.set(g.x, 0.55, g.z)
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.2, 2.2, 18, 1, true),
      new THREE.MeshBasicMaterial({ map: this.beamTex, color, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    )
    beam.position.set(g.x, 1.1, g.z)
    const sparks = [0, 1, 2].map(() => {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.035, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
      )
      this.levelGroup.add(m)
      return m
    })
    this.levelGroup.add(halo, beam)
    this.goalFx.push({ beam, halo, sparks, base: g.clone() })
  }

  private setActors(creatures: Creature[], positions: Pos[], intro: boolean): void {
    for (const a of this.actors) {
      this.scene.remove(a.model.group)
      this.scene.remove(a.blob)
    }
    this.actors = creatures.map((creature, i) => {
      const model = makeModel(creature)
      model.group.scale.setScalar(1.35)
      model.group.position.copy(this.cell(positions[i]))
      this.scene.add(model.group)
      const blob = new THREE.Mesh(this.blobGeo, new THREE.MeshBasicMaterial({ map: this.blobTex, transparent: true, depthWrite: false, opacity: 0.9 }))
      blob.rotation.x = -Math.PI / 2
      blob.position.set(model.group.position.x, 0.016, model.group.position.z)
      this.scene.add(blob)
      return { blob, model, creature, tween: null, impactAt: -10, popAt: intro ? this.time + 0.6 : -10, mood: 'idle' as Mood, moodUntil: 0 }
    })
  }

  private addTile(p: THREE.Vector3, x: number, y: number): void {
    const variant = Math.floor(hash(x * 13 + y * 7) * 3)
    const tile = new THREE.Mesh(this.tileGeo, this.iceMats[((x + y) % 2) * 3 + variant])
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
    actor.mood = 'surprised'
    actor.moodUntil = this.time + 0.9
    actor.model.setMood('surprised')
    this.burst(at.clone().setY(0.6), 26, [...colorsOf(game.creature), 0xcdb8ff, 0xffffff], 3.2, 1.2)
  }

  celebrate(): void {
    this.cheerAt = this.time
    this.actors.forEach((_, i) => this.setMood('happy', 5, i))
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
    return this.introItems.length === 0 && !this.actors.some((a) => a.tween) && this.burning.length === 0 && this.time - this.cheerAt > 1.5 && !this.sparks.some((sp) => sp.life > 0)
  }

  private frame(ms: number): void {
    if (this.coarse && this.isIdle() && ms - this.lastRender < 30) {
      requestAnimationFrame((next) => this.frame(next))
      return
    }
    this.lastRender = ms
    this.sampleFrameTime(ms, !this.isIdle())
    const t = ms / 1000
    const dt = Math.min(0.05, Math.max(0, t - this.time))
    this.time = t

    this.updateCreature(t, dt)
    this.updateWorld(t, dt)
    this.updateCamera(t)

    if (this.composer) this.composer.render()
    else this.renderer.render(this.scene, this.camera)
    requestAnimationFrame((next) => this.frame(next))
  }

  // a very slow, tiny drift of the camera: it makes the scene feel alive
  private updateCamera(t: number): void {
    const k = this.camBase.length() / 14
    this.camera.position.set(
      this.camBase.x + Math.sin(t * 0.27) * 0.2 * k,
      this.camBase.y + Math.sin(t * 0.21) * 0.12 * k,
      this.camBase.z + Math.cos(t * 0.23) * 0.15 * k,
    )
    this.camera.lookAt(this.camLook)
  }

  // Show how a creature feels for a moment ("happy", "worried", "surprised")
  setMood(mood: Mood, seconds = 1.2, who = 0): void {
    const actor = this.actors[who]
    if (!actor) return
    actor.mood = mood
    actor.moodUntil = this.time + seconds
    actor.model.setMood(mood)
  }

  private updateCreature(t: number, dt: number): void {
    for (const a of this.actors) this.updateActor(a, t, dt)
  }

  private updateActor(a: Actor, t: number, dt: number): void {
    const m = a.model
    if (a.moodUntil > 0 && t > a.moodUntil && t - this.cheerAt > 1.4) {
      a.mood = 'idle'
      a.moodUntil = 0
      m.setMood('idle')
    }
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

    m.look(a.tween ? a.tween.dx : 0, a.tween ? a.tween.dz : 0)

    // cheer: little jumps after winning
    const c = t - this.cheerAt
    if (c >= 0 && c < 1.4) hop = Math.abs(Math.sin(c * 9)) * 0.28

    m.group.position.y = hop

    // pop-in (after a swap or when a level starts): overshoots a little, then settles at the normal size
    const pop = Math.min(1, Math.max(0, (t - a.popAt) / 0.4))
    const popScale = pop < 1 ? Math.max(0.01, easeOutBack(pop)) : 1
    m.group.scale.setScalar(1.35 * popScale)
    // contact shadow: follows the creature on the ground and fades when it hops
    a.blob.position.set(m.group.position.x, 0.016, m.group.position.z)
    a.blob.scale.setScalar(Math.max(0.01, popScale) * Math.max(0.55, 1 - m.group.position.y * 0.6))
    ;(a.blob.material as THREE.MeshBasicMaterial).opacity = 0.9 * Math.max(0.25, 1 - m.group.position.y * 1.1)
    m.group.rotation.z += (leanZ - m.group.rotation.z) * Math.min(1, dt * 14)
    m.group.rotation.x += (leanX - m.group.rotation.x) * Math.min(1, dt * 14)

    // squash and stretch + idle breathing
    const since = t - a.impactAt
    const k = Math.exp(-since * 9) * Math.sin(since * 28)
    const breathe = Math.sin(t * 3) * 0.018
    m.body.scale.set(1 + 0.16 * k - breathe * 0.5, 1 - 0.2 * k + breathe, 1 + 0.16 * k - breathe * 0.5)
  }

  private updateWorld(t: number, dt: number): void {
    this.groundMat.uniforms.uTime.value = t
    this.waterMat.uniforms.uTime.value = t

    // dust motes drift slowly
    const dustAttr = this.dust.geometry.getAttribute('position') as THREE.BufferAttribute
    const dustCount = this.dust.geometry.drawRange.count === Infinity ? dustAttr.count : Math.min(dustAttr.count, this.dust.geometry.drawRange.count)
    for (let i = 0; i < dustCount; i++) {
      dustAttr.setXYZ(
        i,
        this.dustBase[i * 3] + Math.cos(t * 0.3 + i * 1.3) * 0.35,
        this.dustBase[i * 3 + 1] + Math.sin(t * 0.4 + i) * 0.3,
        this.dustBase[i * 3 + 2] + Math.sin(t * 0.25 + i * 0.7) * 0.3,
      )
    }
    dustAttr.needsUpdate = true

    // level intro animation
    if (this.introItems.length > 0) {
      let allDone = true
      for (const it of this.introItems) {
        const p = (t - this.introStart - it.delay) / 0.4
        if (p >= 1) {
          if (it.slide) it.obj.position.y = it.baseY
          else it.obj.scale.copy(it.baseScale)
        } else {
          allDone = false
          const e = easeOutBack(Math.max(0, p))
          if (it.slide) it.obj.position.y = it.baseY - 0.9 * (1 - e)
          else it.obj.scale.copy(it.baseScale).multiplyScalar(Math.max(0.001, e))
        }
      }
      if (allDone) this.introItems = []
    }

    // goal effects: pulsing halo and beam, sparkles circling
    this.goalFx.forEach((fx, i) => {
      const pulse = 1 + Math.sin(t * 2.4 + i) * 0.08
      fx.halo.scale.set(1.7 * pulse, 1.7 * pulse, 1)
      ;(fx.beam.material as THREE.MeshBasicMaterial).opacity = 0.38 + Math.sin(t * 2 + i * 2) * 0.08
      fx.sparks.forEach((sp, k) => {
        const a = t * (1.1 + k * 0.3) + k * 2.1 + i
        sp.position.set(fx.base.x + Math.cos(a) * 0.45, 0.35 + ((t * 0.3 + k * 0.33) % 1) * 1.1, fx.base.z + Math.sin(a) * 0.45)
        sp.visible = this.quality !== 'low'
      })
    })
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
