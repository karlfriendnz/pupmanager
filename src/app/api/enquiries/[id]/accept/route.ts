import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { acceptEnquiry, EnquiryError } from '@/lib/enquiries'
import { env } from '@/lib/env'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params

  const enquiry = await prisma.enquiry.findFirst({
    where: { id, trainerId },
    select: { id: true },
  })
  if (!enquiry) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    const reqUrl = new URL(req.url)
    const appUrl = env.NEXT_PUBLIC_APP_URL || `${reqUrl.protocol}//${reqUrl.host}`
    const clientProfileId = await acceptEnquiry(id, { appUrl })
    return NextResponse.json({ ok: true, clientProfileId })
  } catch (err) {
    if (err instanceof EnquiryError) {
      const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'USER_EXISTS' ? 409 : 400
      return NextResponse.json({ error: err.message, code: err.code }, { status })
    }
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[enquiries accept]', msg)
    return NextResponse.json({ error: 'Server error', detail: msg }, { status: 500 })
  }
}
