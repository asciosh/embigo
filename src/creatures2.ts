import * as THREE from 'three'
import { addRim, dropGeometry, flameGeometry, flameMaterial, makeFace, paintByHeight, shadows, sphere, std, type CreatureModel, type Mood } from './creatures'

// Redesign (variant B): each creature has its own silhouette and purposeful parts
// (ears, tail, belly patch, crest) and a thin tinted outline so it reads on the ice.

const outlineMats = new Map<string, THREE.ShaderMaterial>()
function outline(mesh: THREE.Mesh, color: number, thick: number): void {
  const key = `${color}-${thick}`
  let mat = outlineMats.get(key)
  if (!mat) {
    mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uThick: { value: thick } },
      side: THREE.BackSide,
      vertexShader: 'uniform float uThick; void main(){ vec3 p = position + normalize(normal) * uThick; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }',
      fragmentShader: 'uniform vec3 uColor; void main(){ gl_FragColor = vec4(uColor, 1.0);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}',
    })
    outlineMats.set(key, mat)
  }
  mesh.add(new THREE.Mesh(mesh.geometry, mat))
}

function part(geo: THREE.BufferGeometry, mat: THREE.Material, line: number, thick = 0.011): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat)
  outline(m, line, thick)
  return m
}

function bend(geo: THREE.BufferGeometry, h: number, amount: number): THREE.BufferGeometry {
  const pos = geo.getAttribute('position')
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / h
    pos.setX(i, pos.getX(i) + amount * t * t)
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()
  return geo
}

const pts = (g: THREE.Object3D, ...xs: THREE.Object3D[]) => xs.forEach((x) => g.add(x))

// ---------- Embi B: an ember imp with pointed ears, a curled flame and a flame tail ----------

