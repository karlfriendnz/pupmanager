import { NextResponse, after } from 'next/server'
import { auth } from '@/lib/auth'
import { guardPermission, getTrainerContext, scopeForMember } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { QUICK_ADD_FOLLOW_UP_STATUS } from '@/lib/client-fields'
import { Prisma } from '@/generated/prisma'
import { z } from 'zod'
import crypto from 'crypto'
import { sendEmail, fromTrainer } from '@/lib/email'
import { renderClientInviteEmail } from '@/lib/client-invite-email'
import { ensureTrainerSlug, clientInviteUrl } from '@/lib/slug'
import { safeEvaluate } from '@/lib/achievements'
import { findOrJoinClient, type DogInput } from '@/lib/client-upsert'
import { parseDobInput } from '@/lib/date-of-birth'

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
  // The client form to assign as this client's intake — they are gated behind
  // it until they complete it.
  formId: z.string().nullable().optional(),
})

// A client with no email now stores NULL, not an invented address.
//
// This used to mint `noemail-<hex>@no-email.pupmanager.app` because email was
// the login key and NOT NULL. That made every such client look mailable: the
// domain has no MX record, so each one was a guaranteed hard bounce, and the
// "we never send to it" promise was enforced in only four of the places that
// send. Email is nullable as of 20260730230000_user_email_nullable, so the
// column can say "we do not know" instead.

// Searchable client list. Backs both the instant-sale composer's "who's this
// for?" step and the top bar's search autocomplete.
//
// Deliberately NOT guarded on `clients.viewAll` — that would 403 every staff
// member. Instead it mirrors the Clients page: any member of the company may
// list, and scopeForMember narrows restricted staff to the clients assigned to
// them, so they see a shorter list rather than a locked door.
const LIST_LIMIT = 20

// Mirrors the top bar's scope selector, so a suggestion list can't disagree
// with the full results page you land on. Omitted/unknown = search everything.
function searchFilter(q: string, scope: string) {
  if (!q) return {}
  const like = { contains: q, mode: 'insensitive' as const }
  if (scope === 'client') return { user: { is: { name: like } } }
  if (scope === 'dog') return { dog: { is: { name: like } } }
  if (scope === 'breed') return { dog: { is: { breed: like } } }
  return {
    OR: [
      { user: { is: { name: like } } },
      { dog: { is: { name: like } } },
      { dog: { is: { breed: like } } },
    ],
  }
}

