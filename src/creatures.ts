import * as THREE from 'three'

export type CreatureModel = {
  group: THREE.Group // put this in the scene and move it around
  body: THREE.Group // squashed / stretched / bobbed by the view
  glow: THREE.PointLight
  update: (time: number) => void
}

function makeEyes(): { eyes: THREE.Group; blink: (time: number) => void } {
  const eyes = new THREE.Group()
  const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 })
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1a24, roughness: 0.15 })
  const shine = new THREE.MeshBasicMaterial({ color: 0xffffff })
  for (const side of [-1, 1]) {
    const eye = new THREE.Group()
    eye.position.set(side * 0.135, 0.44, 0.27)
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.095, 20, 16), white)
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.056, 16, 12), dark)
    pupil.position.set(0, -0.005, 0.05)
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 8), shine)
    glint.position.set(0.02, 0.025, 0.098)
    eye.add(ball, pupil, glint)
    eyes.add(eye)
  }
  return {
    eyes,
    blink: (time: number) => {
      const closed = time % 3.7 < 0.12
      eyes.scale.y = closed ? 0.12 : 1
    },
  }
}

function makeSmile(color: number): THREE.Mesh {
  const smile = new THREE.Mesh(
    new THREE.TorusGeometry(0.07, 0.014, 8, 24, Math.PI),
    new THREE.MeshStandardMaterial({ color, roughness: 0.6 }),
  )
  smile.rotation.z = Math.PI // arc opening upwards: a smile
  smile.position.set(0, 0.325, 0.335)
  return smile
}

function shadows(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true
  })
}

// Embi: a round little flame with a wobbling tip
export function makeEmbi(): CreatureModel {
  const group = new THREE.Group()
  const body = new THREE.Group()
  group.add(body)

  const skin = new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0xff3a00, emissiveIntensity: 0.45, roughness: 0.55 })
  const core = new THREE.MeshStandardMaterial({ color: 0xffc233, emissive: 0xffa000, emissiveIntensity: 0.9, roughness: 0.4 })
  const feetMat = new THREE.MeshStandardMaterial({ color: 0x9a2f0c, roughness: 0.7 })

  const torso = new THREE.Mesh(new THREE.SphereGeometry(0.34, 32, 24), skin)
  torso.scale.set(1, 1.06, 1)
  torso.position.y = 0.36

  const tip = new THREE.Group()
  tip.position.y = 0.6
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.21, 0.55, 24), skin)
  flame.position.y = 0.2
  const inner = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.34, 20), core)
  inner.position.set(0, 0.14, 0.04)
  const sideL = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.3, 16), skin)
  sideL.position.set(-0.17, 0.1, 0)
  sideL.rotation.z = 0.35
  const sideR = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.26, 16), skin)
  sideR.position.set(0.17, 0.08, 0)
  sideR.rotation.z = -0.4
  tip.add(flame, inner, sideL, sideR)

  const { eyes, blink } = makeEyes()

  const footGeo = new THREE.SphereGeometry(0.09, 12, 10)
  const footL = new THREE.Mesh(footGeo, feetMat)
  footL.scale.set(1.1, 0.6, 1.3)
  footL.position.set(-0.14, 0.05, 0.1)
  const footR = footL.clone()
  footR.position.x = 0.14

  body.add(torso, tip, eyes, makeSmile(0x5a1a08), footL, footR)
  shadows(group)

  const glow = new THREE.PointLight(0xff8a3a, 1.8, 5, 2)
  glow.position.set(0, 1.1, 0.1)
  group.add(glow)

  return {
    group,
    body,
    glow,
    update: (time: number) => {
      tip.rotation.z = Math.sin(time * 5) * 0.14
      tip.rotation.x = Math.sin(time * 4.3) * 0.1
      tip.scale.y = 1 + Math.sin(time * 9) * 0.09
      glow.intensity = 1.8 + Math.sin(time * 11) * 0.3
      blink(time)
    },
  }
}