export function makeEmbiB(): CreatureModel {
  const group = new THREE.Group()
  const body = new THREE.Group()
  group.add(body)
  const timeU = { value: 0 }
  const LINE = 0x7a2208
  const skin = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, emissive: 0xff4a10, emissiveIntensity: 0.12 })
  addRim(skin, 0xffb060, 2.4, 0.5)
  const dark = std(0xb83208, 0.5)
  const cream = std(0xffe2a6, 0.45, { emissive: 0xffc870, emissiveIntensity: 0.15 })

  const torso = part(paintByHeight(new THREE.SphereGeometry(0.21, 40, 28), 0xd9480c, 0xf26a1a), skin, LINE)
  torso.scale.set(1, 1.12, 0.95)
  torso.position.y = 0.27
  const belly = sphere(0.125, cream, 20)
  belly.scale.set(1, 1.15, 0.38)
  belly.position.set(0, 0.25, 0.175)
  const head = part(paintByHeight(new THREE.SphereGeometry(0.3, 48, 34), 0xe8561a, 0xff8a2b), skin, LINE)
  head.scale.set(1.1, 0.98, 1)
  head.position.y = 0.6
  pts(body, torso, belly, head)

  const armsE: THREE.Mesh[] = []
  for (const side of [-1, 1]) {
    const ear = part(new THREE.ConeGeometry(0.075, 0.25, 14), dark, LINE, 0.012)
    ear.position.set(side * 0.25, 0.78, -0.02)
    ear.rotation.z = -side * 0.65
    const arm = part(new THREE.SphereGeometry(0.06, 16, 12), std(0xe8560f, 0.45), LINE, 0.012)
    arm.scale.set(0.9, 1.5, 0.9)
    arm.position.set(side * 0.24, 0.27, 0.05)
    arm.rotation.z = -side * 0.25
    const foot = part(new THREE.SphereGeometry(0.08, 16, 12), std(0x9a2a08, 0.6), LINE, 0.012)
    foot.scale.set(1.1, 0.6, 1.4)
    foot.position.set(side * 0.1, 0.05, 0.08)
    pts(body, ear, arm, foot)
    armsE.push(arm)
  }

  // flames: a big one that curls forward-side, a small one behind it, and one on the tail
  const flames: { pivot: THREE.Group; phase: number; base: number }[] = []
  const addFlame = (x: number, y: number, z: number, h: number, w: number, curl: number, tilt: number, seed: number) => {
    const pivot = new THREE.Group()
    pivot.position.set(x, y, z)
    pivot.rotation.z = tilt
    const outer = new THREE.Mesh(bend(flameGeometry(h, w), h, curl), flameMaterial(timeU, h, seed, [1.0, 0.42, 0.05], [0.9, 0.12, 0.02], 1.7))
    const inner = new THREE.Mesh(bend(flameGeometry(h * 0.72, w * 0.55), h * 0.72, curl * 0.72), flameMaterial(timeU, h * 0.72, seed + 3, [1.0, 0.85, 0.35], [1.0, 0.55, 0.1], 1.3))
    pts(pivot, outer, inner)
    body.add(pivot)
    flames.push({ pivot, phase: seed, base: tilt })
  }
  addFlame(0.02, 0.86, 0, 0.58, 0.18, 0.2, 0.05, 0)
  addFlame(-0.12, 0.85, -0.02, 0.34, 0.12, -0.12, 0.3, 1.7)
  addFlame(0, 0.37, -0.4, 0.26, 0.075, -0.05, 0, 3.1)

  const tailMat = std(0xd04010, 0.5)
  for (const [y, z, r] of [[0.17, -0.22, 0.085], [0.22, -0.32, 0.07], [0.32, -0.38, 0.058]] as const) {
    const t = part(new THREE.SphereGeometry(r, 16, 12), tailMat, LINE, 0.01)
    t.position.set(0, y, z)
    body.add(t)
  }

  const face = makeFace({
    eyeX: 0.125, eyeY: 0.62, eyeZ: 0.275, eyeR: 0.1, iris: 0xe08a2e, mouthY: 0.5, mouthZ: 0.285,
    cheekX: 0.2, cheekColor: 0xffc060, mouthColor: 0x5a1a08, browColor: 0x7a2a0a,
  })
  body.add(face.group)

  const emberMat = new THREE.MeshBasicMaterial({ color: 0xffc266, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })
  const embers = Array.from({ length: 6 }, (_, i) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), emberMat)
    body.add(m)
    return { mesh: m, seed: i }
  })
  shadows(group)
  const glow = new THREE.PointLight(0xff8a3a, 2.5, 6, 2)
  glow.position.set(0, 2.0, 0.1)
  group.add(glow)

  let mood: Mood = 'idle'
  return {
    group, body, glow, look: face.look,
    setMood: (m) => { mood = m; face.setMood(m) },
    update: (time: number) => {
      timeU.value = time
      flames.forEach((f) => {
        f.pivot.rotation.z = f.base + Math.sin(time * 5 + f.phase) * 0.1
        f.pivot.rotation.x = Math.sin(time * 4.3 + f.phase) * 0.08
        f.pivot.scale.y = 1 + Math.sin(time * 9 + f.phase) * 0.07
      })
      embers.forEach(({ mesh, seed }) => {
        const p = (time * 0.7 + seed / embers.length) % 1
        mesh.position.set(Math.sin(seed * 2.4 + time) * 0.16, 1.0 + p * 0.7, Math.cos(seed * 1.9) * 0.08)
        mesh.scale.setScalar(Math.max(0.05, 1 - p))
      })
      const wave = mood === 'happy' ? Math.sin(time * 14) * 0.05 : 0
      const up = mood === 'happy' ? 0.08 : 0
      armsE[0].position.y = 0.27 + up + wave
      armsE[1].position.y = 0.27 + up - wave
      glow.intensity = 2.5 + Math.sin(time * 11) * 0.4
      face.update(time)
    },
  }
}

// ---------- Drip B: a water sprite with a curl on top, fin ears and a droplet tail ----------