export async function GET(req: Request) {
  const ctx = await getTrainerContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const url = new URL(req.url)
  const q = (url.searchParams.get('q') ?? '').trim()
  const scope = url.searchParams.get('scope') ?? 'all'

  const rows = await prisma.clientProfile.findMany({
    where: {
      trainerId: ctx.companyId,
      status: 'ACTIVE',
      // Restricted staff only ever see their own assigned clients.
      ...scopeForMember(ctx, 'clients.viewAll'),
      ...searchFilter(q, scope),
    },
    orderBy: { user: { name: 'asc' } },
    take: LIST_LIMIT,
    select: {
      id: true,
      isSample: true,
      user: { select: { name: true } },
      dog: { select: { name: true, breed: true, photoUrl: true } },
      // Ids too, and every dog — a picker that BOOKS something (the daycare
      // board's "register a dog") has to name which dog, and a client with two
      // dogs is the normal case there. A dog that has died is left out: it can't
      // be enrolled, so offering it is only a dead end.
      dogs: {
        where: { deceasedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true, photoUrl: true },
      },
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
        // Only the primary dog carries a breed here; the picker ignores it, the
        // search autocomplete shows it so a breed match explains itself.
        dogBreed: c.dog?.breed ?? null,
        dogPhotoUrl: c.dog?.photoUrl ?? c.dogs[0]?.photoUrl ?? null,
        // The bookable dogs, in full. dogName above stays the one-line summary
        // the sale composer and search autocomplete already read.
        dogs: c.dogs.map(d => ({ id: d.id, name: d.name, photoUrl: d.photoUrl })),
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

  // Resolve the form against the CALLER's own trainer, and only accept one
  // that is actually usable as intake — a body-supplied id must never be able
  // to gate a client behind another business's form.
  let assignFormId: string | null = null
  if (data.formId) {
    const form = await prisma.form.findFirst({
      where: { id: data.formId, trainerId: trainerProfile.id, usableAsIntake: true },
      select: { id: true },
    })
    assignFormId = form?.id ?? null
  }

  const customFields = await prisma.customField.findMany({
    where: { trainerId: trainerProfile.id },
    select: { id: true, label: true, required: true, inQuickAdd: true, appliesTo: true },
  })

  // ── Required validation ──────────────────────────────────────────────────
  // Only a name, because a client record without one is unusable. Everything else
  // is what the trainer happens to know: being blocked for a missing address while
  // adding a walk-in standing in front of you is the wrong behaviour, and the
  // per-company "required" config that used to do that is gone — a form's own
  // questions carry requiredness for whoever fills that form in.
  if (!data.name?.trim()) {
    return NextResponse.json({ error: 'Client name is required' }, { status: 400 })
  }
  const customById = new Map(customFields.map(c => [c.id, c]))
  const hasCustom = (fieldId: string) => (data.customValues ?? []).some(v => v.fieldId === fieldId && v.value.trim() !== '')
  for (const cf of customFields) {
    const need = isQuick ? cf.inQuickAdd && cf.required : cf.required
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
  // NULL when they have not given one. Postgres does not treat two NULLs as
  // equal, so uniqueness still holds for everyone who has an address, and any
  // number of clients can have none.
  const email = realEmail
  // Quick-add used to be barred from inviting outright (`!isQuick`), because it
  // had no UI for it — not because a walk-in shouldn't be invited. It now offers
  // the choice, so the gate is what it always should have been: they asked, and
  // there is an address to send to. Still off by default there, because quick
  // add exists to capture someone in ten seconds.
  const sendInvite = data.sendInvite && !!realEmail
  const inviteToken = crypto.randomBytes(32).toString('hex')

  // Only the named dogs get created (quick-add usually has none).
  const dogInputs = (data.dogs ?? []).filter(d => d.name?.trim())
  // A birthday is checked here, not just on screen (AGENTS.md bug #3). This used
  // to be a bare `new Date(d.dob)`, so anything that wasn't a date — including a
  // half-picked one — reached Prisma as Invalid Date and 500'd the create.
  const dogPayload: DogInput[] = []
  for (const d of dogInputs) {
    const dob = parseDobInput(d.dob)
    if (!dob.ok) {
      return NextResponse.json({ error: `Dog date of birth: enter a real date of birth` }, { status: 400 })
    }
    dogPayload.push({ name: d.name!.trim(), breed: d.breed, weight: d.weight, dob: dob.value, notes: d.notes })
  }
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
      // Assign the chosen client form; clear any previous completion so a
      // re-assigned form re-gates the client rather than being skipped.
      if (assignFormId) {
        await tx.clientProfile.update({
          where: { id: result.clientProfileId },
          // Prisma.DbNull, not null: a nullable Json column needs the sentinel to
          // be set back to SQL NULL.
          data: { intakeFormId: assignFormId, intakeCompletedAt: null, intakeAnswers: Prisma.DbNull },
        })
      }
      // sendInvite already implies realEmail — a token is keyed on the address
      // the link is sent to, so there is nothing to key on without one — but
      // say so explicitly rather than leaning on a boolean the compiler cannot
      // follow.
      if (sendInvite && realEmail) {
        await tx.verificationToken.create({
          data: { identifier: realEmail, token: inviteToken, expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
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
        intakeFormId: assignFormId,
        invitedAt: sendInvite ? new Date() : null,
        dogs: createdDogs.length > 1 ? { connect: createdDogs.slice(1).map(d => ({ id: d.id })) } : undefined,
      },
    })

    await writeCustomValues(profile.id, createdDogs.map(d => d.id))

    return { clientProfileId: profile.id, dogIds: createdDogs.map(d => d.id) }
  })

  // Everything past this point is a SIDE EFFECT of the client now existing —
  // achievement evaluation, the invite email, the onboarding tick. None of it
  // changes what we hand back, and the invite email is a round-trip to Resend:
  // measured on the dev box, a full client with an invite took ~860ms end to
  // end versus ~25ms without one, so the trainer was sitting on a spinner
  // waiting for someone else's mail API. `after()` runs it once the response
  // has been flushed (Fluid Compute keeps the invocation alive), so the work
  // still happens — the trainer just doesn't wait for it.
  //
  // The trade: a send failure can no longer come back on this response. It's
  // logged, and the invite is re-sendable from the client's profile
  // ("Re-invite client"), which is what a trainer does about a failed invite
  // anyway. Nothing else read `emailError` from this route.
  after(async () => {
    try {
      await safeEvaluate(clientProfileId).catch(() => {})

      if (!sendInvite || !realEmail) return

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
      if (result.error) console.error('[clients POST after] invite email failed', result.error.message)

      await prisma.trainerOnboardingProgress
        .updateMany({ where: { trainerId: trainerProfile.id, firstInviteSentAt: null }, data: { firstInviteSentAt: new Date() } })
        .catch(() => {})
    } catch (err) {
      console.error('[clients POST after]', err)
    }
  })

  return NextResponse.json({ ok: true, clientId: clientProfileId, dogIds }, { status: 201 })
}
