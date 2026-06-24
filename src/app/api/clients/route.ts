import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import crypto from 'crypto'
import { sendEmail, fromTrainer } from '@/lib/email'
import { renderClientInviteEmail } from '@/lib/client-invite-email'
import { ensureTrainerSlug, clientInviteUrl } from '@/lib/slug'
import { safeEvaluate } from '@/lib/achievements'
import { CLIENT_FIELDS, resolveClientFieldConfig, QUICK_ADD_FOLLOW_UP_STATUS, type ClientFieldKey } from '@/lib/client-fields'

export const runtime = 'nodejs'

const dogSchema = z.object({
  name: z.string().optional(),
  breed: z.string().optional(),
  weight: z.number().nullable().optional(),
  dob: z.string().nullable().optional(), // ISO date string
  notes: z.string().optional(),
})

const schema = z.object({
  mode: z.enum(['full', 'quick']).default('full'),
  name: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  address: z.object({
    line: z.string(),
    lat: z.number().nullable().optional(),
    lng: z.number().nullable().optional(),
    placeId: z.string().nullable().optional(),
  }).nullable().optional(),
  dogs: z.array(dogSchema).optional(),
  customValues: z.array(z.object({
    fieldId: z.string(),
    value: z.string(),
    dogIndex: z.number().int().nullable().optional(),
  })).optional(),
  sendInvite: z.boolean().default(false),
  emailBody: z.string().optional(),
})

// A blank email still needs a unique, non-deliverable address (email is the
// login key + unique). The @no-email.pupmanager.app domain marks it as a
// placeholder the trainer can replace later; we never send to it.
function placeholderEmail(): string {
  return `noemail-${crypto.randomBytes(8).toString('hex')}@no-email.pupmanager.app`
}

