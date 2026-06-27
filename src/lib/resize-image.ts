// Browser-side image downscaling, run just before an upload.
//
// Why this exists: our server-side upload routes (e.g. /api/dogs/[id]/photo,
// /api/upload/image) read the file from `formData()`, so the request runs
// through a Vercel serverless function — which caps the request body at
// ~4.5 MB. The route code allows 10 MB, but the platform rejects anything
// over ~4.5 MB before our handler runs. Modern phone photos routinely exceed
// that, which is why "image upload doesn't work" for clients on their phones.
//
// Shrinking the longest edge to ~1920px and re-encoding as JPEG brings a
// typical 4–9 MB photo well under the cap with no visible quality loss. This
// helper NEVER throws: if the browser can't decode the file (e.g. a raw HEIC
// on desktop) or anything else goes wrong, it returns the original File so the
// upload still attempts exactly as it did before.

export interface ResizeOptions {
  /** Longest edge in px after scaling. */
  maxDimension?: number
  /** JPEG quality, 0–1. */
  quality?: number
  /** Files at or below this many bytes pass through untouched. */
  skipUnderBytes?: number
}

// Pure: the scaled (width, height) for a source constrained to `maxDimension`
// on its longest edge, preserving aspect ratio. Never upscales. Exported so it
// can be unit-tested without a DOM/canvas.
export function fitWithin(
  width: number,
  height: number,
  maxDimension: number,
): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= maxDimension) return { width, height }
  const scale = maxDimension / longest
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

export async function resizeImageFile(file: File, opts: ResizeOptions = {}): Promise<File> {
  const {
    maxDimension = 1920,
    quality = 0.82,
    skipUnderBytes = 1.5 * 1024 * 1024,
  } = opts

  // SSR / non-browser guard.
  if (typeof document === 'undefined' || typeof createImageBitmap === 'undefined') return file
  // Only touch raster images, and never flatten animated GIFs.
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file
  if (file.size <= skipUnderBytes) return file

  try {
    // `from-image` applies the EXIF orientation so portrait phone photos don't
    // come out sideways.
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const { width, height } = fitWithin(bitmap.width, bitmap.height, maxDimension)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bitmap.close?.()
      return file
    }
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close?.()

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality),
    )
    // No blob, or re-encoding didn't actually save anything → keep the original.
    if (!blob || blob.size >= file.size) return file

    const baseName = file.name.replace(/\.[^.]+$/, '') || 'photo'
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' })
  } catch {
    return file
  }
}
