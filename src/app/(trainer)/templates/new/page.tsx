import { TemplateBuilderForm } from '../template-builder-form'
import { PageHeader } from '@/components/shared/page-header'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'New template' }

export default function NewTemplatePage() {
  return (
    <>
      <PageHeader
        title="New training template"
        back={{ href: '/templates', label: 'Back to library' }}
      />
      <div className="p-4 md:p-8 w-full max-w-2xl mx-auto">
        <TemplateBuilderForm />
      </div>
    </>
  )
}