export async function POST(req: Request) {
  const guard = await guardPermission('clients.invite')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    const flat = parsed.error.flatten()
    const msg = Object.values(flat.fieldErrors)[0]?.[0] ?? flat.formErrors[0] ?? 'Invalid input'
    return NextResponse.json({ error: msg, details: flat }, { status: 400 })
  }
  const data = parsed.data
  const isQuick = data.mode === 'quick'

  const trainerProfile = await prisma.trainerProfile.findUnique({
    where: { id: guard.companyId },
    select: {
      id: true, businessName: true, logoUrl: true, emailAccentColor: true,
      clientFieldConfig: true,
      user: { select: { name: true, email: true } },
    },
  })
  if (!trainerProfile) return NextResponse.json({ error: 'Trainer profile not found' }, { status: 404 })

  const fieldConfig = resolveClientFieldConfig(trainerProfile.clientFieldConfig)
  const customFields = await prisma.customField.findMany({
    where: { trainerId: trainerProfile.id },
    select: { id: true, label: true, required: true, inQuickAdd: true, appliesTo: true },
  })

  // ── Required validation, per this company's config + the chosen mode ──────
  const primaryDog = data.dogs?.[0]
  const present: Record<ClientFieldKey, boolean> = {
    name: !!data.name?.trim(),
    email: !!data.email?.trim(),
    phone: !!data.phone?.trim(),
    address: !!data.address?.line?.trim(),
    dogName: !!primaryDog?.name?.trim(),
    dogBreed: !!primaryDog?.breed?.trim(),
    dogWeight: primaryDog?.weight != null,
    dogDob: !!primaryDog?.dob,
    dogNotes: !!primaryDog?.notes?.trim(),
  }
  for (const f of CLIENT_FIELDS) {
    const need = isQuick ? fieldConfig[f.key].quickAdd : fieldConfig[f.key].required
    if (need && !present[f.key]) {
      return NextResponse.json({ error: `${f.label} is required` }, { status: 400 })
    }
  }
  const customById = new Map(customFields.map(c => [c.id, c]))
  const hasCustom = (fieldId: string) => (data.customValues ?? []).some(v => v.fieldId === fieldId && v.value.trim() !== '')
  for (const cf of customFields) {
    const need = isQuick ? cf.inQuickAdd : cf.required
    if (need && !hasCustom(cf.id)) {
      return NextResponse.json({ error: `${cf.label} is required` }, { status: 400 })
    }
  }

  // ── Email: real address (dedupe + maybe invite) or a placeholder ─────────
  const realEmail = data.email?.trim() || null
  if (realEmail) {
    const existing = await prisma.user.findUnique({ where: { email: realEmail }, select: { id: true } })
    if (existing) return NextResponse.json({ error: 'A user with this email already exists.' }, { status: 409 })
  }
  const email = realEmail ?? placeholderEmail()
  const sendInvite = !isQuick && data.sendInvite && !!realEmail
  const inviteToken = crypto.randomBytes(32).toString('hex')

  // Only the named dogs get created (quick-add usually has none).
  const dogInputs = (data.dogs ?? []).filter(d => d.name?.trim())

  const { clientProfileId, dogIds } = await prisma.$transaction(async (tx) => {
    const clientUser = await tx.user.create({
      data: { name: data.name?.trim() || 'New contact', email, role: 'CLIENT' },
    })

    const createdDogs = await Promise.all(dogInputs.map(d => tx.dog.create({
      data: {
        name: d.name!.trim(),
        breed: d.breed?.trim() || null,
        weight: d.weight ?? null,
        dob: d.dob ? new Date(d.dob) : null,
        notes: d.notes?.trim() || null,
      },
    })))

    const profile = await tx.clientProfile.create({
      data: {
        userId: clientUser.id,
        trainerId: trainerProfile.id,
        status: isQuick ? QUICK_ADD_FOLLOW_UP_STATUS : 'ACTIVE',
        phone: data.phone?.trim() || null,
        addressLine: data.address?.line?.trim() || null,
        addressLat: data.address?.lat ?? null,
        addressLng: data.address?.lng ?? null,
        addressPlaceId: data.address?.placeId ?? null,
        dogId: createdDogs[0]?.id ?? null,
        invitedAt: sendInvite ? new Date() : null,
        dogs: createdDogs.length > 1 ? { connect: createdDogs.slice(1).map(d => ({ id: d.id })) } : undefined,
      },
    })

    // Custom field values — DOG-scoped values map to the created dog by index.
    for (const v of data.customValues ?? []) {
      const cf = customById.get(v.fieldId)
      if (!cf || !v.value.trim()) continue
      const dogId = cf.appliesTo === 'DOG'
        ? (v.dogIndex != null ? createdDogs[v.dogIndex]?.id ?? null : createdDogs[0]?.id ?? null)
        : null
      await tx.customFieldValue.create({ data: { fieldId: v.fieldId, clientId: profile.id, dogId, value: v.value.trim() } })
    }

    if (sendInvite) {
      await tx.verificationToken.create({
        data: { identifier: email, token: inviteToken, expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
      })
    }

    return { clientProfileId: profile.id, dogIds: createdDogs.map(d => d.id) }
  })

  await safeEvaluate(clientProfileId).catch(() => {})

  // Invite email (best-effort; never fails the create).
  let emailError: string | null = null
  if (sendInvite && realEmail) {
    try {
      const slug = await ensureTrainerSlug(trainerProfile.id)
      const inviteUrl = clientInviteUrl(process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.pupmanager.com', slug, inviteToken, realEmail)
      const rendered = renderClientInviteEmail({
        clientName: data.name?.trim() || 'there',
        dogNames: dogInputs.map(d => d.name!.trim()),
        trainer: {
          businessName: trainerProfile.businessName,
          logoUrl: trainerProfile.logoUrl,
          emailAccentColor: trainerProfile.emailAccentColor,
          user: { name: trainerProfile.user.name, email: trainerProfile.user.email },
        },
        bodyTemplate: data.emailBody ?? '',
        inviteUrl,
      })
      const result = await sendEmail({
        to: realEmail, subject: rendered.subject, from: fromTrainer(rendered.displayName),
        replyTo: rendered.trainerEmail ?? undefined, text: rendered.text, html: rendered.html,
      })
      if (result.error) emailError = result.error.message
    } catch (err) {
      emailError = err instanceof Error ? err.message : 'Unknown error'
    }

    await prisma.trainerOnboardingProgress
      .updateMany({ where: { trainerId: trainerProfile.id, firstInviteSentAt: null }, data: { firstInviteSentAt: new Date() } })
      .catch(() => {})
  }

  return NextResponse.json({ ok: true, clientId: clientProfileId, dogIds, ...(emailError ? { emailError } : {}) }, { status: 201 })
}
