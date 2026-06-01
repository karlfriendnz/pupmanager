import type { Metadata } from 'next'
import { PhoneFrame, BrowserFrame } from './parts'
import { MOCK } from './mock'
import { DesktopHome } from './desktop-home'
import { ConceptChooser } from './concept-chooser'
import { ConceptA } from './concept-a'
import { ScreenSessions } from './screen-sessions'
import { ScreenSessionDetail } from './screen-session-detail'
import { ScreenClasses } from './screen-classes'
import { ScreenMessages } from './screen-messages'
import { ScreenShop } from './screen-shop'
import { ScreenAchievements } from './screen-achievements'
import { ScreenDogs } from './screen-dogs'
import { ScreenDetails } from './screen-details'

export const metadata: Metadata = { title: 'Client app — concepts' }

// TEMP design bake-off — the full client screen set, mock data, no auth
// (whitelisted in proxy.ts). One PupManager-branded app; a client with 2+
// trainers sees the chooser first (~10% of the time), else straight to Home.
// Remove this route before shipping.
export default function ConceptsPage() {
  return (
    <div className="min-h-screen bg-white px-6 py-10">
      <div className="max-w-[1600px] mx-auto">
        <header className="mb-8 text-center">
          <h1 className="font-display text-3xl font-extrabold text-slate-900">Client app — full screen set</h1>
          <p className="text-slate-500 mt-2 max-w-2xl mx-auto">
            One PupManager-branded app (teal). A client can have multiple trainers — each is colour-tagged
            for wayfinding. The chooser only appears for clients with 2+ trainers; everyone else lands on Home.
          </p>
        </header>

        <div className="flex flex-wrap gap-x-10 gap-y-12 justify-center">
          <PhoneFrame label="Choose your trainer" blurb="Only when a client has 2+ trainers (~10%)." nav={false}>
            <ConceptChooser />
          </PhoneFrame>
          <PhoneFrame label="Home · one dog" blurb="The common case (~90%) — no dog switcher.">
            <ConceptA dogs={[MOCK.dogs[0]]} />
          </PhoneFrame>
          <PhoneFrame label="Home · multiple dogs" blurb="Same screen with the dog switcher on the hero.">
            <ConceptA />
          </PhoneFrame>
          <PhoneFrame label="Sessions" blurb="Upcoming + past, with notes.">
            <ScreenSessions />
          </PhoneFrame>
          <PhoneFrame label="Session detail" blurb="Notes, homework, recording & files.">
            <ScreenSessionDetail />
          </PhoneFrame>
          <PhoneFrame label="Classes" blurb="Group classes — enrolled & open.">
            <ScreenClasses />
          </PhoneFrame>
          <PhoneFrame label="Messages" blurb="Opens straight into the chat with your trainer.">
            <ScreenMessages />
          </PhoneFrame>
          <PhoneFrame label="Shop" blurb="Recommended products + your library.">
            <ScreenShop />
          </PhoneFrame>
          <PhoneFrame label="Achievements" blurb="Streak, next badge, trophy room.">
            <ScreenAchievements />
          </PhoneFrame>
          <PhoneFrame label="My dogs" blurb="All the client's dogs.">
            <ScreenDogs />
          </PhoneFrame>
          <PhoneFrame label="My details" blurb="Client profile & contact.">
            <ScreenDetails />
          </PhoneFrame>
        </div>

        {/* Desktop / web */}
        <div className="mt-20">
          <div className="text-center mb-6">
            <h2 className="font-display text-2xl font-extrabold text-slate-900">On desktop / web</h2>
            <p className="text-slate-500 mt-1 max-w-2xl mx-auto">Same app at app.pupmanager.com — the bottom tabs become a left sidebar and the home reflows into two columns. Same look and feel.</p>
          </div>
          <div className="flex justify-center">
            <BrowserFrame>
              <DesktopHome />
            </BrowserFrame>
          </div>
        </div>
      </div>
    </div>
  )
}
