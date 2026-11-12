import * as THREE from 'three'

// The three creatures, built from simple shapes but with a lot of care: painted gradients,
// magma cracks and animated shader flames (Embi), a glossy refractive-looking drop with bubbles
// (Drip), a fluffy cloud with feathered wings (Zefi), glowing rim light on all of them, and
// expressive faces (colored irises, eyebrows, cheeks, mouth, tongue) that follow the movement.

export type Mood = 'idle' | 'happy' | 'worried' | 'surprised'

export type CreatureModel = {
  group: THREE.Group // put this in the scene and move it around
  body: THREE.Group // squashed / stretched / bobbed by the view
  glow: THREE.PointLight
  update: (time: number) => void
  setMood: (mood: Mood) => void
  look: (dx: number, dz: number) => void // where the eyes look (the direction of movement)
}

// ---------- small helpers ----------

export const std = (color: number, roughness = 0.5, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness, ...extra })

export const basic = (color: number, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity })

export const sphere = (r: number, mat: THREE.Material, seg = 24) => new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.round(seg * 0.75)), mat)

// Paint a gradient from bottom to top on the vertices of a geometry
export function paintByHeight(geo: THREE.BufferGeometry, bottom: number, top: number): THREE.BufferGeometry {
  geo.computeBoundingBox()
  const bb = geo.boundingBox!
  const pos = geo.getAttribute('position')
  const cb = new THREE.Color(bottom)
  const ct = new THREE.Color(top)
  const c = new THREE.Color()
  const arr = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp((pos.getY(i) - bb.min.y) / (bb.max.y - bb.min.y), 0, 1)
    c.copy(cb).lerp(ct, t)
    arr[i * 3] = c.r
    arr[i * 3 + 1] = c.g
    arr[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  return geo
}

// Soft light that wraps around the silhouette (like a back light): it makes the shapes pop.
export function addRim(material: THREE.MeshStandardMaterial, color: number, power = 2.4, strength = 0.6): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.rimColor = { value: new THREE.Color(color) }
    shader.uniforms.rimPower = { value: power }
    shader.uniforms.rimStrength = { value: strength }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 rimColor;\nuniform float rimPower;\nuniform float rimStrength;')
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\nfloat rimF = pow(1.0 - saturate(dot(normalize(normal), normalize(vViewPosition))), rimPower);\ntotalEmissiveRadiance += rimColor * rimF * rimStrength;',
      )
  }
  material.customProgramCacheKey = () => `rim-${color}-${power}-${strength}`
}

// A soft glowing shell around a shape (seen from outside, it looks like a halo)
export function aura(radius: number, color: number, opacity: number): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.SphereGeometry(radius, 24, 16),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide }),
  )
}

export function shadows(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) o.castShadow = true
  })
}

const hashN = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

// ---------- the face ----------

export type FaceOptions = {
  eyeX: number
  eyeY: number
  eyeZ: number
  eyeR: number
  iris: number
  mouthY: number
  mouthZ: number
  cheekX: number
  cheekColor: number
  mouthColor: number
  browColor: number
}

