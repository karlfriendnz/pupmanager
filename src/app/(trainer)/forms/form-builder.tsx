'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm, useFieldArray, Controller, useWatch } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardBody } from '@/components/ui/card'
import { Alert } from '@/components/ui/alert'
import { Plus, Trash2, GripVertical, Copy, ExternalLink } from 'lucide-react'

const fieldSchema = z.object({
  type: z.enum(['TEXT', 'MULTIPLE_CHOICE', 'DROPDOWN']),
  label: z.string().min(1, 'Label required'),
  required: z.boolean(),
  options: z.array(z.string()),
  order: z.number(),
})

const sectionSchema = z.object({
  title: z.string().min(1, 'Section title required'),
  order: z.number(),
  fields: z.array(fieldSchema),
})

const schema = z.object({
  name: z.string().min(2, 'Form name required'),
  description: z.string().optional(),
  isPublished: z.boolean(),
  sections: z.array(sectionSchema).min(1, 'Add at least one section'),
})

type FormData = z.infer<typeof schema>

type FormControl = ReturnType<typeof useForm<FormData>>['control']
type FormRegister = ReturnType<typeof useForm<FormData>>['register']

const FIELD_TYPES = [
  { value: 'TEXT' as const, label: 'Text answer' },
  { value: 'MULTIPLE_CHOICE' as const, label: 'Multiple choice' },
  { value: 'DROPDOWN' as const, label: 'Dropdown' },
]

