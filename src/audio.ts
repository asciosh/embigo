// Audio system: simple procedural sound effects and background music using Web Audio API.
// No external audio files needed.

let audioContext: AudioContext | null = null
let masterGain: GainNode | null = null
let musicGain: GainNode | null = null
let sfxGain: GainNode | null = null
let musicOn = true
let sfxOn = true
let currentMusic: OscillatorNode | null = null
let musicTimer: number | null = null
let filter: BiquadFilterNode | null = null

function initAudio(): void {
  if (audioContext) return
  try {
    audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
    masterGain = audioContext.createGain()
    masterGain.gain.value = 0.7
    masterGain.connect(audioContext.destination)
    musicGain = audioContext.createGain()
    musicGain.gain.value = 0.12
    musicGain.connect(masterGain)
    sfxGain = audioContext.createGain()
    sfxGain.gain.value = 0.5
    sfxGain.connect(masterGain)
  } catch {
    // audio not supported
  }
}

export function resumeAudio(): void {
  if (audioContext && audioContext.state === 'suspended') {
    audioContext.resume()
  }
}

export function toggleAudio(): { sfx: boolean; music: boolean } {
  sfxOn = !sfxOn
  musicOn = !musicOn
  if (masterGain) masterGain.gain.value = (sfxOn && musicOn) ? 0.7 : 0
  if (!musicOn) stopMusic()
  else if (audioContext && !currentMusic) startMusic()
  return { sfx: sfxOn, music: musicOn }
}

export function isAudioOn(): boolean {
  return sfxOn && musicOn
}

export function setAudio(on: boolean): void {
  sfxOn = on
  musicOn = on
  if (masterGain) masterGain.gain.value = on ? 0.7 : 0
  if (!on) stopMusic()
  else if (audioContext && !currentMusic) startMusic()
}

export function getAudioState(): { sfx: boolean; music: boolean } {
  return { sfx: sfxOn, music: musicOn }
}

// Simple beep using an oscillator
function beep(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.3): void {
  if (!audioContext || !sfxGain || !sfxOn) return
  const osc = audioContext.createOscillator()
  const gain = audioContext.createGain()
  osc.type = type
  osc.frequency.value = freq
  gain.gain.value = vol
  osc.connect(gain)
  gain.connect(sfxGain)
  const now = audioContext.currentTime
  gain.gain.setValueAtTime(vol, now)
  gain.gain.exponentialRampToValueAtTime(0.001, now + dur)
  osc.start(now)
  osc.stop(now + dur)
}

// Sound effects
export function sfxMove(): void {
  beep(440, 0.06, 'sine', 0.12)
}

export function sfxBurn(): void {
  if (!audioContext || !sfxGain || !sfxOn) return
  const osc = audioContext.createOscillator()
  const gain = audioContext.createGain()
  osc.type = 'sawtooth'
  osc.frequency.setValueAtTime(200, audioContext.currentTime)
  osc.frequency.exponentialRampToValueAtTime(50, audioContext.currentTime + 0.3)
  gain.gain.setValueAtTime(0.25, audioContext.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.3)
  osc.connect(gain)
  gain.connect(sfxGain)
  osc.start()
  osc.stop(audioContext.currentTime + 0.3)
}

export function sfxJump(): void {
  beep(660, 0.1, 'triangle', 0.18)
}

export function sfxWin(): void {
  if (!audioContext || !sfxGain || !sfxOn) return
  const notes = [523.25, 659.25, 783.99, 1046.5]
  notes.forEach((freq, i) => {
    setTimeout(() => beep(freq, 0.2, 'sine', 0.18), i * 120)
  })
}

export function sfxDeadEnd(): void {
  beep(150, 0.3, 'sawtooth', 0.18)
}

export function sfxRelic(): void {
  if (!audioContext || !sfxGain || !sfxOn) return
  const notes = [880, 1108.73, 1318.51]
  notes.forEach((freq, i) => {
    setTimeout(() => beep(freq, 0.15, 'sine', 0.12), i * 80)
  })
}

export function sfxFail(): void {
  beep(100, 0.4, 'sawtooth', 0.22)
}

export function sfxShield(): void {
  beep(330, 0.2, 'sine', 0.18)
}

export function sfxPerfect(): void {
  beep(880, 0.15, 'sine', 0.2)
}

// Background music: a simple ambient loop with slow filter sweep
export function startMusic(): void {
  if (!audioContext || !musicGain || !musicOn) return
  if (currentMusic) return
  initAudio()
  const osc = audioContext!.createOscillator()
  filter = audioContext!.createBiquadFilter()
  const gain = audioContext!.createGain()
  osc.type = 'sine'
  osc.frequency.value = 55 // A1
  filter.type = 'lowpass'
  filter.frequency.value = 200
  filter.Q.value = 2
  gain.gain.value = 0.25
  osc.connect(filter)
  filter.connect(gain)
  gain.connect(musicGain!)
  osc.start()
  currentMusic = osc

  // Slow filter sweep
  let sweepUp = true
  const sweep = () => {
    if (!currentMusic || !musicOn || !filter) return
    const now = audioContext!.currentTime
    filter.frequency.setValueAtTime(200, now)
    filter.frequency.linearRampToValueAtTime(sweepUp ? 800 : 200, now + 4)
    sweepUp = !sweepUp
    musicTimer = window.setTimeout(sweep, 4000)
  }
  sweep()
}

export function stopMusic(): void {
  if (currentMusic) {
    try { currentMusic.stop() } catch {}
    currentMusic = null
  }
  if (musicTimer) {
    window.clearTimeout(musicTimer)
    musicTimer = null
  }
  filter = null
}

// Initialize on first user gesture
export function initAudioOnGesture(): void {
  initAudio()
  resumeAudio()
  if (isAudioOn()) startMusic()
}