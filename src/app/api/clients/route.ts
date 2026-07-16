import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { guardPermission, getTrainerContext, scopeForMember } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import crypto from 'crypto'
import { sendEmail, fromTrainer } from '@/lib/email'
import { renderClientInviteEmail } from '@/lib/client-invite-email'
import { ensureTrainerSlug, clientInviteUrl } from '@/lib/slug'
import { safeEvaluate } from '@/lib/achievements'
import { CLIENT_FIELDS, resolveClientFieldConfig, QUICK_ADD_FOLLOW_UP_STATUS, type ClientFieldKey } from '@/lib/client-fields'
import { findOrJoinClient, type DogInput } from '@/lib/client-upsert'

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

// Searchable client list for pickers (the instant-sale composer's "who's this
// for?" step). Deliberately NOT guarded on `clients.viewAll` — that would 403
// every staff member. Instead it mirrors the Clients page: any member of the
// company may list, and scopeForMember narrows restricted staff to the clients
// assigned to them, so they see a shorter list rather than a locked door.
const LIST_LIMIT = 20

export async function GET(req: Request) {
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const q = (new URL(req.url).searchParams.get('q') ?? '').trim()

  const rows = await prisma.clientProfile.findMany({
    where: {
      trainerId: ctx.companyId,
      status: 'ACTIVE',
      // Restricted staff only ever see their own assigned clients.
      ...scopeForMember(ctx, 'clients.viewAll'),
      ...(q
        ? {
            OR: [
              { user: { is: { name: { contains: q, mode: 'insensitive' } } } },
              { dog: { is: { name: { contains: q, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    },
    orderBy: { user: { name: 'asc' } },
    take: LIST_LIMIT,
    select: {
      id: true,
      isSample: true,
      user: { select: { name: true } },
      dog: { select: { name: true, photoUrl: true } },
      dogs: { select: { name: true, photoUrl: true } },
    },
  })

  return NextResponse.json({
    items: rows
      // Seeded demo clients are noise in a real sale picker.
      .filter((c) => !c.isSample)
      .map((c) => ({
        id: c.id,
        name: c.user?.name ?? null,
        dogName: c.dog?.name ?? c.dogs[0]?.name ?? null,
        dogPhotoUrl: c.dog?.photoUrl ?? c.dogs[0]?.photoUrl ?? null,
      })),
  })
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

  // ── Email: real address (find-or-join + maybe invite) or a placeholder ───
  // A real email is a person identity: if it already belongs to someone, we
  // REUSE them and (if they're already this trainer's client) JOIN onto their
  // existing profile rather than erroring or duplicating. Placeholder no-email
  // addresses are random per-create and must never be deduped, so they take the
  // raw-create path below.
  const realEmail = data.email?.trim() || null
  const email = realEmail ?? placeholderEmail()
  const sendInvite = !isQuick && data.sendInvite && !!realEmail
  const inviteToken = crypto.randomBytes(32).toString('hex')

  // Only the named dogs get created (quick-add usually has none).
  const dogInputs = (data.dogs ?? []).filter(d => d.name?.trim())
  const dogPayload: DogInput[] = dogInputs.map(d => ({
    name: d.name!.trim(),
    breed: d.breed,
    weight: d.weight,
    dob: d.dob ? new Date(d.dob) : null,
    notes: d.notes,
  }))
  const profileStatus = isQuick ? QUICK_ADD_FOLLOW_UP_STATUS : 'ACTIVE'

  const { clientProfileId, dogIds } = await prisma.$transaction(async (tx) => {
    // Custom DOG-scoped values map to the dog(s) created by THIS request, by
    // index — true on both a fresh create and a join (createdDogIds is in the
    // same order as dogInputs).
    const writeCustomValues = async (profileId: string, createdDogIds: string[]) => {
      for (const v of data.customValues ?? []) {
        const cf = customById.get(v.fieldId)
        if (!cf || !v.value.trim()) continue
        const dogId = cf.appliesTo === 'DOG'
          ? (v.dogIndex != null ? createdDogIds[v.dogIndex] ?? null : createdDogIds[0] ?? null)
          : null
        await tx.customFieldValue.create({ data: { fieldId: v.fieldId, clientId: profileId, dogId, value: v.value.trim() } })
      }
    }

    if (realEmail) {
      const result = await findOrJoinClient(tx, {
        email: realEmail,
        trainerId: trainerProfile.id,
        name: data.name?.trim() || 'New contact',
        phone: data.phone,
        address: data.address ?? null,
        dogs: dogPayload,
        status: profileStatus,
        invitedAt: sendInvite ? new Date() : null,
      })
      await writeCustomValues(result.clientProfileId, result.createdDogIds)
      if (sendInvite) {
        await tx.verificationToken.create({
          data: { identifier: email, token: inviteToken, expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
        })
      }
      return { clientProfileId: result.clientProfileId, dogIds: result.createdDogIds }
    }

    // ── No real email: a fresh placeholder User, no dedupe. ──
    const clientUser = await tx.user.create({
      data: { name: data.name?.trim() || 'New contact', email, role: 'CLIENT' },
    })

    const createdDogs = await Promise.all(dogPayload.map(d => tx.dog.create({
      data: {
        name: d.name,
        breed: d.breed?.trim() || null,
        weight: d.weight ?? null,
        dob: d.dob ?? null,
        notes: d.notes?.trim() || null,
      },
    })))

    const profile = await tx.clientProfile.create({
      data: {
        userId: clientUser.id,
        trainerId: trainerProfile.id,
        status: profileStatus,
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

    await writeCustomValues(profile.id, createdDogs.map(d => d.id))

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
