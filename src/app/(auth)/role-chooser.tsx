import Link from 'next/link'
import { ChevronRight, Briefcase, Dog } from 'lucide-react'
import { FlatBlock } from '@/components/shared/flat-list'

// Step 0 of signup: which kind of person is this?
//
// It exists because there was no way to answer that question. /signup and
// /register both hardcode role: 'TRAINER', so a dog owner told "we use
// PupManager, go sign up" became a trainer on a free trial — six accounts in
// production have no business name, which is the signature of exactly that.
//
// Vocabulary is Karl's: the paying customer is a "dog pro", the person who
// brings the dog is a "dog owner" (a "client" once a pro has them on their
// books). Neither word appears without a plain-English line under it, because
// the visitor has to self-identify on their first screen.
//
// House style: one bordered block, hairline divider between the two rows, plain
// line icons, no tinted tiles, no chips. Full screen at 390px.

export function RoleChooser({
  /** Where the "dog pro" row goes — the two trainer forms differ. */
  proHref,
  /** Sub-line under the pro row, so /signup can mention the trial. */
  proSub,
  ownerHref = '/signup/client',
  ownerSub = 'Your trainer, walker or groomer uses PupManager and asked you to sign up.',
}: {
  proHref: string
  proSub?: string
  ownerHref?: string
  ownerSub?: string
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          Create your account
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-slate-600">
          First — which one are you?
        </p>
      </div>

      <FlatBlock>
        <ChoiceRow
          href={proHref}
          icon={Briefcase}
          label="I'm a dog pro"
          sub={proSub ?? 'A trainer, walker, groomer or behaviourist running your own business.'}
        />
        <ChoiceRow href={ownerHref} icon={Dog} label="I'm a dog owner" sub={ownerSub} />
      </FlatBlock>

      <p className="text-center text-sm text-slate-500">
        Already on PupManager?{' '}
        <Link href="/login" className="font-medium text-blue-600 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  )
}

function ChoiceRow({
  href,
  icon: Icon,
  label,
  sub,
}: {
  href: string
  icon: typeof Dog
  label: string
  sub: string
}) {
  return (
    <Link href={href} className="flex w-full items-start gap-3 px-4 py-4 text-left active:bg-slate-50">
      <Icon className="mt-0.5 h-[18px] w-[18px] flex-shrink-0 text-slate-700" strokeWidth={1.75} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-slate-900">{label}</span>
        {/* Wraps rather than truncating: at 390px the whole point of the row is
            the explanation, so an ellipsis would hide the thing being chosen. */}
        <span className="mt-0.5 block text-[13px] leading-snug text-slate-500">{sub}</span>
      </span>
      <ChevronRight className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-400" strokeWidth={1.75} />
    </Link>
  )
}