export function makeDripB(): CreatureModel {
  const group = new THREE.Group()
  const body = new THREE.Group()
  group.add(body)
  const LINE = 0x0a3f8a
  const water = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.14, clearcoat: 1, clearcoatRoughness: 0.05, emissive: 0x1565c0, emissiveIntensity: 0.18, envMapIntensity: 1.5 })
  addRim(water, 0xbfeaff, 2.2, 0.55)
  const fin = new THREE.MeshPhysicalMaterial({ color: 0x2a86e8, roughness: 0.2, clearcoat: 1, transparent: true, opacity: 0.92 })

  const main = part(paintByHeight(new THREE.SphereGeometry(0.32, 48, 34), 0x1f74dc, 0x57c2ff), water, LINE)
  main.scale.set(1.05, 0.98, 1)
  main.position.y = 0.36
  const tuft = part(paintByHeight(bend(dropGeometry(), 1, 0.55), 0x3aa4f4, 0x8fdcff), water, LINE, 0.02)
  tuft.scale.set(0.38, 0.4, 0.38)
  tuft.position.set(0, 0.6, 0)
  const tail = part(paintByHeight(bend(dropGeometry(), 1, 0.4), 0x1f74dc, 0x57c2ff), water, LINE, 0.02)
  tail.scale.set(0.5, 0.5, 0.5)
  tail.position.set(0, 0.14, -0.26)
  tail.rotation.x = -1.35
  const belly = sphere(0.17, std(0xdff6ff, 0.25, { emissive: 0x9fdcff, emissiveIntensity: 0.15 }), 20)
  belly.scale.set(1, 1.1, 0.35)
  belly.position.set(0, 0.25, 0.27)
  pts(body, main, tuft, tail, belly)

  const armsD: THREE.Mesh[] = []
  for (const side of [-1, 1]) {
    const f = part(new THREE.SphereGeometry(0.1, 18, 12), fin, LINE, 0.014)
    f.scale.set(0.5, 1.7, 0.22)
    f.position.set(side * 0.3, 0.5, -0.02)
    f.rotation.z = -side * 0.55
    const arm = part(new THREE.SphereGeometry(0.065, 16, 12), fin, LINE, 0.012)
    arm.scale.set(0.9, 1.4, 0.9)
    arm.position.set(side * 0.33, 0.3, 0.06)
    const foot = part(new THREE.SphereGeometry(0.09, 16, 12), std(0x1a9fe0, 0.3), LINE, 0.012)
    foot.scale.set(1.3, 0.5, 1.5)
    foot.position.set(side * 0.14, 0.05, 0.1)
    pts(body, f, arm, foot)
    armsD.push(arm)
  }

  const face = makeFace({
    eyeX: 0.13, eyeY: 0.43, eyeZ: 0.295, eyeR: 0.105, iris: 0x1ea0ff, mouthY: 0.29, mouthZ: 0.3,
    cheekX: 0.22, cheekColor: 0x8fd0ff, mouthColor: 0x0b3a7a, browColor: 0x0f4d99,
  })
  body.add(face.group)

  const bubbleMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 })
  const bubbles = Array.from({ length: 3 }, (_, i) => {
    const m = sphere(0.03 + i * 0.008, bubbleMat, 10)
    body.add(m)
    return { mesh: m, seed: i }
  })
  const ripple = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.012, 6, 36), new THREE.MeshBasicMaterial({ color: 0x9fdcff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }))
  ripple.rotation.x = Math.PI / 2
  ripple.position.y = 0.025
  group.add(ripple)
  shadows(group)
  const glow = new THREE.PointLight(0x58b8ff, 1.6, 6, 2)
  glow.position.set(0, 2.0, 0.1)
  group.add(glow)

  let moodD: Mood = 'idle'
  return {
    group, body, glow, look: face.look,
    setMood: (m) => {
      moodD = m
      face.setMood(m)
    },
    update: (time: number) => {
      const waveD = moodD === 'happy' ? Math.sin(time * 14) * 0.05 : 0
      const upD = moodD === 'happy' ? 0.08 : 0
      armsD[0].position.y = 0.3 + upD + waveD
      armsD[1].position.y = 0.3 + upD - waveD
      bubbles.forEach(({ mesh, seed }) => {
        const a = time * (0.8 + seed * 0.22) + seed * 2
        mesh.position.set(Math.cos(a) * 0.1, 0.28 + ((time * 0.35 + seed * 0.3) % 1) * 0.35, Math.sin(a) * 0.1)
      })
      const phase = (time * 0.7) % 1
      ripple.scale.setScalar(0.85 + phase * 0.55)
      ;(ripple.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - phase)
      tail.rotation.z = Math.sin(time * 3) * 0.18
      tuft.rotation.z = Math.sin(time * 2.4) * 0.08
      glow.intensity = 1.6 + Math.sin(time * 7) * 0.2
      face.update(time + 1.3)
    },
  }
}

// ---------- Zefi B: a lavender cloud sprite with a fluffy mane, ears and a swirly tail ----------

