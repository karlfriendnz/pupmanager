import { NextResponse } from 'next/server'
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { getTrainerContext } from '@/lib/membership'
import { hasAddon } from '@/lib/billing'

// Vercel Blob CLIENT-upload handshake for library item media (one picture, one
// handout). The browser asks here for a one-shot token and then uploads
// straight to Blob, which is the only way a multi-MB PDF gets through — a
// formData POST to a serverless function dies at Vercel's ~4.5 MB body cap
// (that limit is exactly why images are compressed client-side before they get
// here; see src/lib/compress-image.ts).
//
// Nothing is persisted on completion: the returned URL is written onto the
// LibraryTask row by the item page's normal save.
const MAX_BYTES = 20 * 1024 * 1024 // 20 MB — comfortably above a photo or a handout

const ALLOWED_CONTENT_TYPES = [
  'application/pdf',
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
]

export async function POST(req: Request) {
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!(await hasAddon(ctx.companyId, 'library'))) {
    return NextResponse.json({ error: 'This add-on isn\'t enabled.', code: 'ADDON_REQUIRED' }, { status: 403 })
  }

  const body = (await req.json()) as HandleUploadBody

  try {
    const json = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async () => ({
        maximumSizeInBytes: MAX_BYTES,
        allowedContentTypes: ALLOWED_CONTENT_TYPES,
        tokenPayload: JSON.stringify({ trainerId: ctx.companyId }),
        addRandomSuffix: true,
      }),
      onUploadCompleted: async () => {},
    })
    return NextResponse.json(json)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upload setup failed'
    console.error('[library upload]', message)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
