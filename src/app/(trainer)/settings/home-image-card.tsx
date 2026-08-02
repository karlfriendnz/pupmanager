'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Calendar, ChevronRight, ClipboardCheck, FileText, ImagePlus, Layers, Loader2,
  Menu, Plus, Receipt, Search, Users, Wallet,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { AccordionItem } from '@/components/ui/accordion'
import { compressImageFile, isDisplayableImage } from '@/lib/compress-image'
import { HomeHero } from '@/components/shared/home-hero'

/**
 * Settings → Design → "Home screen image".
 *
 * Two settings and a preview. Both settings belong to the BUSINESS, not the
 * person changing them: the PATCH writes TrainerProfile[companyId], so a
 * five-person grooming company gets one home screen rather than five.
 *
 * The preview renders the REAL <HomeHero/> — the same component the dashboard
 * uses — inside a phone-shaped frame, scaled down from a true 390px render so
 * the proportions are the phone's rather than the card's. A hand-drawn mock-up
 * here would be a second implementation of the fade, and the first time either
 * changed the preview would quietly start lying, which is worse than having no
 * preview at all. Only the rows underneath are stand-ins: they exist to show
 * where the fade lands, and live counts wouldn't tell the trainer anything the
 * shape doesn't.
 *
 * It previews the UNSAVED state — pick an image and it's there, toggle the logo
 * and it goes — because deciding is exactly when you need to see it.
 */

/**
 * A true phone width, scaled to fit the settings column.
 *
 * SCREEN_W is the frame's INNER width and the scale must be computed against
 * it, not against the frame's outer width. Tailwind's preflight sets
 * `box-sizing: border-box`, so a w-[228px] element with a border-[9px] bezel
 * has a 210px content box. Scaling 390px down by 228/390 produced 228px of
 * content inside a 210px screen — every row and tile overhung the right bezel
 * by 18px and got clipped, while the left edge looked perfect because the
 * transform origin is top-left. It read as the hero's -inset-x-4 bleed
 * misbehaving; it was arithmetic.
 *
 * PHONE_H shows the whole home screen plus a short tail of page background.
 * The tail is not padding — it is what the fade lands on, and the fade can only
 * be judged if you can see it finish. Beyond that, extra height is dead space
 * that makes the photo look wrong even when it isn't.
 */
const PHONE_W = 390
const PHONE_H = 690
const FRAME_OUTER_W = 228
const BEZEL = 9
const SCREEN_W = FRAME_OUTER_W - BEZEL * 2
const SCALE = SCREEN_W / PHONE_W

/** The real mobile header is h-14; the preview reserves the same. */
const TOPBAR_H = 56

