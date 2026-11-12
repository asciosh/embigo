import * as THREE from 'three'

// A small, made-up "cold cave" environment (a gradient dome and a few soft light panels).
// It is turned into a reflection map once, so the ice, the water drop and the crystals get
// nice reflections for almost no cost.
export function makeEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const scene = new THREE.Scene()

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(10, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader:
        'varying vec3 vP; void main(){ float h = vP.y * 0.5 + 0.5; vec3 c = mix(vec3(0.02,0.05,0.12), vec3(0.08,0.28,0.45), smoothstep(0.0,0.5,h)); c = mix(c, vec3(0.5,0.75,1.0), smoothstep(0.5,1.0,h)); gl_FragColor = vec4(c, 1.0); }',
    }),
  )
  scene.add(dome)

  const panel = (color: number, strength: number, w: number, h: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(strength), side: THREE.DoubleSide }))
    m.position.set(x, y, z)
    m.lookAt(0, 0, 0)
    scene.add(m)
  }
  panel(0xfff1dc, 6, 5, 3, -4, 7, 5) // warm key light
  panel(0x55c8ff, 4, 4, 6, 7, 3, -2) // cyan fill from the right
  panel(0xc77bff, 3, 4, 4, -7, 2, -4) // violet rim from behind
  panel(0xffffff, 2, 8, 2, 0, 9, 0) // soft top light

  const pmrem = new THREE.PMREMGenerator(renderer)
  const texture = pmrem.fromScene(scene, 0.03).texture
  pmrem.dispose()
  return texture
}
