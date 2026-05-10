'use client'

import { useRouter } from 'next/navigation'
import { IntakeGate } from '@/app/(client)/intake-gate'

// Sample dog so DOG-scoped sections render in preview without the trainer
// needing real client data. Name from the recurring "Sarah & Bailey" cast.
const SAMPLE_DOGS = [{ id: 'preview-dog', name: 'Bailey (sample)' }]

interface CustomFieldShape {
  id: string
  label: string
  type: 'TEXT' | 'NUMBER' | 'DROPDOWN'
  required: boolean
  options: string[]
  category: string | null
  appliesTo: 'OWNER' | 'DOG'
}

export function IntakeGatePreview({
  businessName,
  trainerLogoUrl,
  customFields,
  sectionMeta,
}: {
  businessName: string
  trainerLogoUrl: string | null
  customFields: CustomFieldShape[]
  sectionMeta: { name: string; description: string | null }[]
}) {
  const router = useRouter()
  return (
    <IntakeGate
      businessName={businessName}
      trainerLogoUrl={trainerLogoUrl}
      customFields={customFields}
      sectionMeta={sectionMeta}
      dogs={SAMPLE_DOGS}
      existingValues={{}}
      preview
      onPreviewExit={() => router.push('/forms/intake')}
    />
  )
}