export function HomeImageCard({
  companyName,
  logoUrl,
  initialImageUrl,
  initialShowLockup,
  firstName,
}: {
  companyName: string
  logoUrl: string | null
  initialImageUrl: string | null
  initialShowLockup: boolean
  firstName: string
}) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(initialImageUrl)
  const [showLockup, setShowLockup] = useState(initialShowLockup)
  const [uploading, setUploading] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Every control on this card saves on change. There is no Save button because
  // there is nothing to review — the preview beside it already shows the result,
  // and a trainer who has just watched the change happen shouldn't then have to
  // confirm it.
  async function persist(patch: { homeHeroImageUrl?: string; homeHeroShowLockup?: boolean }) {
    setMsg(null)
    try {
      const res = await fetch('/api/trainer/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) {
        setError('Saving failed — please try again.')
        return false
      }
      setMsg('Saved!')
      router.refresh()
      return true
    } catch {
      setError('Saving failed — check your connection and try again.')
      return false
    }
  }

  async function upload(file: File) {
    setError(null)
    setMsg(null)
    setUploading(true)
    try {
      // Compress FIRST. A 12 MP phone photo is exactly what a trainer will
      // reach for here, and a raw one blows past the ~4.5 MB serverless body
      // limit — the upload then fails in a way that reads as "it's broken".
      const toSend = await compressImageFile(file)
      if (!(await isDisplayableImage(toSend))) {
        setError(
          "That image can't be displayed on the web — iPhone photos are often HEIC. Choose a JPG or PNG, or take a screenshot of it first.",
        )
        return
      }
      const fd = new FormData()
      fd.append('file', toSend)
      fd.append('kind', 'background')
      const up = await fetch('/api/trainer/branding-image', { method: 'POST', body: fd })
      const body = await up.json().catch(() => ({}))
      if (!up.ok) {
        setError(body.error ?? 'Upload failed.')
        return
      }
      setImageUrl(body.url)
      await persist({ homeHeroImageUrl: body.url })
    } catch {
      setError('Upload failed — check your connection and try again.')
    } finally {
      setUploading(false)
    }
  }

  async function removeImage() {
    setError(null)
    setImageUrl(null)
    await persist({ homeHeroImageUrl: '' })
  }

  async function toggleLockup(next: boolean) {
    setError(null)
    setShowLockup(next)
    await persist({ homeHeroShowLockup: next })
  }

  return (
    <AccordionItem
      title="Home screen image"
      subtitle="A photo behind the top of your home screen"
      defaultOpen
    >
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          {msg && <Alert variant="success" className="mb-3">{msg}</Alert>}

          <div className="flex flex-col gap-5">
            {/* The image */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-slate-700">Background photo</label>
              <p className="-mt-1 text-xs text-slate-400">
                Shown behind your logo and greeting, then fading out over the rows below it. A wide,
                calm photo works best — a busy one competes with the buttons.
              </p>
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-24 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                  {imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={imageUrl} alt="Home background" className="h-full w-full object-cover" />
                  ) : (
                    <ImagePlus className="h-5 w-5 text-slate-400" strokeWidth={1.75} />
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                  >
                    {uploading ? (
                      <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Uploading…</>
                    ) : (
                      imageUrl ? 'Replace' : 'Upload image'
                    )}
                  </Button>
                  {imageUrl && (
                    <button
                      type="button"
                      onClick={removeImage}
                      className="self-start text-xs text-slate-400 hover:text-red-500"
                    >
                      Remove
                    </button>
                  )}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0]
                    if (f) upload(f)
                    e.target.value = ''
                  }}
                />
              </div>
            </div>

            {/* The lockup choice — logo AND greeting, together. The label says
                both out loud: "Show my logo" would be a lie about a control
                that also removes the "Good evening" line. */}
            <div className="flex flex-col gap-2">
              <label className="flex items-start gap-2.5 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={showLockup}
                  onChange={e => toggleLockup(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                />
                <span>Show my logo and greeting</span>
              </label>
              <p className="text-xs text-slate-400">
                Off leaves just the photo. This is your business&apos;s home screen — everyone on
                your team sees whichever you choose.
              </p>
            </div>

            {error && <Alert variant="error">{error}</Alert>}
          </div>
        </div>

        {/* Live preview — the real hero, at phone proportions. */}
        <div className="lg:w-[260px] lg:flex-shrink-0" data-testid="home-hero-preview-column">
          <div className="mx-auto w-[228px]">
            <div
              className="relative overflow-hidden rounded-[2rem] border-[9px] border-slate-900 bg-slate-900 shadow-2xl ring-1 ring-black/20"
              aria-label="Preview of your home screen"
            >
              {/* No notch. The frame borrowed one from BrandPreview, which can
                  afford it because its first row is a status bar — here the
                  first row is the app's own top bar, and the notch sat straight
                  across the business name. The bezel and the corner radius are
                  enough to read as a phone. */}
              {/* Height is the scaled height of the 390px render below it. */}
              <div
                className="overflow-hidden rounded-[1.5rem] bg-[var(--pm-page-bg)]"
                style={{ height: PHONE_H * SCALE, width: SCREEN_W }}
              >
                <div
                  className="relative origin-top-left"
                  style={{ width: PHONE_W, height: PHONE_H, transform: `scale(${SCALE})` }}
                >
                  {/* The shell's p-4 and the top bar's height, exactly as the
                      dashboard lays them out — the hero bleeds past that
                      padding and tucks under that bar, so previewing it without
                      either would show the wrong bleed and the wrong top edge. */}
                  <div className="p-4" style={{ paddingTop: TOPBAR_H + 16 }}>
                    <HomeHero
                      imageUrl={imageUrl}
                      showLockup={showLockup}
                      logoUrl={logoUrl}
                      businessName={companyName}
                      firstName={firstName}
                      greeting="evening"
                    >
                      <PreviewRows />
                    </HomeHero>
                  </div>
                  {/* Last, and absolutely positioned, so it paints OVER the
                      photo the way the real sticky header does. */}
                  <PreviewTopBar businessName={companyName} />
                </div>
              </div>
            </div>
            <p className="mt-3 text-center text-xs text-slate-400">
              Live preview of your home screen
            </p>
          </div>
        </div>
      </div>
    </AccordionItem>
  )
}

