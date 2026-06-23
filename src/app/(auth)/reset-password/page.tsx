import type { Metadata } from 'next'
import Link from 'next/link'
import { Card, CardBody } from '@/components/ui/card'
import { Alert } from '@/components/ui/alert'
import { ResetPasswordForm } from './reset-password-form'

export const metadata: Metadata = { title: 'Set a new password' }

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; email?: string }>
}) {
  const { token, email } = await searchParams

  if (!token || !email) {
    return (
      <div className="flex flex-col gap-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-slate-900">Reset link incomplete</h1>
        </div>
        <Card>
          <CardBody className="pt-6 text-center flex flex-col gap-3">
            <Alert variant="error">
              This password reset link is missing information. Please request a new one.
            </Alert>
            <Link href="/forgot-password" className="text-sm text-blue-600 hover:underline">
              Request a new reset link
            </Link>
          </CardBody>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-slate-900">Set a new password</h1>
        <p className="mt-1 text-sm text-slate-500">Choose a new password for your account</p>
      </div>
      <ResetPasswordForm token={token} email={email} />
    </div>
  )
}
