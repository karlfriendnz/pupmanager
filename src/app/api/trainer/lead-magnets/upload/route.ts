import { NextResponse } from 'next/server'
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { getTrainerContext } from '@/lib/membership'
import { hasAddon } from '@/lib/billing'

// Vercel Blob client-upload handshake for lead-magnet files. The browser hits
// this to get a one-shot token, then uploads the file directly to Blob —
// bypassing the serverless ~4.5 MB request-body limit so PDFs/zips work. The
// resulting public URL is sent back to the editor, which persists it on the
// LeadMagnet row when the trainer saves (so there's no row to write here).
const MAX_BYTES = 50 * 1024 * 1024 // 50 MB

export async function POST(req: Request) {
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!(await hasAddon(ctx.companyId, 'leadmagnets'))) {
    return NextResponse.json({ error: 'This add-on isn\'t enabled.', code: 'ADDON_REQUIRED' }, { status: 403 })
  }

  const body = (await req.json()) as HandleUploadBody

  try {
    const json = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async () => ({
        maximumSizeInBytes: MAX_BYTES,
        // Allow documents + images; octet-stream covers browsers that don't
        // recognise an extension. Files land under a per-trainer prefix.
        allowedContentTypes: [
          'application/pdf', 'application/zip', 'application/x-zip-compressed',
          'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
          'application/octet-stream',
        ],
        tokenPayload: JSON.stringify({ trainerId: ctx.companyId }),
        addRandomSuffix: true,
      }),
      // Nothing to persist on completion — the URL is stored on the LeadMagnet
      // row when the trainer saves the magnet.
      onUploadCompleted: async () => {},
    })
    return NextResponse.json(json)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upload setup failed'
    console.error('[lead-magnet upload]', message)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