// Drip: a cheerful water drop
export function makeDrip(): CreatureModel {
  const group = new THREE.Group()
  const body = new THREE.Group()
  group.add(body)

  const water = new THREE.MeshStandardMaterial({
    color: 0x3fa9ff,
    emissive: 0x1565c0,
    emissiveIntensity: 0.35,
    roughness: 0.12,
    metalness: 0.05,
    transparent: true,
    opacity: 0.93,
  })
  const light = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 })
  const feetMat = new THREE.MeshStandardMaterial({ color: 0x1f6fd1, roughness: 0.3 })

  const torso = new THREE.Mesh(new THREE.SphereGeometry(0.34, 32, 24), water)
  torso.position.y = 0.36

  const tip = new THREE.Group()
  tip.position.y = 0.5
  const drop = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.5, 28), water)
  drop.position.y = 0.2
  tip.add(drop)

  const highlight = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), light)
  highlight.scale.set(0.8, 1.5, 0.5)
  highlight.position.set(-0.19, 0.5, 0.22)
  highlight.rotation.z = 0.5

  const { eyes, blink } = makeEyes()

  const footGeo = new THREE.SphereGeometry(0.09, 12, 10)
  const footL = new THREE.Mesh(footGeo, feetMat)
  footL.scale.set(1.1, 0.6, 1.3)
  footL.position.set(-0.14, 0.05, 0.1)
  const footR = footL.clone()
  footR.position.x = 0.14

  body.add(torso, tip, highlight, eyes, makeSmile(0x0b3a7a), footL, footR)
  shadows(group)

  const glow = new THREE.PointLight(0x58b8ff, 1.0, 4.5, 2)
  glow.position.set(0, 1.1, 0.1)
  group.add(glow)

  return {
    group,
    body,
    glow,
    update: (time: number) => {
      tip.rotation.z = Math.sin(time * 3.2) * 0.1
      tip.scale.y = 1 + Math.sin(time * 6) * 0.05
      glow.intensity = 1.0 + Math.sin(time * 7) * 0.12
      blink(time + 1.3)
    },
  }
}

// Zefi: a little cloud that floats a bit above the ground and hops over obstacles
export function makeZefi(): CreatureModel {
  const group = new THREE.Group()
  const body = new THREE.Group()
  group.add(body)

  const lift = 0.14 // Zefi floats
  const cloud = new THREE.MeshStandardMaterial({ color: 0xf4fbff, emissive: 0x8cc4ff, emissiveIntensity: 0.28, roughness: 0.55 })
  const shade = new THREE.MeshStandardMaterial({ color: 0xcfe6fb, emissive: 0x6aa8ee, emissiveIntensity: 0.25, roughness: 0.6 })

  const puff = (r: number, x: number, y: number, z: number, mat: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 18), mat)
    m.position.set(x, y + lift, z)
    return m
  }

  const core = puff(0.31, 0, 0.38, 0, cloud)
  core.scale.set(1.1, 0.95, 1)
  const left = puff(0.2, -0.28, 0.3, 0, cloud)
  const right = puff(0.2, 0.28, 0.3, 0, cloud)
  const topL = puff(0.19, -0.1, 0.62, -0.02, cloud)
  const topR = puff(0.16, 0.13, 0.6, 0, cloud)
  const belly = puff(0.17, 0, 0.12, 0.02, shade)

  // two tiny wings that flap
  const wingGeo = new THREE.SphereGeometry(0.11, 14, 10)
  const wingL = new THREE.Mesh(wingGeo, shade)
  wingL.scale.set(1.4, 0.45, 0.8)
  wingL.position.set(-0.42, 0.46 + lift, -0.02)
  const wingR = wingL.clone()
  wingR.position.x = 0.42

  const { eyes, blink } = makeEyes()
  eyes.scale.setScalar(1.2) // a bigger cloud needs bigger eyes
  eyes.position.set(0, 0.09, -0.02)
  const smile = makeSmile(0x4a6f9a)
  smile.position.set(0, 0.5, 0.335)

  body.add(core, left, right, topL, topR, belly, wingL, wingR, eyes, smile)
  shadows(group)

  const glow = new THREE.PointLight(0xbfe3ff, 1.4, 4.5, 2)
  glow.position.set(0, 1.1, 0.1)
  group.add(glow)

  return {
    group,
    body,
    glow,
    update: (time: number) => {
      wingL.rotation.z = 0.3 + Math.sin(time * 9) * 0.35
      wingR.rotation.z = -0.3 - Math.sin(time * 9) * 0.35
      left.position.y = 0.3 + lift + Math.sin(time * 3.1) * 0.015
      right.position.y = 0.3 + lift + Math.sin(time * 3.1 + 1.6) * 0.015
      topL.scale.setScalar(1 + Math.sin(time * 2.4) * 0.04)
      glow.intensity = 1.4 + Math.sin(time * 5) * 0.2
      blink(time + 0.7)
    },
  }
}