export function makeZefiB(): CreatureModel {
  const group = new THREE.Group()
  const body = new THREE.Group()
  group.add(body)
  const lift = 0.14
  const LINE = 0x4a5fa0
  const fur = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, emissive: 0x9bb4ff, emissiveIntensity: 0.05 })
  addRim(fur, 0xe6f0ff, 2.2, 0.45)
  const white = std(0xf6f9ff, 0.65, { emissive: 0xdfe9ff, emissiveIntensity: 0.08 })
  addRim(white, 0xffffff, 2.2, 0.35)
  const lav = std(0x95aee8, 0.6)
  const pink = std(0xffb3c8, 0.6)

  const main = part(paintByHeight(new THREE.SphereGeometry(0.28, 40, 28), 0x7a94e0, 0xb4c7f7), fur, LINE)
  main.scale.set(1.05, 0.95, 1)
  main.position.y = 0.42 + lift
  body.add(main)

  const puff = (x: number, y: number, z: number, r: number, mat: THREE.Material, sy = 1) => {
    const m = part(new THREE.SphereGeometry(r, 20, 14), mat, LINE, 0.009)
    m.scale.y = sy
    m.position.set(x, y + lift, z)
    body.add(m)
    return m
  }
  puff(0, 0.16, 0.14, 0.1, white, 0.9)
  puff(0, 0.15, -0.02, 0.13, white, 0.8)
  for (const [x, y, z, r] of [[0, 0.7, 0.02, 0.11], [-0.1, 0.67, -0.02, 0.09], [0.1, 0.67, -0.02, 0.09], [-0.27, 0.38, 0.04, 0.09], [0.27, 0.38, 0.04, 0.09]] as const) puff(x, y, z, r, white)
  for (const side of [-1, 1]) {
    const ear = part(new THREE.ConeGeometry(0.075, 0.22, 14), lav, LINE, 0.011)
    ear.position.set(side * 0.17, 0.74 + lift, -0.02)
    ear.rotation.z = -side * 0.45
    const inner = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.14, 12), pink)
    inner.position.set(side * 0.17, 0.73 + lift, 0.01)
    inner.rotation.z = -side * 0.45
    pts(body, ear, inner)
    puff(side * 0.27, 0.3, 0.1, 0.065, white)
  }
  // swirly tail
  const tailPuffs = [[0.0, 0.2, -0.25, 0.09], [0.06, 0.28, -0.36, 0.075], [0.04, 0.4, -0.42, 0.06], [-0.05, 0.5, -0.4, 0.045]] as const
  const tails = tailPuffs.map(([x, y, z, r]) => puff(x, y, z, r, white))

  const face = makeFace({
    eyeX: 0.115, eyeY: 0.44, eyeZ: 0.255, eyeR: 0.1, iris: 0x7b8cff, mouthY: 0.33, mouthZ: 0.268,
    cheekX: 0.2, cheekColor: 0xffa6c0, mouthColor: 0x4a6f9a, browColor: 0x5a80ad,
  })
  face.group.position.y = lift
  body.add(face.group)

  const starMat = new THREE.MeshBasicMaterial({ color: 0xfff3b0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false })
  const stars = Array.from({ length: 3 }, (_, i) => {
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.04), starMat)
    body.add(m)
    return { mesh: m, seed: i }
  })
  shadows(group)
  const glow = new THREE.PointLight(0xbfe3ff, 1.8, 6, 2)
  glow.position.set(0, 2.0, 0.1)
  group.add(glow)

  // make Zefi a bit bigger as a whole (the view squashes `body`, so we scale an inner rig)
  const rig = new THREE.Group()
  ;[...body.children].forEach((k) => rig.add(k))
  rig.scale.setScalar(1.3)
  body.add(rig)

  return {
    group, body, glow, look: face.look,
    setMood: (m) => face.setMood(m),
    update: (time: number) => {
      tails.forEach((t, i) => {
        const base = tailPuffs[i]
        t.position.x = base[0] + Math.sin(time * 2.4 - i * 0.7) * 0.05 * (i + 1) * 0.5
        t.position.y = base[1] + lift + Math.sin(time * 3 - i) * 0.02
      })
      stars.forEach(({ mesh, seed }) => {
        const a = time * 1.3 + seed * 2.1
        mesh.position.set(Math.cos(a) * 0.6, 0.5 + lift + Math.sin(a * 1.7 + seed) * 0.2, Math.sin(a) * 0.5)
        mesh.rotation.y = time * 3
        mesh.scale.setScalar(0.7 + Math.sin(time * 5 + seed) * 0.3)
      })
      glow.intensity = 1.8 + Math.sin(time * 5) * 0.25
      face.update(time + 0.7)
    },
  }
}