/**
 * ⚠ STAND-IN for the shell's real mobile header (TrainerMobileHeader in
 * components/shared/app-shell.tsx). Keep the two in step by hand.
 *
 * The real one could not be reused here, and the reason is worth writing down
 * so nobody spends the afternoon rediscovering it. Three blockers, any one of
 * which is fatal:
 *
 *   1. It is module-private — not exported from app-shell.tsx.
 *   2. It renders the portal TARGETS `#pm-topbar-back-mobile` and
 *      `#pm-topbar-actions-mobile` as fixed DOM ids. Settings already has the
 *      real header mounted, so a second copy would duplicate those ids and
 *      getElementById would resolve to whichever came first — silently
 *      redirecting the LIVE header's action slot into a 0.54-scale preview.
 *      That is a working screen broken by a picture of a screen.
 *   3. Its contents are live and interactive: FloatingCreateButton opens the
 *      create sheet, TopBarControls owns the real search overlay, and the title
 *      comes from usePageTitle()/usePathname() context that reads the SETTINGS
 *      route, not /dashboard.
 *
 * So this is a deliberately dumb copy of the same markup. What it must keep
 * faithful, because it is the whole reason Karl asked for the bar:
 * `bg-white/95 backdrop-blur`. The photo tucks under this bar, and a photo
 * behind a blurred translucent bar looks nothing like one behind a plain white
 * strip. A preview showing a solid bar would mislead in exactly the way that
 * matters when you're choosing an image.
 *
 * Non-interactive on purpose — divs, not buttons, and a span rather than the
 * real <h1>. The settings page already has its own h1, and the shell's comment
 * is explicit that exactly one ever renders.
 */
function PreviewTopBar({ businessName }: { businessName: string }) {
  return (
    <div
      aria-hidden
      className="absolute inset-x-0 top-0 z-10 border-b border-slate-100 bg-white/95 backdrop-blur"
      style={{ height: TOPBAR_H }}
    >
      <div className="flex h-14 items-center gap-2 px-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-500">
          <Menu className="h-5 w-5" />
        </span>
        {/* On /dashboard the real header shows the BUSINESS, not a page title —
            the home screen is the one route where it isn't naming a page. */}
        <span className="min-w-0 flex-1 truncate text-base font-semibold text-slate-900">
          {businessName.trim() || 'PupManager'}
        </span>
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-500">
          <Plus className="h-5 w-5" />
        </span>
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-500">
          <Search className="h-5 w-5" />
        </span>
      </div>
    </div>
  )
}

/**
 * Stand-in rows and tiles. Their job is to give the fade something to land
 * across at the right proportions — the fade ends fully opaque at the bottom of
 * this block, so the preview has to include enough of it to judge that.
 *
 * Six tiles, not two, because the real home has six and the fade is spread over
 * their whole height. Two tiles left the frame half empty AND compressed the
 * fade into a shorter run than the trainer will actually see, so the preview
 * was wrong twice over. Counts are illustrative — live ones would tell a
 * trainer choosing a photo nothing the shape doesn't.
 */
const PREVIEW_TILES = [
  { label: 'Schedule', sub: '5 sessions today', Icon: Calendar },
  { label: 'Clients', sub: '46 active', Icon: Users },
  { label: 'Offerings', sub: '1:1 Sessions & classes', Icon: Layers },
  { label: 'To do', sub: '16 to write', Icon: FileText },
  { label: 'Instant sale', sub: 'Charge a client now', Icon: Receipt },
  { label: 'Money', sub: '$4,805 to invoice', Icon: Wallet },
]

function PreviewRows() {
  return (
    <>
      <div className="mb-3 flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5">
        <ClipboardCheck className="h-[18px] w-[18px] flex-shrink-0 text-slate-700" strokeWidth={1.75} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">4 things to review</span>
        <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-400" />
      </div>
      <div className="mb-3 flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5">
        <Calendar className="h-[18px] w-[18px] flex-shrink-0 text-slate-700" strokeWidth={1.75} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">5 sessions today</span>
        <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-400" />
      </div>
      <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-slate-200 bg-white [&>*]:border-b [&>*]:border-r [&>*]:border-slate-200 [&>*:nth-child(2n)]:border-r-0 [&>*:nth-last-child(-n+2)]:border-b-0">
        {PREVIEW_TILES.map(({ label, sub, Icon }) => (
          <div key={label} className="flex min-h-[104px] flex-col items-start justify-center px-4 py-4">
            <Icon className="h-[22px] w-[22px] text-slate-700" strokeWidth={1.75} />
            <span className="mt-2.5 block text-[15px] font-semibold leading-tight text-slate-900">{label}</span>
            <span className="mt-1 block text-[13px] leading-tight text-slate-500">{sub}</span>
          </div>
        ))}
      </div>
    </>
  )
}