export function makeFace(o: FaceOptions) {
  const group = new THREE.Group()
  const white = std(0xffffff, 0.15, { emissive: 0xffffff, emissiveIntensity: 0.06 })
  const dark = std(0x0d0d14, 0.1)
  const irisMat = std(o.iris, 0.2, { emissive: o.iris, emissiveIntensity: 0.18 })
  const shine = basic(0xffffff)
  const R = o.eyeR

  const eyes: { eye: THREE.Group; pupil: THREE.Group }[] = []
  const brows: THREE.Mesh[] = []
  const cheeks: THREE.Mesh[] = []

  for (const side of [-1, 1]) {
    const eye = new THREE.Group()
    eye.position.set(side * o.eyeX, o.eyeY, o.eyeZ)
    const ball = sphere(R, white, 28)
    const pupil = new THREE.Group()
    pupil.position.set(0, 0, R * 0.5)
    const iris = sphere(R * 0.7, irisMat, 22)
    iris.scale.z = 0.5
    iris.position.z = R * 0.3
    const core = sphere(R * 0.4, dark, 16)
    core.scale.z = 0.5
    core.position.z = R * 0.5
    const glint = sphere(R * 0.22, shine, 8)
    glint.position.set(R * 0.22, R * 0.28, R * 0.62)
    const glint2 = sphere(R * 0.1, shine, 8)
    glint2.position.set(-R * 0.24, -R * 0.22, R * 0.6)
    pupil.add(iris, core, glint, glint2)
    eye.add(ball, pupil)
    group.add(eye)
    eyes.push({ eye, pupil })

    const brow = new THREE.Mesh(new THREE.CapsuleGeometry(R * 0.14, R * 1.05, 4, 8), std(o.browColor, 0.6))
    brow.rotation.z = Math.PI / 2
    brow.position.set(side * o.eyeX, o.eyeY + R * 1.4, o.eyeZ * 0.96)
    group.add(brow)
    brows.push(brow)

    const cheek = sphere(R * 0.78, std(o.cheekColor, 0.7, { emissive: o.cheekColor, emissiveIntensity: 0.2, transparent: true, opacity: 0.8 }), 14)
    cheek.scale.set(1, 0.6, 0.35)
    cheek.position.set(side * o.cheekX, o.mouthY + R * 0.5, o.mouthZ * 0.93)
    group.add(cheek)
    cheeks.push(cheek)
  }

  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.014, 8, 24, Math.PI), std(o.mouthColor, 0.6))
  smile.rotation.z = Math.PI
  smile.position.set(0, o.mouthY + 0.02, o.mouthZ)
  group.add(smile)
  const open = sphere(0.055, std(0x3a0d10, 0.5), 14)
  open.scale.set(1.1, 0.75, 0.35)
  open.position.set(0, o.mouthY - 0.005, o.mouthZ - 0.005)
  group.add(open)
  const tongue = sphere(0.035, std(0xff6f91, 0.55), 10)
  tongue.scale.set(1.2, 0.6, 0.5)
  tongue.position.set(0, o.mouthY - 0.03, o.mouthZ - 0.003)
  group.add(tongue)

  let mood: Mood = 'idle'
  let lookX = 0
  let lookZ = 0
  const cur = { tilt: 0, browUp: 0, open: 0, eye: 1 }

  return {
    group,
    setMood: (m: Mood) => {
      mood = m
    },
    look: (dx: number, dz: number) => {
      lookX = dx
      lookZ = dz
    },
    update: (time: number) => {
      const target =
        mood === 'happy'
          ? { tilt: -0.25, browUp: 0.15, open: 1, eye: 1.05 }
          : mood === 'worried'
            ? { tilt: 0.5, browUp: 0.05, open: 0, eye: 1.0 }
            : mood === 'surprised'
              ? { tilt: 0, browUp: 0.5, open: 0.7, eye: 1.25 }
              : { tilt: 0, browUp: 0, open: 0, eye: 1 }
      const k = 0.18
      cur.tilt += (target.tilt - cur.tilt) * k
      cur.browUp += (target.browUp - cur.browUp) * k
      cur.open += (target.open - cur.open) * k
      cur.eye += (target.eye - cur.eye) * k

      const closed = time % 3.7 < 0.12
      eyes.forEach(({ eye, pupil }) => {
        eye.scale.set(cur.eye, closed ? 0.1 : cur.eye, cur.eye)
        // the eyes also wander a little while idle
        const wanderX = Math.sin(time * 0.7) * 0.15
        pupil.position.x = (lookX + wanderX) * R * 0.3
        pupil.position.y = -lookZ * R * 0.25 + Math.sin(time * 0.9) * R * 0.04
      })
      brows.forEach((b, i) => {
        const side = i === 0 ? -1 : 1
        b.rotation.z = Math.PI / 2 - side * cur.tilt
        b.position.y = o.eyeY + R * (1.4 + cur.browUp)
      })
      cheeks.forEach((c) => c.scale.setScalar(0.9 + Math.sin(time * 2) * 0.03))
      open.visible = cur.open > 0.15
      tongue.visible = cur.open > 0.3
      open.scale.set(1.1, 0.75 * (0.5 + cur.open), 0.35)
      smile.scale.setScalar(mood === 'worried' ? 0.7 : 1)
      smile.rotation.z = mood === 'worried' ? 0 : Math.PI
      smile.position.y = o.mouthY + (mood === 'worried' ? -0.03 : 0.02)
    },
  }
}

// ---------- Embi: a little fire sprite ----------

