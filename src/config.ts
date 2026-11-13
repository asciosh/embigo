// Settings you may want to change.

// Your public Ko-fi page, for example 'https://ko-fi.com/yourname'.
// Leave it as '' and the "Support" buttons stay hidden.
export const KOFI_URL = 'https://ko-fi.com/asciosh'

export type Theme = 'classic' | 'deep' | 'volcano'

export const THEMES: Record<Theme, { ground: number; ambient: number; fog: number; music: number }> = {
  classic: { ground: 0xeef6ff, ambient: 0x404040, fog: 0x0b1626, music: 55 },
  deep: { ground: 0x1a1a2e, ambient: 0x202040, fog: 0x050510, music: 40 },
  volcano: { ground: 0x2e1a1a, ambient: 0x402020, fog: 0x1a0505, music: 35 }
}

