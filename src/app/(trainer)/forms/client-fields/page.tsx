import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { ClientFieldsConfig } from '../../settings/client-fields-config'
import { FormEditorPageChrome } from '../_editor-page-chrome'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Client capture fields' }

export default async function ClientFieldsPage() {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') redirect('/login')
  if (!session.user.trainerId) redirect('/login')

  return (
    <FormEditorPageChrome title="Client capture fields">
      <ClientFieldsConfig />
    </FormEditorPageChrome>
  )
}