// Glowing cracks, like cooling lava: used as the "light" the skin gives off
let magmaTexture: THREE.CanvasTexture | null = null
function magma(): THREE.CanvasTexture {
  if (magmaTexture) return magmaTexture
  const size = 256
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#4a1604'
  ctx.fillRect(0, 0, size, size)
  for (let i = 0; i < 22; i++) {
    const g = ctx.createRadialGradient(hashN(i) * size, hashN(i + 50) * size, 0, hashN(i) * size, hashN(i + 50) * size, 30 + hashN(i + 9) * 40)
    g.addColorStop(0, 'rgba(255,120,20,0.32)')
    g.addColorStop(1, 'rgba(255,120,20,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)
  }
  ctx.lineCap = 'round'
  for (let k = 0; k < 16; k++) {
    let x = hashN(k * 3 + 1) * size
    let y = hashN(k * 3 + 2) * size
    ctx.beginPath()
    ctx.moveTo(x, y)
    for (let j = 0; j < 9; j++) {
      x += (hashN(k * 31 + j) - 0.5) * 60
      y += (hashN(k * 37 + j + 5) - 0.5) * 60
      ctx.lineTo(x, y)
    }
    ctx.strokeStyle = 'rgba(255,190,60,0.95)'
    ctx.shadowColor = 'rgba(255,120,0,0.9)'
    ctx.shadowBlur = 8
    ctx.lineWidth = 1.5 + hashN(k) * 2
    ctx.stroke()
  }
  magmaTexture = new THREE.CanvasTexture(c)
  magmaTexture.colorSpace = THREE.SRGBColorSpace
  magmaTexture.wrapS = THREE.RepeatWrapping
  return magmaTexture
}

// A flame: a smooth tapered shape drawn with a shader (bright core, soft edge, waving tip)
export function flameGeometry(height: number, width: number): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = []
  for (let i = 0; i <= 22; i++) {
    const t = i / 22
    const r = width * Math.pow(1 - t, 0.85) * (0.45 + 0.55 * Math.sin(Math.min(1, t * 2.2) * (Math.PI / 2)))
    pts.push(new THREE.Vector2(Math.max(r, 0.0005), t * height))
  }
  return new THREE.LatheGeometry(pts, 22)
}

