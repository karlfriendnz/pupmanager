import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { FormEditorPageChrome } from '../_editor-page-chrome'
import { NewFormChoices } from './new-form-choices'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'New form' }

// One door into every kind of form. A full screen rather than a menu hanging
// off the "+" — each option gets room to say what it's for (AGENTS.md
// "Full screens, not dropdowns"), and whichever you pick lands you on the same
// editor shell.
export default async function NewFormPage() {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') redirect('/login')

  return (
    <FormEditorPageChrome title="New form">
      <NewFormChoices />
    </FormEditorPageChrome>
  )
}
