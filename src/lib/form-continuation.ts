import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { prisma } from './prisma'
import { env } from './env'
import { enquiryClientBackLink, findOrJoinClient } from './client-upsert'

// ── The continuous run ───────────────────────────────────────────────────────
//
// Karl, 2026-08-02: "person goes to a website, fills in a form, gets redirected
// to a place where they set up their email address and password. Once they have
// done that, that then shows an intake form; once the intake form has been
// completed, then they can go in and see their profile."
//
// Four screens, one run, no "check your email and start again" in the middle —
// that break is the entire reason this exists. What holds the run together is a
// single token minted when the enquiry is submitted:
//
//   /form/<id>              submit → Enquiry written, token minted
//   /form/<id>/account?t=…  set a password  → User + ClientProfile
//   /                       the EXISTING intake gate, driven by
//                           ClientProfile.intakeFormId — no new gate
//   /home                   their diary
//
// ORDER MATTERS. The enquiry is written before the account, not after, so
// somebody who abandons the password step still leaves their trainer a name, an
// email and a phone number to reply to by hand. A run that could strand the
// trainer would be worse than no run at all.
//
// ── Why the token, and not a posted email address ────────────────────────────
//
// The account step never accepts an email address from the browser. It reads it
// off the enquiry row this token resolves to. That is the whole enumeration
// defence: there is no field on a public, account-creating endpoint that an
// attacker can point at somebody else's address, so the endpoint cannot be used
// to ask "does bob@example.com have an account?" at any rate at all. To probe
// one address they would first have to submit an enquiry naming it — which
// lands in a trainer's inbox and is itself rate limited.
//
// ── Why an existing account is never touched ─────────────────────────────────
//
// Setting a password on a User that already exists is account takeover: every
// client a trainer added by hand has a User row and no credentials, and anyone
// who knew that address could otherwise claim it. So the run NEVER writes a
// password onto an existing user. It asks them to sign in, and picks the run up
// again on the other side, where a real session proves who they are.

/** How long the handover link stays good. Long enough to come back from the
 *  email the next morning; short enough that a link left in browser history
 *  stops working. */
export const CONTINUATION_TTL_MS = 24 * 60 * 60 * 1000

/** sha256(plain + AUTH_SECRET) — the same shape as the accept magic-link, so
 *  only the digest is ever stored and a database dump yields no working links. */
export function hashContinuationToken(plain: string): string {
  return crypto.createHash('sha256').update(`${plain}${env.AUTH_SECRET}`).digest('hex')
}

export function mintContinuationToken(): { plain: string; hash: string; expires: Date } {
  const plain = crypto.randomBytes(32).toString('hex')
  return {
    plain,
    hash: hashContinuationToken(plain),
    expires: new Date(Date.now() + CONTINUATION_TTL_MS),
  }
}

/** The path the run continues on. Relative, so it works on any origin. */
export function continuationPath(formId: string, plainToken: string): string {
  return `/form/${encodeURIComponent(formId)}/account?t=${encodeURIComponent(plainToken)}`
}

export type ContinuationProblem = 'NOT_FOUND' | 'EXPIRED' | 'USED'

export interface ResolvedContinuation {
  enquiryId: string
  /** The address the account is for. From the ENQUIRY ROW, never from input. */
  email: string
  name: string
  phone: string | null
  /** The tenant this run belongs to. From the form, server-side, never posted. */
  trainerId: string
  formId: string
  formName: string
  /** The intake form to ask next, when the trainer nominated one. */
  intakeFormId: string | null
  trainer: {
    businessName: string
    logoUrl: string | null
    emailAccentColor: string | null
  }
}

/**
 * Look up a run by its plaintext token, scoped to the form the URL names.
 *
 * Both the form id AND the token must match: a token is minted against one
 * form, and letting it resolve under another form's id would let a run started
 * on trainer A's website finish as a client of trainer B.
 */
export async function resolveContinuation(
  formId: string,
  plainToken: string,
): Promise<{ ok: true; run: ResolvedContinuation } | { ok: false; problem: ContinuationProblem }> {
  if (!plainToken || plainToken.length < 16) return { ok: false, problem: 'NOT_FOUND' }

  const enquiry = await prisma.enquiry.findUnique({
    where: { continuationTokenHash: hashContinuationToken(plainToken) },
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      trainerId: true,
      unifiedFormId: true,
      continuationExpiresAt: true,
      continuationUsedAt: true,
      trainer: { select: { businessName: true, logoUrl: true, emailAccentColor: true } },
      unifiedForm: {
        select: {
          id: true, name: true, isActive: true, continueToAccount: true, continueIntakeFormId: true,
          // An ACCOUNT step in the form's flow is the OTHER way a trainer can
          // ask somebody to set up a login — the generalised version of the
          // `continueToAccount` toggle. Selected as a count of the enabled ones
          // so a form with no flow at all reads as zero and the check below
          // collapses to exactly what it was before flows could be built.
          flowSteps: { where: { kind: 'ACCOUNT', enabled: true }, select: { id: true }, take: 1 },
        },
      },
    },
  })

  if (!enquiry || enquiry.unifiedFormId !== formId) return { ok: false, problem: 'NOT_FOUND' }
  const form = enquiry.unifiedForm
  // A form that was unpublished, or had the setting switched off, mid-run stops
  // the run: the trainer's current answer to "may people join themselves?" is
  // the one that counts, not the answer at the moment they hit submit. That
  // now includes deleting the ACCOUNT step out of the flow — same question,
  // asked the newer way.
  const asksForAnAccount = form ? form.continueToAccount || (form.flowSteps?.length ?? 0) > 0 : false
  if (!form || !form.isActive || !asksForAnAccount) return { ok: false, problem: 'NOT_FOUND' }
  if (enquiry.continuationUsedAt) return { ok: false, problem: 'USED' }
  if (!enquiry.continuationExpiresAt || enquiry.continuationExpiresAt.getTime() < Date.now()) {
    return { ok: false, problem: 'EXPIRED' }
  }

  return {
    ok: true,
    run: {
      enquiryId: enquiry.id,
      email: enquiry.email,
      name: enquiry.name,
      phone: enquiry.phone,
      // The tenant comes off the enquiry, which took it off the form when the
      // enquiry was written. Nothing the browser sends reaches this value.
      trainerId: enquiry.trainerId,
      formId: form.id,
      formName: form.name,
      intakeFormId: form.continueIntakeFormId,
      trainer: enquiry.trainer,
    },
  }
}

