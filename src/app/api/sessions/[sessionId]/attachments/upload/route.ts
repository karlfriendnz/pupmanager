import { NextResponse } from 'next/server'
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// Vercel Blob client-upload handshake. The browser hits this twice:
//   1. before upload — to get a one-shot token (`onBeforeGenerateToken`)
//   2. after upload — Blob calls back here with the final URL
//      (`onUploadCompleted`) and we persist the SessionAttachment row.
// Direct-to-Blob upload bypasses our function's body limit, which lets
// us accept the 100 MB videos cap without setting up multipart streaming.
//
// Hard limits (also enforced client-side, but never trust the client):
//   image: 10 MB
//   video: 100 MB
const IMAGE_MAX = 10 * 1024 * 1024
const VIDEO_MAX = 100 * 1024 * 1024

export async function POST(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { sessionId } = await params

  // Verify the trainer owns this session before issuing a token.
  const owns = await prisma.trainingSession.findFirst({
    where: { id: sessionId, trainerId },
    select: { id: true },
  })
  if (!owns) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = (await req.json()) as HandleUploadBody

  try {
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayloadStr) => {
        // The client tells us {kind, sizeBytes, durationMs?, caption?}
        // through clientPayload. We re-validate the size against the
        // type-specific cap so a hostile client can't bypass it.
        const payload = parsePayload(clientPayloadStr)
        const isVideo = payload.kind === 'VIDEO'
        const isImage = payload.kind === 'IMAGE'
        if (!isVideo && !isImage) throw new Error('Unsupported attachment kind')
        const max = isVideo ? VIDEO_MAX : IMAGE_MAX
        if (payload.sizeBytes && payload.sizeBytes > max) {
          throw new Error(isVideo ? 'Video exceeds 100 MB' : 'Image exceeds 10 MB')
        }
        return {
          allowedContentTypes: isVideo
            ? ['video/mp4', 'video/quicktime', 'video/webm']
            : ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif'],
          maximumSizeInBytes: max,
          // The pathname itself stays untouched — Blob inserts a random
          // suffix when we set addRandomSuffix:true (default), giving
          // unguessable URLs without a separate signing layer.
          tokenPayload: JSON.stringify({
            trainerId,
            sessionId,
            kind: payload.kind,
            sizeBytes: payload.sizeBytes,
            durationMs: payload.durationMs ?? null,
            caption: payload.caption ?? null,
          }),
        }
      },

      onUploadCompleted: async ({ blob, tokenPayload }) => {
        if (!tokenPayload) return
        const meta = JSON.parse(tokenPayload) as {
          trainerId: string
          sessionId: string
          kind: 'IMAGE' | 'VIDEO'
          sizeBytes: number
          durationMs: number | null
          caption: string | null
        }
        await prisma.sessionAttachment.create({
          data: {
            sessionId: meta.sessionId,
            trainerId: meta.trainerId,
            kind: meta.kind,
            url: blob.url,
            sizeBytes: meta.sizeBytes,
            durationMs: meta.durationMs,
            caption: meta.caption,
          },
        })
      },
    })
    return NextResponse.json(jsonResponse)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upload setup failed'
    console.error('[session attachments upload]', message)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

function parsePayload(raw: string | null): {
  kind?: 'IMAGE' | 'VIDEO'
  sizeBytes?: number
  durationMs?: number | null
  caption?: string | null
} {
  if (!raw) return {}
  try { return JSON.parse(raw) } catch { return {} }
}
