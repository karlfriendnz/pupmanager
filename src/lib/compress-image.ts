import imageCompression from 'browser-image-compression'

// Standard pre-upload image compression — the same library/settings session
// attachments have always used: brings a ~5 MB 12 MP phone photo down to
// ~1 MB / 2048px. This keeps payloads under Vercel's ~4.5 MB serverless
// request-body limit, which our formData upload routes (/api/dogs/[id]/photo,
// /api/upload/image, product/branding/email images …) all run through.
//
// Format handling:
//   • PNG / WebP  → kept as-is (preserve transparency — logos, graphics)
//   • JPEG / HEIC / HEIF / other raster → re-encoded as JPEG so it both
//     shrinks and displays everywhere (browsers can't render raw HEIC)
//   • SVG / GIF / non-images → returned untouched (don't rasterise vectors
//     or flatten animations; video etc. just passes through)
//
// Never throws: on any failure (SSR, worker error, undecodable file) it
// returns the original File so the upload still attempts exactly as before.

export async function compressImageFile(file: File): Promise<File> {
  if (typeof window === 'undefined') return file
  if (!file.type.startsWith('image/')) return file
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') return file

  // Formats that can carry an alpha channel are kept in their original type so
  // transparency survives; everything else converts to JPEG.
  const keepFormat = file.type === 'image/png' || file.type === 'image/webp'

  try {
    const out = await imageCompression(file, {
      maxSizeMB: 2,
      maxWidthOrHeight: 2048,
      useWebWorker: true,
      ...(keepFormat ? {} : { fileType: 'image/jpeg' }),
    })
    if (keepFormat) {
      return out instanceof File ? out : new File([out], file.name, { type: file.type })
    }
    const name = `${file.name.replace(/\.[^.]+$/, '') || 'photo'}.jpg`
    return new File([out], name, { type: 'image/jpeg' })
  } catch {
    return file
  }
}