export interface CompletedContinuation {
  clientProfileId: string
  /** True when the intake gate will greet them on the way in. */
  hasIntake: boolean
}

/**
 * Turn a resolved run into a real client of this trainer.
 *
 * `userId` is supplied when the person already had an account and has just
 * proved it by signing in; `password` when we are creating their login here.
 * Exactly one of the two. Everything else — the email, the name, the tenant —
 * comes off the run, which came off the enquiry row.
 */
export async function completeContinuation(
  run: ResolvedContinuation,
  identity: { userId: string } | { password: string },
): Promise<CompletedContinuation> {
  const passwordHash =
    'password' in identity ? await bcrypt.hash(identity.password, 12) : null

  return prisma.$transaction(async tx => {
    // Single use, claimed FIRST and conditionally: two tabs racing the same
    // link both reach here, and updateMany's row count is what makes exactly
    // one of them the winner without a second round-trip.
    const claimed = await tx.enquiry.updateMany({
      where: { id: run.enquiryId, continuationUsedAt: null },
      data: { continuationUsedAt: new Date() },
    })
    if (claimed.count === 0) throw new ContinuationError('USED', 'This link has already been used.')

    if (passwordHash) {
      // Belt and braces against the takeover case. resolveContinuation's caller
      // already checked, but this runs INSIDE the transaction, so a signup that
      // lands between the check and the write loses here rather than silently
      // overwriting somebody's password.
      const clash = await tx.user.findUnique({ where: { email: run.email }, select: { id: true } })
      if (clash) throw new ContinuationError('ACCOUNT_EXISTS', 'This email already has an account.')

      const created = await tx.user.create({
        data: {
          name: run.name,
          email: run.email,
          role: 'CLIENT',
          // Left null, exactly as it is for every client a trainer ever added by
          // hand. lib/auth.ts gates only unverified TRAINERs, and a verification
          // wall here would rebuild the "check your email" break this whole
          // feature exists to knock down. The confirmation email still goes out;
          // it just isn't a door.
          emailVerified: null,
        },
        select: { id: true },
      })
      await tx.account.create({
        data: {
          userId: created.id,
          type: 'credentials',
          provider: 'credentials',
          // bcrypt(12) in providerAccountId — the one scheme lib/auth.ts
          // compares against (see /api/auth/signup, lib/client-signup).
          providerAccountId: passwordHash,
        },
      })
    }

    // One client, many trainers. findOrJoinClient is the single place that
    // knows the rules: reuse the person, add a SECOND ClientProfile for this
    // trainer, never touch the one they hold with anybody else.
    const join = await findOrJoinClient(tx, {
      email: run.email,
      trainerId: run.trainerId,
      name: run.name,
      phone: run.phone,
      dogs: [],
      status: 'ACTIVE',
    })

    // Gate them behind the trainer's intake form — but ONLY on a profile this
    // run created. Someone who is already this trainer's client has either done
    // their intake or is mid-way through it, and re-pointing them at a
    // different form would throw that away and lock them out of an app they
    // already use.
    const hasIntake = !join.joined && !!run.intakeFormId
    if (hasIntake) {
      await tx.clientProfile.update({
        where: { id: join.clientProfileId },
        data: { intakeFormId: run.intakeFormId, intakeCompletedAt: null },
      })
    }

    // The enquiry closes itself. `source` flips so the trainer's list says
    // plainly that this person walked in and signed themselves up rather than
    // leaving them to wonder which team member tapped Accept.
    await tx.enquiry.update({
      where: { id: run.enquiryId },
      data: {
        status: 'ACCEPTED',
        source: ENQUIRY_SOURCE_FORM_SIGNUP,
        // Skipped when an earlier enquiry from the same person already holds
        // the link — it is `@unique`, and somebody enquiring twice must not be
        // the thing that breaks their sign-up. See enquiryClientBackLink.
        ...(await enquiryClientBackLink(tx, join.clientProfileId, run.enquiryId)),
        // The link is spent; drop the digest so the row keeps nothing usable.
        continuationTokenHash: null,
      },
    })

    return { clientProfileId: join.clientProfileId, hasIntake }
  })
}

/** Enquiry.source for a run that completed: they signed themselves up off the
 *  trainer's own form, and are already on the books. */
export const ENQUIRY_SOURCE_FORM_SIGNUP = 'FORM_SIGNUP'

export class ContinuationError extends Error {
  constructor(
    public code: 'USED' | 'ACCOUNT_EXISTS',
    message: string,
  ) {
    super(message)
    this.name = 'ContinuationError'
  }
}
