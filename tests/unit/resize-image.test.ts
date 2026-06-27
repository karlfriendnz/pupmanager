import { describe, it, expect } from 'vitest'
import { fitWithin, resizeImageFile } from '@/lib/resize-image'

// fitWithin is the pure scaling maths behind the pre-upload downscale. The
// canvas work itself needs a browser, but this is where the correctness lives.
describe('fitWithin', () => {
  it('leaves images already within the bound untouched', () => {
    expect(fitWithin(800, 600, 1920)).toEqual({ width: 800, height: 600 })
    expect(fitWithin(1920, 1080, 1920)).toEqual({ width: 1920, height: 1080 })
  })

  it('scales a landscape photo by its longest edge, preserving aspect', () => {
    expect(fitWithin(4000, 3000, 1920)).toEqual({ width: 1920, height: 1440 })
  })

  it('scales a portrait photo by its longest edge', () => {
    expect(fitWithin(3000, 4000, 1920)).toEqual({ width: 1440, height: 1920 })
  })

  it('handles a square photo', () => {
    expect(fitWithin(4000, 4000, 1920)).toEqual({ width: 1920, height: 1920 })
  })

  it('never upscales', () => {
    expect(fitWithin(100, 100, 1920)).toEqual({ width: 100, height: 100 })
  })
})

describe('resizeImageFile', () => {
  it('returns the original file unchanged when no DOM is available (SSR / node)', async () => {
    const file = new File([new Uint8Array(2 * 1024 * 1024)], 'big.jpg', { type: 'image/jpeg' })
    const out = await resizeImageFile(file)
    // No browser here, so it must pass the file straight through, never throw.
    expect(out).toBe(file)
  })
})
