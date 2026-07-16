import { NextResponse } from 'next/server'
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// Vercel Blob client-upload handshake for a client's homework-log video — the
// SAME direct-to-Blob path the trainer's session notes use (see
// sessions/[id]/attachments/upload), which bypasses the serverless body limit so
// a 100 MB phone clip uploads fine. Unlike session attachments we DON'T persist
// a row here: the resulting public blob URL is returned to the browser and rides
// along in the log POST (/api/tasks/[taskId]/logs → TrainingLog.videoUrl), so
// there's nothing to save on completion — the token just authorises the upload.
const VIDEO_MAX = 100 * 1024 * 1024 // 100 MB, matches the session-notes cap

export async function POST(
  req: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const session = await auth()
  if (!session || session.user.role !== 'CLIENT') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const { taskId } = await params

  // Only issue a token for a task that belongs to one of THIS user's profiles.
  const task = await prisma.trainingTask.findFirst({
    where: { id: taskId, client: { userId: session.user.id } },
    select: { id: true },
  })
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const body = (await req.json()) as HandleUploadBody

  try {
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (_pathname, clientPayloadStr) => {
        // Re-validate the size server-side; never trust the client. We don't
        // restrict allowedContentTypes — iOS mislabels camera-roll clips
        // (video/quicktime for an .mp4, application/octet-stream) and Blob 400s
        // an unmatched MIME. Auth + size + the CLIENT role are the real guards.
        let sizeBytes = 0
        try { sizeBytes = JSON.parse(clientPayloadStr ?? '{}')?.sizeBytes ?? 0 } catch { /* ignore */ }
        if (sizeBytes > VIDEO_MAX) throw new Error('Video exceeds 100 MB')
        return { maximumSizeInBytes: VIDEO_MAX }
      },
      // Nothing to persist — the URL is saved on the TrainingLog by the log POST.
      onUploadCompleted: async () => {},
    })
    return NextResponse.json(jsonResponse)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upload setup failed'
    console.error('[homework video upload]', message)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
