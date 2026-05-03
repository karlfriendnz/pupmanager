import type { Metadata } from 'next'
import { Card, CardBody } from '@/components/ui/card'

export const metadata: Metadata = { title: 'Check your email' }

export default function VerifyEmailPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-100 text-3xl">
          📬
        </div>
        <h1 className="text-2xl font-bold text-slate-900">Check your email</h1>
        <p className="mt-1 text-sm text-slate-500">We&apos;ve sent you a login link</p>
      </div>
      <Card>
        <CardBody className="pt-6 text-center text-sm text-slate-600 flex flex-col gap-3">
          <p>Click the link in your email to sign in to PupManager.</p>
          <p className="text-slate-400 text-xs">
            The link expires in 15 minutes. Check your spam folder if you don&apos;t see it.
          </p>
        </CardBody>
      </Card>
    </div>
  )
}
