import { NextResponse } from 'next/server'
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { getTrainerContext } from '@/lib/membership'
import { can } from '@/lib/permissions'
import { prisma } from '@/lib/prisma'

// Vercel Blob client-upload handshake for a LIBRARY item's video — the same
// direct-to-Blob path the client's homework log and the trainer's session notes
// use, which bypasses the serverless body limit so a 100 MB phone clip uploads
// fine.
//
// The library item already took a video LINK (paste a YouTube URL). This is the
// other half: record or pick a clip and have it hosted, for a trainer who filmed
// the exercise themselves and has nowhere to put it.
//
// Nothing is persisted here. The resulting public blob URL is returned to the
// browser and saved by the item's own PATCH, so the token only authorises the
// upload — the same split as the homework-log route.
const VIDEO_MAX = 100 * 1024 * 1024 // 100 MB, matches the session-notes cap

export async function POST(
  req: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  // Same permission that governs the library itself ("Manage forms & library").
  if (!can('forms.manage', ctx.role, ctx.permissions)) {
    return NextResponse.json({ error: 'You don’t have permission to edit the library.' }, { status: 403 })
  }

  const { taskId } = await params

  // Only issue a token for an item inside THIS company's library. The tenant
  // boundary is two relations up (task → theme → type → trainer), and a token
  // issued without checking it would let one business upload into another's
  // catalogue.
  const task = await prisma.libraryTask.findFirst({
    where: { id: taskId, theme: { type: { trainerId: ctx.companyId } } },
    select: { id: true },
  })
  if (!task) return NextResponse.json({ error: 'Item not found' }, { status: 404 })

  const body = (await req.json()) as HandleUploadBody

  try {
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (_pathname, clientPayloadStr) => {
        // Re-validate the size server-side; never trust the client. We don't
        // restrict allowedContentTypes — iOS mislabels camera-roll clips
        // (video/quicktime for an .mp4, application/octet-stream) and Blob 400s
        // an unmatched MIME. Auth + ownership + size are the real guards.
        let sizeBytes = 0
        try { sizeBytes = JSON.parse(clientPayloadStr ?? '{}')?.sizeBytes ?? 0 } catch { /* ignore */ }
        if (sizeBytes > VIDEO_MAX) throw new Error('Video exceeds 100 MB')
        return { maximumSizeInBytes: VIDEO_MAX }
      },
      // Nothing to persist — the URL is saved by the item's PATCH.
      onUploadCompleted: async () => {},
    })
    return NextResponse.json(jsonResponse)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upload setup failed'
    console.error('[library video upload]', message)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