export function FormBuilder({
  formId,
  defaultValues,
  appUrl,
}: {
  formId?: string
  defaultValues?: Partial<FormData>
  appUrl: string
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: defaultValues ?? {
      name: '',
      description: '',
      isPublished: false,
      sections: [{
        title: 'Your details',
        order: 0,
        fields: [{ type: 'TEXT', label: 'Full name', required: true, options: [], order: 0 }],
      }],
    },
  })

  const { register, control, handleSubmit, formState: { errors, isSubmitting } } = form
  const { fields: sections, append: appendSection, remove: removeSection } = useFieldArray({ control, name: 'sections' })
  const isPublished = useWatch({ control, name: 'isPublished' })

  const publicUrl = formId ? `${appUrl}/f/${formId}` : null
  const embedCode = publicUrl ? `<iframe src="${publicUrl}" width="100%" height="600" frameborder="0"></iframe>` : null

  async function onSubmit(data: FormData) {
    setError(null)
    const url = formId ? `/api/forms/${formId}` : '/api/forms'
    const res = await fetch(url, {
      method: formId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) { setError('Failed to save form.'); return }
    const saved = await res.json()
    router.push(`/forms/${saved.id}/edit`)
    router.refresh()
  }

  function copyEmbed() {
    if (embedCode) {
      navigator.clipboard.writeText(embedCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6">
      {error && <Alert variant="error">{error}</Alert>}

      {/* Form details */}
      <Card>
        <CardBody className="pt-5 flex flex-col gap-4">
          <Input label="Form name" placeholder="Dog training enquiry" error={errors.name?.message} {...register('name')} />
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">Description (optional)</label>
            <textarea rows={2} placeholder="Tell people what this form is for..." className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" {...register('description')} />
          </div>
          <label className="flex items-center gap-3 cursor-pointer">
            <Controller control={control} name="isPublished" render={({ field }) => (
              <input type="checkbox" checked={field.value} onChange={field.onChange} className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
            )} />
            <span className="text-sm font-medium text-slate-700">Published (form is publicly accessible)</span>
          </label>
        </CardBody>
      </Card>

      {/* Share & embed — only once saved and published */}
      {formId && isPublished && publicUrl && (
        <Card>
          <CardBody className="pt-5 flex flex-col gap-3">
            <h2 className="font-semibold text-slate-900">Share & embed</h2>
            <div>
              <p className="text-xs text-slate-500 mb-1">Public URL</p>
              <div className="flex gap-2">
                <code className="flex-1 text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 truncate text-slate-700">{publicUrl}</code>
                <a href={publicUrl} target="_blank" rel="noopener noreferrer">
                  <Button type="button" variant="secondary" size="sm"><ExternalLink className="h-4 w-4" /></Button>
                </a>
              </div>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Embed code — paste into your website</p>
              <div className="flex gap-2">
                <code className="flex-1 text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 truncate text-slate-700">{embedCode}</code>
                <Button type="button" variant="secondary" size="sm" onClick={copyEmbed}>
                  <Copy className="h-4 w-4" />
                  {copied ? 'Copied!' : 'Copy'}
                </Button>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Sections */}
      <div>
        <h2 className="font-semibold text-slate-900 mb-1">Questions</h2>
        <p className="text-xs text-slate-400 mb-4">Organise your questions into sections.</p>
        <div className="flex flex-col gap-4">
          {sections.map((section, si) => (
            <SectionEditor
              key={section.id}
              sectionIndex={si}
              control={control}
              register={register}
              errors={errors}
              onRemove={() => removeSection(si)}
              canRemove={sections.length > 1}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => appendSection({ title: '', order: sections.length, fields: [] })}
          className="mt-3 flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700"
        >
          <Plus className="h-4 w-4" /> Add section
        </button>
      </div>

      <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
        {formId ? 'Save changes' : 'Create form'}
      </Button>
    </form>
  )
}

function SectionEditor({ sectionIndex, control, register, errors, onRemove, canRemove }: {
  sectionIndex: number
  control: FormControl
  register: FormRegister
  errors: ReturnType<typeof useForm<FormData>>['formState']['errors']
  onRemove: () => void
  canRemove: boolean
}) {
  const { fields, append, remove } = useFieldArray({ control, name: `sections.${sectionIndex}.fields` })
  const sectionError = (errors.sections?.[sectionIndex] as { title?: { message?: string } } | undefined)

  return (
    <Card>
      <CardBody className="pt-4 pb-4 flex flex-col gap-4">
        <div className="flex items-start gap-2">
          <Input
            label="Section title"
            placeholder="About you"
            className="flex-1"
            error={sectionError?.title?.message}
            {...register(`sections.${sectionIndex}.title`)}
          />
          {canRemove && (
            <button type="button" onClick={onRemove} className="text-slate-300 hover:text-red-400 mt-7">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex flex-col gap-3">
          {fields.map((field, fi) => (
            <FieldEditor
              key={field.id}
              sectionIndex={sectionIndex}
              fieldIndex={fi}
              control={control}
              register={register}
              onRemove={() => remove(fi)}
            />
          ))}
          {fields.length === 0 && (
            <p className="text-xs text-slate-400 text-center py-2">No questions yet</p>
          )}
        </div>

        <button
          type="button"
          onClick={() => append({ type: 'TEXT', label: '', required: false, options: [], order: fields.length })}
          className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700"
        >
          <Plus className="h-4 w-4" /> Add question
        </button>
      </CardBody>
    </Card>
  )
}

function FieldEditor({ sectionIndex, fieldIndex, control, register, onRemove }: {
  sectionIndex: number
  fieldIndex: number
  control: FormControl
  register: FormRegister
  onRemove: () => void
}) {
  const fieldType = useWatch({ control, name: `sections.${sectionIndex}.fields.${fieldIndex}.type` })
  const { fields: optionFields, append: appendOption, remove: removeOption } = useFieldArray({
    control,
    name: `sections.${sectionIndex}.fields.${fieldIndex}.options` as never,
  })
  const [newOption, setNewOption] = useState('')

  function addOption() {
    const trimmed = newOption.trim()
    if (!trimmed) return
    appendOption(trimmed as never)
    setNewOption('')
  }

  const needsOptions = fieldType === 'MULTIPLE_CHOICE' || fieldType === 'DROPDOWN'

  return (
    <div className="flex items-start gap-3 bg-slate-50 rounded-xl p-3">
      <GripVertical className="h-4 w-4 text-slate-300 mt-3 flex-shrink-0" />
      <div className="flex-1 flex flex-col gap-2">
        <div className="flex gap-2">
          <div className="flex-1">
            <Input label="Question" placeholder="What is your dog's name?" {...register(`sections.${sectionIndex}.fields.${fieldIndex}.label`)} />
          </div>
          <div className="w-44">
            <label className="text-sm font-medium text-slate-700 block mb-1.5">Type</label>
            <select
              className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              {...register(`sections.${sectionIndex}.fields.${fieldIndex}.type`)}
            >
              {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
        </div>

        {needsOptions && (
          <div className="flex flex-col gap-2 pl-1">
            <p className="text-xs font-medium text-slate-500">Options</p>
            {optionFields.map((opt, oi) => (
              <div key={opt.id} className="flex items-center gap-2">
                <input
                  {...register(`sections.${sectionIndex}.fields.${fieldIndex}.options.${oi}` as never)}
                  className="flex-1 h-9 rounded-lg border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button type="button" onClick={() => removeOption(oi)} className="text-slate-300 hover:text-red-400">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <div className="flex gap-2">
              <input
                value={newOption}
                onChange={e => setNewOption(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addOption() } }}
                placeholder="Add option and press Enter..."
                className="flex-1 h-9 rounded-lg border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button type="button" onClick={addOption} className="text-blue-600 hover:text-blue-700 px-2">
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
          <Controller control={control} name={`sections.${sectionIndex}.fields.${fieldIndex}.required`} render={({ field }) => (
            <input type="checkbox" checked={field.value} onChange={field.onChange} className="h-4 w-4 rounded border-slate-300 text-blue-600" />
          )} />
          Required
        </label>
      </div>
      <button type="button" onClick={onRemove} className="text-slate-300 hover:text-red-400 mt-3 flex-shrink-0">
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  )
}
