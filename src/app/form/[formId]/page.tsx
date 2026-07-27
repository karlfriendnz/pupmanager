import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { PublicForm } from './public-form'
import { PublicUnifiedForm } from './public-unified-form'
import { renderUnifiedForm } from '@/lib/unified-form-render'
import { DEFAULT_BRAND_COLOR } from '@/lib/brand'

export default async function PublicFormPage({
  params,
}: {
  params: Promise<{ formId: string }>
}) {
  const { formId } = await params

  const form = await prisma.embedForm.findFirst({
    where: { id: formId, isActive: true },
  })

  // No legacy EmbedForm under this id? Then it may be a unified Form published
  // as an enquiry form. Matched on `id`, not `slug` — slug is only unique per
  // trainer, so two trainers' identical slugs would collide on a public route.
  if (!form) {
    const unified = await prisma.form.findFirst({
      where: { id: formId, isActive: true, usableAsEnquiry: true },
      include: { trainer: { select: { businessName: true, logoUrl: true, emailAccentColor: true } } },
    })
    if (!unified) notFound()

    const { runnable, linkedFields } = await renderUnifiedForm(unified)
    const brand = unified.buttonColor || unified.trainer.emailAccentColor || DEFAULT_BRAND_COLOR

    return (
      <div style={{ ['--accent' as string]: brand } as React.CSSProperties}>
        <PublicUnifiedForm
          form={runnable}
          linkedFields={linkedFields}
          businessName={unified.trainer.businessName}
          trainerLogoUrl={unified.trainer.logoUrl}
          showBorder={unified.showBorder}
          thankYouTitle={unified.thankYouTitle}
          thankYouMessage={unified.thankYouMessage}
        />
      </div>
    )
  }

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