export function flameMaterial(time: { value: number }, height: number, seed: number, core: number[], edge: number[], alpha: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: time,
      uHeight: { value: height },
      uSeed: { value: seed },
      uCore: { value: new THREE.Vector3(...core) },
      uEdge: { value: new THREE.Vector3(...edge) },
      uAlpha: { value: alpha },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
    vertexShader: `
      uniform float uTime; uniform float uHeight; uniform float uSeed;
      varying float vYn; varying vec3 vN; varying vec3 vV;
      void main(){
        vYn = position.y / uHeight;
        vec3 p = position;
        p.x += sin(uTime * 4.0 + vYn * 7.0 + uSeed) * 0.05 * vYn + vYn * vYn * 0.08 * sin(uTime * 2.0 + uSeed);
        p.z += cos(uTime * 3.3 + vYn * 5.0 + uSeed * 1.7) * 0.04 * vYn;
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uCore; uniform vec3 uEdge; uniform float uAlpha;
      varying float vYn; varying vec3 vN; varying vec3 vV;
      void main(){
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.4);
        vec3 col = mix(uCore, uEdge, clamp(vYn * 1.1 + f * 0.4, 0.0, 1.0));
        float a = clamp((1.0 - vYn * 0.9) * (0.45 + f * 0.8) * uAlpha, 0.0, 0.95);
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  })
}

export function makeEmbi(): CreatureModel {
  const group = new THREE.Group()
  const body = new THREE.Group()
  group.add(body)
  const timeU = { value: 0 }

  const skin = new THREE.MeshStandardMaterial({
    vertexColors: true,
    emissive: 0xffffff,
    emissiveMap: magma(),
    emissiveIntensity: 0.55,
    roughness: 0.52,
  })
  addRim(skin, 0xffa040, 2.2, 0.55)
  const torso = new THREE.Mesh(paintByHeight(new THREE.SphereGeometry(0.34, 56, 40), 0xffb42e, 0xff4510), skin)
  torso.scale.set(1, 1.06, 1)
  torso.position.y = 0.36
  body.add(torso)

  // the flame crown: five tongues, each with an outer and an inner flame
  const tongues: { pivot: THREE.Group; phase: number; baseTilt: number }[] = []
  const tongueData: [number, number, number, number, number][] = [
    [0, 0, 0.62, 0.2, 0],
    [-0.15, 0.02, 0.42, 0.14, 0.38],
    [0.15, 0.02, 0.46, 0.14, -0.4],
    [-0.07, -0.1, 0.4, 0.12, 0.15],
    [0.08, -0.1, 0.36, 0.11, -0.22],
  ]
  tongueData.forEach(([x, z, h, w, tilt], i) => {
    const pivot = new THREE.Group()
    pivot.position.set(x, 0.6, z)
    pivot.rotation.z = tilt
    const outer = new THREE.Mesh(flameGeometry(h, w), flameMaterial(timeU, h, i * 1.9, [1.0, 0.5, 0.08], [0.95, 0.16, 0.03], 1))
    const inner = new THREE.Mesh(flameGeometry(h * 0.72, w * 0.55), flameMaterial(timeU, h * 0.72, i * 1.9 + 3, [1.0, 0.9, 0.45], [1.0, 0.62, 0.15], 0.85))
    pivot.add(outer, inner)
    body.add(pivot)
    tongues.push({ pivot, phase: i * 1.7, baseTilt: tilt })
  })

  const auraBody = aura(0.5, 0xff7a1a, 0.03)
  auraBody.position.y = 0.42
  const auraCrown = aura(0.3, 0xffb347, 0.07)
  auraCrown.position.y = 0.85
  body.add(auraCrown)

  // embers floating up from the crown
  const emberMat = new THREE.MeshBasicMaterial({ color: 0xffc266, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })
  const embers = Array.from({ length: 9 }, (_, i) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), emberMat)
    body.add(m)
    return { mesh: m, seed: i }
  })

  const embiBelly = sphere(0.14, std(0xffe2a6, 0.45, { emissive: 0xffc870, emissiveIntensity: 0.15 }), 20)
  embiBelly.scale.set(1.1, 0.9, 0.35)
  embiBelly.position.set(0, 0.17, 0.29)
  body.add(embiBelly)

  const armMat = std(0xff6d1f, 0.5, { emissive: 0xff3a00, emissiveIntensity: 0.25 })
  addRim(armMat, 0xffa040, 2.2, 0.5)
  const armL = sphere(0.085, armMat, 20)
  armL.scale.set(1, 1.35, 1)
  armL.position.set(-0.37, 0.3, 0.06)
  const armR = armL.clone()
  armR.position.x = 0.37
  body.add(armL, armR)

  const footMat = std(0x9a2f0c, 0.7)
  const footL = sphere(0.09, footMat, 16)
  footL.scale.set(1.1, 0.6, 1.3)
  footL.position.set(-0.14, 0.05, 0.1)
  const footR = footL.clone()
  footR.position.x = 0.14
  body.add(footL, footR)

  const face = makeFace({
    eyeX: 0.135, eyeY: 0.46, eyeZ: 0.285, eyeR: 0.105, iris: 0xe08a2e, mouthY: 0.3, mouthZ: 0.335,
    cheekX: 0.21, cheekColor: 0xff8a6a, mouthColor: 0x5a1a08, browColor: 0x7a2a0a,
  })
  body.add(face.group)
  shadows(group)

  const glow = new THREE.PointLight(0xff8a3a, 2.5, 6, 2)
  glow.position.set(0, 2.0, 0.1)
  group.add(glow)

  let mood: Mood = 'idle'
  return {
    group,
    body,
    glow,
    setMood: (m) => {
      mood = m
      face.setMood(m)
    },
    look: face.look,
    update: (time: number) => {
      timeU.value = time
      tongues.forEach((t) => {
        t.pivot.rotation.z = t.baseTilt + Math.sin(time * 5 + t.phase) * 0.12
        t.pivot.rotation.x = Math.sin(time * 4.3 + t.phase * 0.7) * 0.09
        t.pivot.scale.y = 1 + Math.sin(time * 9 + t.phase) * 0.08
      })
      auraBody.scale.setScalar(1 + Math.sin(time * 3) * 0.05)
      auraCrown.scale.setScalar(1 + Math.sin(time * 6) * 0.08)
      embers.forEach(({ mesh, seed }) => {
        const p = (time * 0.7 + seed / embers.length) % 1
        mesh.position.set(Math.sin(seed * 2.4 + time) * 0.18 * (1 - p * 0.5), 0.75 + p * 0.8, Math.cos(seed * 1.9) * 0.1)
        mesh.scale.setScalar(Math.max(0.05, 1 - p))
      })
      const wave = mood === 'happy' ? Math.sin(time * 14) * 0.07 : 0
      const up = mood === 'happy' ? 0.1 : 0
      armL.position.y = 0.3 + up + wave
      armR.position.y = 0.3 + up - wave
      armL.position.x = -0.37 - up * 0.5
      armR.position.x = 0.37 + up * 0.5
      glow.intensity = 2.5 + Math.sin(time * 11) * 0.4
      face.update(time)
    },
  }
}

// ---------- Drip: a shiny water drop ----------

export function dropGeometry(): THREE.LatheGeometry {
  // a classic teardrop curve: round at the bottom, a soft point at the top
  const pts: THREE.Vector2[] = []
  for (let i = 0; i <= 56; i++) {
    const t = Math.PI - (i / 56) * Math.PI // from the bottom (pi) to the tip (0)
    const x = Math.sin(t) * Math.sin(t / 2) * 0.45
    const y = ((Math.cos(t) + 1) / 2) * 1.0
    pts.push(new THREE.Vector2(Math.max(x, 0.0001), y))
  }
  return new THREE.LatheGeometry(pts, 56)
}

export function makeDrip(): CreatureModel {
  const group = new THREE.Group()
  const body = new THREE.Group()
  group.add(body)

  const water = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    emissive: 0x1565c0,
    emissiveIntensity: 0.26,
    roughness: 0.05,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    transparent: true,
    opacity: 0.9,
    envMapIntensity: 1.9,
  })
  addRim(water, 0xbfeaff, 2.0, 0.7)
  const drop = new THREE.Mesh(paintByHeight(dropGeometry(), 0x1664cc, 0x5cbfff), water)
  drop.position.y = 0.05
  body.add(drop)

  // a lighter inner drop gives depth, like light bending inside the water
  const inner = new THREE.Mesh(
    paintByHeight(dropGeometry(), 0x4fb6ff, 0xcdf1ff),
    std(0xffffff, 0.2, { vertexColors: true, emissive: 0x4db8ff, emissiveIntensity: 0.45, transparent: true, opacity: 0.55 }),
  )
  inner.scale.set(0.6, 0.58, 0.6)
  inner.position.set(0, 0.2, -0.03)
  body.add(inner)

  const bubbleMat = basic(0xffffff, 0.75)
  const bubbles = Array.from({ length: 5 }, (_, i) => {
    const m = sphere(0.028 + (i % 3) * 0.01, bubbleMat, 10)
    body.add(m)
    return { mesh: m, seed: i }
  })

  // curved highlight streak, like a window reflected in the water
  const streak = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.012, 6, 24, 1.1), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }))
  streak.position.set(0, 0.45, 0.04)
  streak.rotation.set(0.05, -0.2, 2.35)
  body.add(streak)
  const shineMat = basic(0xffffff, 0.85)
  const h1 = sphere(0.055, shineMat, 10)
  h1.scale.set(0.5, 1.7, 0.35)
  h1.position.set(-0.19, 0.55, 0.22)
  h1.rotation.z = 0.5
  const h2 = sphere(0.03, shineMat, 8)
  h2.position.set(-0.1, 0.36, 0.31)
  body.add(h1, h2)

  const dripBelly = sphere(0.15, std(0xdff6ff, 0.25, { emissive: 0x9fdcff, emissiveIntensity: 0.15 }), 20)
  dripBelly.scale.set(1, 1.1, 0.35)
  dripBelly.position.set(0, 0.2, 0.22)
  body.add(dripBelly)

  const armMat = new THREE.MeshPhysicalMaterial({ color: 0x2a8fe8, roughness: 0.1, clearcoat: 1, transparent: true, opacity: 0.92 })
  addRim(armMat, 0xbfeaff, 2.0, 0.6)
  const armL = sphere(0.08, armMat, 16)
  armL.scale.set(1, 1.35, 1)
  armL.position.set(-0.36, 0.28, 0.05)
  const armR = armL.clone()
  armR.position.x = 0.36
  body.add(armL, armR)

  const footMat = std(0x1f6fd1, 0.25)
  const footL = sphere(0.085, footMat, 16)
  footL.scale.set(1.15, 0.55, 1.3)
  footL.position.set(-0.13, 0.05, 0.1)
  const footR = footL.clone()
  footR.position.x = 0.13
  body.add(footL, footR)

  // little drops orbiting around it
  const orbitMat = new THREE.MeshPhysicalMaterial({ color: 0x5cc0ff, roughness: 0.05, clearcoat: 1, transparent: true, opacity: 0.85 })
  const orbit = Array.from({ length: 3 }, (_, i) => {
    const m = sphere(0.04 - i * 0.008, orbitMat, 12)
    return { mesh: m, seed: i }
  })

  const face = makeFace({
    eyeX: 0.13, eyeY: 0.43, eyeZ: 0.3, eyeR: 0.105, iris: 0x1ea0ff, mouthY: 0.27, mouthZ: 0.335,
    cheekX: 0.21, cheekColor: 0x8fd0ff, mouthColor: 0x0b3a7a, browColor: 0x0f4d99,
  })
  body.add(face.group)

  // ripples on the ground under the drop
  const rippleMat = () => new THREE.MeshBasicMaterial({ color: 0x9fdcff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false })
  const ripples = [0, 0.5].map((offset) => {
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.012, 6, 36), rippleMat())
    r.rotation.x = Math.PI / 2
    r.position.y = 0.025
    group.add(r)
    return { mesh: r, offset }
  })
  shadows(group)

  const glow = new THREE.PointLight(0x58b8ff, 1.6, 6, 2)
  glow.position.set(0, 2.0, 0.1)
  group.add(glow)

  let mood: Mood = 'idle'
  return {
    group,
    body,
    glow,
    setMood: (m) => {
      mood = m
      face.setMood(m)
    },
    look: face.look,
    update: (time: number) => {
      bubbles.forEach(({ mesh, seed }) => {
        const a = time * (0.8 + seed * 0.22) + seed * 1.7
        mesh.position.set(Math.cos(a) * (0.1 + seed * 0.02), 0.28 + ((time * 0.35 + seed * 0.2) % 1) * 0.4, Math.sin(a) * 0.1)
      })
      orbit.forEach(({ mesh, seed }) => {
        const a = time * (1.1 - seed * 0.2) + seed * 2.1
        mesh.position.set(Math.cos(a) * 0.62, 0.45 + Math.sin(a * 1.6) * 0.2, Math.sin(a) * 0.5)
      })
      ripples.forEach(({ mesh, offset }) => {
        const phase = (time * 0.7 + offset) % 1
        mesh.scale.setScalar(0.85 + phase * 0.55)
        ;(mesh.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - phase)
      })
      inner.scale.setScalar(0.58 + Math.sin(time * 3.2) * 0.02)
      const wave = mood === 'happy' ? Math.sin(time * 14) * 0.07 : 0
      const up = mood === 'happy' ? 0.1 : 0
      armL.position.y = 0.28 + up + wave
      armR.position.y = 0.28 + up - wave
      armL.position.x = -0.36 - up * 0.5
      armR.position.x = 0.36 + up * 0.5
      glow.intensity = 1.6 + Math.sin(time * 7) * 0.2
      face.update(time + 1.3)
    },
  }
}

// ---------- Zefi: a fluffy cloud that floats and hops ----------

export function makeZefi(): CreatureModel {
  const group = new THREE.Group()
  const body = new THREE.Group()
  group.add(body)

  const lift = 0.14 // Zefi floats a little above the ground
  const cloud = new THREE.MeshStandardMaterial({ vertexColors: true, emissive: 0x8cc4ff, emissiveIntensity: 0.06, roughness: 0.62 })
  addRim(cloud, 0xdff1ff, 2.0, 0.55)

  // the cloud is a cluster of puffs, white on top and pale blue below
  const puffData: [number, number, number, number][] = [
    [0, 0.44, 0, 0.3],
    [-0.3, 0.37, 0.03, 0.2],
    [0.3, 0.37, 0.03, 0.2],
    [-0.12, 0.69, -0.02, 0.19],
    [0.14, 0.67, 0, 0.16],
    [0, 0.79, -0.05, 0.13],
    [-0.2, 0.45, -0.2, 0.2],
    [0.2, 0.45, -0.2, 0.2],
    [0, 0.2, 0.02, 0.17],
    [-0.36, 0.55, -0.02, 0.1],
    [0.37, 0.52, -0.02, 0.11],
    [-0.04, 0.9, -0.08, 0.08],
  ]
  const puffs = puffData.map(([x, y, z, r], i) => {
    const geo = paintByHeight(new THREE.SphereGeometry(r, 32, 24), 0x86a2de, 0xdfe9fc)
    const m = new THREE.Mesh(geo, cloud)
    m.position.set(x, y + lift, z)
    if (i === 0) m.scale.set(1.1, 0.95, 1)
    body.add(m)
    return { mesh: m, base: m.position.clone(), seed: i }
  })

  // a swirly tail of small puffs
  for (const [x, y, z, r] of [[0, 0.1, -0.26, 0.1], [0.02, 0.04, -0.4, 0.07], [0, 0.0, -0.5, 0.045]] as const) {
    const m = new THREE.Mesh(paintByHeight(new THREE.SphereGeometry(r, 18, 12), 0x9bbbe0, 0xdbe9f7), cloud)
    m.position.set(x, y + lift, z)
    body.add(m)
  }

  // feathered wings: four rounded feathers each, fanned out
  const featherMat = new THREE.MeshStandardMaterial({ color: 0xc4d6f4, emissive: 0x7fa0e8, emissiveIntensity: 0.08, roughness: 0.55 })
  addRim(featherMat, 0xeaf6ff, 2.0, 0.5)
  const wings: THREE.Group[] = []
  for (const side of [-1, 1]) {
    const wing = new THREE.Group()
    wing.position.set(side * 0.36, 0.5 + lift, -0.06)
    for (const [angle, len] of [[0.7, 0.15], [0.35, 0.19], [0.0, 0.21], [-0.35, 0.16]] as const) {
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.1, 18, 12), featherMat)
      f.scale.set(len / 0.1, 0.5, 0.65)
      f.position.set(side * (0.06 + len * 0.7), Math.sin(angle) * 0.13, 0)
      f.rotation.z = side * angle
      wing.add(f)
    }
    body.add(wing)
    wings.push(wing)
  }

  const face = makeFace({
    eyeX: 0.15, eyeY: 0.55, eyeZ: 0.28, eyeR: 0.12, iris: 0x7b8cff, mouthY: 0.39, mouthZ: 0.32,
    cheekX: 0.23, cheekColor: 0xffa6c0, mouthColor: 0x4a6f9a, browColor: 0x5a80ad,
  })
  face.group.position.y = lift
  body.add(face.group)

  // little stars circling around
  const starMat = new THREE.MeshBasicMaterial({ color: 0xfff3b0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false })
  const stars = Array.from({ length: 5 }, (_, i) => {
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.04), starMat)
    body.add(m)
    return { mesh: m, seed: i }
  })

  const halo = aura(0.62, 0xbfe3ff, 0.06)
  halo.position.y = 0.5 + lift
    shadows(group)

  const glow = new THREE.PointLight(0xbfe3ff, 1.8, 6, 2)
  glow.position.set(0, 2.0, 0.1)
  group.add(glow)

  let mood: Mood = 'idle'
  return {
    group,
    body,
    glow,
    setMood: (m) => {
      mood = m
      face.setMood(m)
    },
    look: face.look,
    update: (time: number) => {
      const flap = mood === 'happy' ? 14 : 9
      wings.forEach((w, i) => {
        const side = i === 0 ? -1 : 1
        w.rotation.z = side * (0.15 + Math.sin(time * flap) * 0.3)
      })
      puffs.forEach(({ mesh, base, seed }) => {
        mesh.position.y = base.y + Math.sin(time * 2.6 + seed * 0.9) * 0.012
      })
      stars.forEach(({ mesh, seed }) => {
        const a = time * 1.3 + seed * 1.26
        mesh.position.set(Math.cos(a) * 0.62, 0.5 + lift + Math.sin(a * 1.7 + seed) * 0.22, Math.sin(a) * 0.5)
        mesh.rotation.y = time * 3
        mesh.scale.setScalar(0.7 + Math.sin(time * 5 + seed) * 0.3)
      })
      halo.scale.setScalar(1 + Math.sin(time * 2.2) * 0.05)
      glow.intensity = 1.8 + Math.sin(time * 5) * 0.25
      face.update(time + 0.7)
    },
  }
}
