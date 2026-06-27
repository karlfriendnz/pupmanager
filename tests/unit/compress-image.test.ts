import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

// The shared pre-upload compressor wraps browser-image-compression. We mock
// the library and assert the format policy: photos/HEIC → JPEG, PNG/WebP kept
// (alpha preserved), SVG/GIF/non-images and failures passed straight through.
// The util early-returns when `window` is undefined (SSR guard); the test env
// is node, so we stub a window so the real logic runs (no DOM/canvas needed —
// the library call is mocked).
vi.mock('browser-image-compression', () => ({ default: vi.fn() }))
import imageCompression from 'browser-image-compression'
import { compressImageFile } from '@/lib/compress-image'

const mock = vi.mocked(imageCompression)

function file(type: string, name: string, bytes = 4 * 1024 * 1024) {
  return new File([new Uint8Array(bytes)], name, { type })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('window', {})
  // Default: echo a tiny compressed File back.
  mock.mockImplementation(async (f: File) => new File([new Uint8Array(1024)], f.name, { type: f.type }))
})

afterAll(() => { vi.unstubAllGlobals() })

describe('compressImageFile', () => {
  it('converts a JPEG photo to a re-encoded .jpg', async () => {
    const out = await compressImageFile(file('image/jpeg', 'pup.jpeg'))
    expect(mock).toHaveBeenCalledTimes(1)
    expect(mock.mock.calls[0][1]).toMatchObject({ fileType: 'image/jpeg', maxWidthOrHeight: 2048 })
    expect(out.type).toBe('image/jpeg')
    expect(out.name).toMatch(/\.jpg$/)
  })

  it('converts HEIC (which browsers cannot render) to JPEG', async () => {
    const out = await compressImageFile(file('image/heic', 'IMG_1.heic'))
    expect(mock.mock.calls[0][1]).toMatchObject({ fileType: 'image/jpeg' })
    expect(out.type).toBe('image/jpeg')
  })

  it('keeps PNG as PNG so transparency survives (no fileType override)', async () => {
    const out = await compressImageFile(file('image/png', 'logo.png'))
    expect(mock).toHaveBeenCalledTimes(1)
    expect(mock.mock.calls[0][1]).not.toHaveProperty('fileType')
    expect(out.type).toBe('image/png')
  })

  it('keeps WebP as WebP', async () => {
    const out = await compressImageFile(file('image/webp', 'g.webp'))
    expect(mock.mock.calls[0][1]).not.toHaveProperty('fileType')
    expect(out.type).toBe('image/webp')
  })

  it('passes SVG straight through (never rasterise a vector)', async () => {
    const svg = file('image/svg+xml', 'logo.svg')
    const out = await compressImageFile(svg)
    expect(mock).not.toHaveBeenCalled()
    expect(out).toBe(svg)
  })

  it('passes animated GIF and non-images straight through', async () => {
    const gif = file('image/gif', 'a.gif')
    const vid = file('video/mp4', 'clip.mp4')
    expect(await compressImageFile(gif)).toBe(gif)
    expect(await compressImageFile(vid)).toBe(vid)
    expect(mock).not.toHaveBeenCalled()
  })

  it('falls back to the original file if compression throws', async () => {
    const orig = file('image/jpeg', 'pic.jpg')
    mock.mockRejectedValueOnce(new Error('worker died'))
    expect(await compressImageFile(orig)).toBe(orig)
  })
})
