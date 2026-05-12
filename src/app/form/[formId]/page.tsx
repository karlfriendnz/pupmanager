import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { PublicForm } from './public-form'

export default async function PublicFormPage({
  params,
}: {
  params: Promise<{ formId: string }>
}) {
  const { formId } = await params

  const form = await prisma.embedForm.findFirst({
    where: { id: formId, isActive: true },
  })
  if (!form) notFound()

  const enabledCustomFieldIds = Array.isArray(form.customFieldIds) ? form.customFieldIds as string[] : []
  const customFields = enabledCustomFieldIds.length > 0
    ? await prisma.customField.findMany({
        where: { id: { in: enabledCustomFieldIds } },
        orderBy: { order: 'asc' },
      })
    : []

  const fields = Array.isArray(form.fields)
    ? form.fields as { key: string; required: boolean }[]
    : []

  return (
    <PublicForm
      formId={form.id}
      description={form.description}
      thankYouTitle={form.thankYouTitle}
      thankYouMessage={form.thankYouMessage}
      showBorder={form.showBorder}
      buttonColor={form.buttonColor}
      fields={fields}
      customFields={customFields.map(f => ({
        id: f.id,
        label: f.label,
        type: f.type as 'TEXT' | 'NUMBER' | 'DROPDOWN',
        required: f.required,
        options: Array.isArray(f.options) ? f.options as string[] : [],
      }))}
    />
  )
}
