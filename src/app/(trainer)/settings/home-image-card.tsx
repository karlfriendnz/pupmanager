'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Calendar, ChevronRight, ClipboardCheck, ImagePlus, Loader2, Users } from 'lucide-react'
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
 * PHONE_H is deliberately taller than the preview content needs. The fade only
 * makes sense if you can see it FINISH — a frame cropped mid-tile-grid shows
 * the photo still going and answers nothing. The spare height below the tiles
 * is not padding, it's the page background the fade lands on, which is the
 * thing being judged.
 */
const PHONE_W = 390
const PHONE_H = 700
const FRAME_W = 228
const SCALE = FRAME_W / PHONE_W

export function HomeImageCard({
  companyName,
  logoUrl,
  initialImageUrl,
  initialShowLogo,
  firstName,
}: {
  companyName: string
  logoUrl: string | null
  initialImageUrl: string | null
  initialShowLogo: boolean
  firstName: string
}) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(initialImageUrl)
  const [showLogo, setShowLogo] = useState(initialShowLogo)
  const [uploading, setUploading] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Every control on this card saves on change. There is no Save button because
  // there is nothing to review — the preview beside it already shows the result,
  // and a trainer who has just watched the change happen shouldn't then have to
  // confirm it.
  async function persist(patch: { homeHeroImageUrl?: string; homeHeroShowLogo?: boolean }) {
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

  async function toggleLogo(next: boolean) {
    setError(null)
    setShowLogo(next)
    await persist({ homeHeroShowLogo: next })
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

            {/* The logo choice */}
            <div className="flex flex-col gap-2">
              <label className="flex items-start gap-2.5 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={showLogo}
                  onChange={e => toggleLogo(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                />
                <span>Show my logo on the home screen</span>
              </label>
              <p className="text-xs text-slate-400">
                Off leaves just the greeting over the photo. This is your business&apos;s home screen —
                everyone on your team sees whichever you choose.
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
              <div
                aria-hidden
                className="absolute left-1/2 top-0 z-20 h-4 w-20 -translate-x-1/2 rounded-b-xl bg-slate-900"
              />
              {/* Height is the scaled height of the 390px render below it. */}
              <div
                className="overflow-hidden rounded-[1.5rem] bg-[var(--pm-page-bg)]"
                style={{ height: PHONE_H * SCALE }}
              >
                <div
                  className="origin-top-left"
                  style={{ width: PHONE_W, height: PHONE_H, transform: `scale(${SCALE})` }}
                >
                  {/* p-4 + a header strip, exactly like the dashboard shell —
                      the hero bleeds past that padding, so previewing it
                      without the padding would show the wrong bleed. */}
                  <div className="h-9 border-b border-slate-100 bg-white" />
                  <div className="p-4">
                    <HomeHero
                      imageUrl={imageUrl}
                      showLogo={showLogo}
                      logoUrl={logoUrl}
                      businessName={companyName}
                      firstName={firstName}
                      greeting="evening"
                    >
                      <PreviewRows />
                    </HomeHero>
                  </div>
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
 * Stand-in rows and tiles. Their job is to give the fade something to land
 * across at the right proportions — the fade ends fully opaque at the bottom of
 * this block, so the preview has to include enough of it to judge that.
 */
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
      <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-slate-200 bg-white [&>*]:border-r [&>*]:border-slate-200 [&>*:nth-child(2n)]:border-r-0">
        {[
          { label: 'Schedule', sub: '5 sessions today', Icon: Calendar },
          { label: 'Clients', sub: '24 active', Icon: Users },
        ].map(({ label, sub, Icon }) => (
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
