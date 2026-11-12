// Graphics quality. "auto" starts at high and steps down by itself if the device cannot keep up.

export type Quality = 'high' | 'medium' | 'low'
export type QualitySetting = 'auto' | Quality

export const QUALITY: Record<Quality, { bloom: boolean; shadows: number; pixelRatio: number; snow: number; aurora: boolean; dust: number }> = {
  high: { bloom: true, shadows: 2048, pixelRatio: 2, snow: 0.65, aurora: true, dust: 90 },
  medium: { bloom: false, shadows: 1024, pixelRatio: 1.5, snow: 0.45, aurora: true, dust: 40 },
  low: { bloom: false, shadows: 512, pixelRatio: 1, snow: 0.25, aurora: false, dust: 0 },
}

const KEY = 'embigo-quality'
const isQuality = (v: unknown): v is Quality => v === 'high' || v === 'medium' || v === 'low'

// ?quality=high|medium|low in the address forces a level (handy for testing and support)
export function readQualitySetting(): QualitySetting {
  const fromUrl = new URLSearchParams(window.location.search).get('quality')
  if (isQuality(fromUrl)) return fromUrl
  try {
    const saved = localStorage.getItem(KEY)
    if (isQuality(saved)) return saved
  } catch {
    // storage blocked: use auto
  }
  return 'auto'
}

export function saveQualitySetting(setting: QualitySetting): void {
  try {
    localStorage.setItem(KEY, setting)
  } catch {
    // ignore
  }
}

// What "auto" settled on last time, so the next visit starts there instead of starting high again
const AUTO_KEY = 'embigo-quality-auto'

export function readAutoTier(): Quality {
  try {
    const saved = localStorage.getItem(AUTO_KEY)
    if (isQuality(saved)) return saved
  } catch {
    // storage blocked: start high
  }
  return 'high'
}

export function saveAutoTier(tier: Quality): void {
  try {
    localStorage.setItem(AUTO_KEY, tier)
  } catch {
    // ignore
  }
}
