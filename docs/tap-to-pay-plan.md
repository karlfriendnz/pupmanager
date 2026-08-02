# Tap to Pay — can we do it, and what it takes

Research, plan, and what is now built. Updated 2026-08-02.

**Read §0 before re-opening any question below.** Several of the unknowns in §9
have since been settled against the real Stripe sandbox.

---

## 0. Settled — do not re-litigate

Probed against Stripe's sandbox on a real **Express** connected account
(`acct_1TpfYv20u1I9p5su`, `type=express`, `country=NZ`, `charges_enabled=true`)
on 2026-08-02, with a test key, and again **through our own route handlers**.

| Question | Answer | How we know |
|---|---|---|
| Does Stripe restrict Tap to Pay by connected-account type? **We are on Express.** | **No. Express works.** | A `card_present` PaymentIntent created as a **direct charge** on that Express account returned `requires_payment_method`, nzd 4500. This was the one question that could have killed the feature. |
| Can `terminal.connection_tokens` be minted for an Express account? | **Yes** — `pst_test_…`, via the `Stripe-Account` header. | Called through `POST /api/terminal/connection-token`. |
| Can a Terminal **Location** be created on an Express account? | **Yes**, and our lazy create-on-first-tap works. | Same route; `tml_…` returned and cached on the trainer. |
| Does `terminal.onboarding_links` accept our account, and what is the body? | **Yes.** `link_type: 'apple_terms_and_conditions'` (the API rejects every other value by name) **plus** `link_options.apple_terms_and_conditions.merchant_display_name` (required) and `allow_relinking` (optional). | Read off the installed SDK's own types (`node_modules/stripe/…/Terminal/OnboardingLinks.d.ts`), then called for real — it returns a genuine `register.apple.com/tap-to-pay-on-iphone/…` URL. |
| Can `application_fee_amount` be set when the card-present intent is **created**, or must it wait for capture? | **At creation.** Accepted, and re-asserted at capture from the amount actually authorised. §9.2 is closed. | Same probe: `fee=45` on a 4500 intent. |
| Apple development entitlement | **Granted** (2026-08-02, by email). Distribution is a separate request and needs a video of the flow, so it is blocked until this runs on a device. | |

**Countries.** Tap to Pay general availability: AT AU BE CA CH CZ DE DK ES FR GB
IE IT NL **NZ** PL PT SE SG US. Public preview (deliberately excluded — a
preview country can be withdrawn, and finding that out mid-sale is worse than
the button never appearing): BG CY EE FI HR HU JP LI LT LU LV MT MX MY NO RO SI
SK. **South Africa is on neither list.**

**iPads have no NFC** and can never do this, however new they are. The app runs
on iPads, so this is the single most likely disappointment and it is handled
explicitly rather than left to fail at the tap.

All sandbox objects created while probing were deleted.

---

## 1. The answer

**Yes — and New Zealand is fully supported.**

NZ is in **general availability** for Tap to Pay on iPhone *and* on Android, and Stripe is one of the launch providers here. Our Stripe setup (Connect, direct charges) is the exact setup Stripe documents for this, so nothing about how we take money has to change.

The catch is that it is a **native** feature. It cannot run in a browser. So it only ever works inside the PupManager iPhone/Android app, and shipping it means a new App Store / Play build plus an approval from Apple that takes weeks.

Sources: [Tap to Pay — iOS](https://docs.stripe.com/terminal/payments/setup-reader/tap-to-pay.md?platform=ios) · [Tap to Pay — Android](https://docs.stripe.com/terminal/payments/setup-reader/tap-to-pay.md?platform=android) · [Apple regions](https://developer.apple.com/tap-to-pay/regions/)

---

## 2. Our six currencies vs. where it works

| Currency | Country | iPhone | Android | Stripe Terminal at all |
|---|---|---|---|---|
| NZD | New Zealand | ✅ live | ✅ live | ✅ |
| AUD | Australia | ✅ live | ✅ live | ✅ |
| GBP | United Kingdom | ✅ live | ✅ live | ✅ |
| CAD | Canada | ✅ live | ✅ live | ✅ |
| USD | United States | ✅ live | ✅ live | ✅ |
| ZAR | South Africa | ❌ no | ❌ no | ❌ no |

1. Five of our six markets are covered.
2. **South Africa is not.** Stripe Terminal doesn't operate there at all, so ZA trainers can't have this. **Built:** the server refuses with its own `COUNTRY_UNSUPPORTED` code, the till never draws the row, and Settings → Payments says so in one sentence rather than leaving them to wonder what they configured wrong.

Source: [Terminal country availability](https://docs.stripe.com/terminal/payments/regional.md)

---

## 3. What we already have (checked in the code)

| Thing | What it actually is | Where |
|---|---|---|
| Connect account type | **Express** | `src/lib/connect.ts:291` |
| Charge type | **Direct charges** — `{ stripeAccount: … }` | `src/lib/connect-checkout.ts:152` |
| Our cut | 1% as `application_fee_amount` | `src/lib/connect.ts:142` |
| Test vs live | `sandboxBilling` picks the key pair | `src/lib/stripe.ts:36` |
| Webhook | already handles `payment_intent.succeeded` keyed on `metadata.paymentId` | `src/app/api/webhooks/stripe/connect/route.ts:155` |
| In-person sale today | Sale composer → "Take payment now" → **a QR code the client scans on their own phone** | `src/components/shared/sale-composer.tsx:1112` |
| Guest sale API | gated on the `pos` add-on + Stripe connected | `src/app/api/trainer/finances/sales/guest/route.ts` |
| Native app | Capacitor 8; iOS target **16.4**, Android minSdk **26** (both raised for this) | `capacitor.config.ts` |
| Native plugins | app, push-notifications, status-bar, apple-sign-in, badge — plus **our own TapToPay**, written here rather than pulled from npm | `package.json`, `ios/App/App/TapToPayPlugin.swift` |

Two things worth saying out loud:

1. **The webhook already does the hard part.** A Tap to Pay payment is just a PaymentIntent. If we stamp it with the same `metadata.paymentId`, it fulfils down the identical path as a QR payment. No new fulfilment code.
2. ~~A stale comment in `connect.ts` says "destination charges".~~ **Fixed on main** (`548bfea`). The code does, and Tap to Pay continues to do, **direct** charges.

---

## 4. Blockers

| # | Blocker | State | Who |
|---|---|---|---|
| 1 | Apple **entitlement** | **Development GRANTED** 2026-08-02. **Distribution still open** — needs a video of the real flow, so it can only be requested once this runs on a device. This is the schedule. | **Karl** → **Apple** |
| 2 | Apple Developer account must be an **Organization** account | Presumed yes (the dev entitlement was granted). Worth confirming before the distribution request. | **Karl** |
| 3 | Android: Capacitor doesn't inject its plugin bridge on `allowNavigation` origins | **Cause found, fix written** — `RemoteOriginBridge`. See §10. Untested on hardware. | **Us** |
| 4 | Each trainer accepts **Apple's terms** individually | **BUILT** — Settings → Payments row, one tap, opens Apple in the real browser. | **trainer** (clicks it) |
| 5 | Terminal must be on for our Stripe platform | **Still open.** The sandbox works; the live platform account has not been checked, and Apple's Acceptance Platform terms have not been accepted as a platform. | **Karl** / **Stripe** |
| 6 | Native binary release | **Still open.** Cannot ship on a web deploy. | **Us**, then **Apple/Google** |
| 7 | Android minSdk 23 → 26, NFC/location permissions | **BUILT.** | — |
| 8 | ZA trainers can't use it | **BUILT** — refused server-side with its own reason code, and the settings row tells them plainly. | — |
| 9 | iOS deployment target 15.0 → **16.4** | **BUILT, but it is a product decision**: iOS 15 handsets lose the native shell. The web app is unaffected. Karl to accept. | **Karl** |

---

## 5. What Karl personally has to do

~~1. Check the account is an Organization account.~~ ~~2. Request the development entitlement.~~ **Both done — the development entitlement was granted 2026-08-02.**

Now, in order:

1. **In the Stripe Dashboard, confirm Terminal is enabled** on the PupManager **live** platform account, and accept Apple's Acceptance Platform terms **as a platform**. The sandbox is proven; live is not. This is free and unblocks nothing else, so do it first.
2. **Accept the iOS 15 drop.** Stripe's floor for Tap to Pay is iOS 16.4, so the native shell's deployment target moves 15.0 → 16.4. iOS 15 users keep the web app and lose the installed app until they update their phone. If that is not acceptable, this feature cannot ship on iOS.
3. **Do the Xcode work** (§10, "What still needs a Mac"): add the Swift file to the target, `cap sync`, `pod install`, regenerate the provisioning profile with the entitlement, run on a real iPhone XS+.
4. **Then request the distribution entitlement**, with a video of the real payment flow. This is the slow one — developers report anything from days to six weeks. Nothing can be built around it.
5. **Decide the packaging** — Tap to Pay currently rides on the existing `pos` add-on, on the reasoning that a trainer who can already take an in-person payment by QR shouldn't buy anything else to take the same payment by tap. Change it now if that's wrong; it is one line in `_guard.ts`.
6. **Accept there is a store submission.** Unlike everything else we ship, a fix to the tap flow needs a resubmission, not a web deploy. The version gate matters more once this exists.
7. **Tell trainers what device they need**: an iPhone XS or newer on iOS 16.4+. **Not an iPad** — no iPad has a card reader. Android 13+ with NFC is phase two.

---

## 6. What we build, in order

**All nine are now done** — see §10 for where each landed, and for the two
departures from this plan (we wrote our own Capacitor plugin instead of taking
the community one, and the tap rings the sale up through the existing sale API
rather than charging lines directly). Kept as the record of what was intended.

| # | Piece | What it is | Size |
|---|---|---|---|
| 1 | `POST /api/terminal/connection-token` | Calls `terminal.connection_tokens.create` with the trainer's `stripeAccount`. The SDK asks for this itself. | **S** — half a day |
| 2 | Terminal **Location** per trainer | Create one on the connected account (business name + address), store `terminalLocationId` on `TrainerProfile`. Needed at connect time. | **S** — one small schema field |
| 3 | `POST /api/terminal/onboarding-link` | Terminal Onboarding Link, `link_type: apple_terms_and_conditions`, `on_behalf_of: <trainer account>`. Trainer clicks it once, ever. Add a row to Settings → Payments. | **S** |
| 4 | `POST /api/terminal/payment-intent` | Reuse `createPaymentRecord()` from `connect-checkout.ts`, then create a PaymentIntent on the connected account: `payment_method_types: ['card_present']`, `capture_method: 'manual'`, our `application_fee_amount`, `metadata.paymentId`. | **M** |
| 5 | `POST /api/terminal/capture` | Capture the authorised intent. Must happen within 2 days or the auth expires. | **S** |
| 6 | Native plugin | **Changed:** we wrote our OWN thin plugin over Stripe's iOS/Android SDKs rather than depending on `@capacitor-community/stripe-terminal`. It is about forty lines a side, and Stripe's surface is versioned, documented and the thing Apple audits — a better place to stand than a community package sitting between us and a trainer's money. | **L** — done, untested on hardware |
| 7 | UI | Built. **Changed:** the row rings the sale up through the ordinary sale API FIRST, so a tap moves stock through the same ledger as every other sale and a failed tap leaves a recoverable unpaid invoice. | **M** — done |
| 8 | Fulfilment | **Nothing.** The existing `payment_intent.succeeded` webhook already resolves by `metadata.paymentId`. | **–** |
| 9 | Tests | Unit tests for the five routes incl. tenant + ownership guards. Native flow can't be e2e'd — cover it at the API boundary. | **M** |

The estimate was 3–5 weeks of build. The build is done. What is left is Apple's
distribution entitlement (days to six weeks, unpredictable), the Xcode work, and
a store submission — so **the remaining schedule is almost entirely other
people's**, which is the position §11 recommends getting to as fast as possible.

---

## 7. Cost

New Zealand numbers, per payment.

| | Rate | Fixed |
|---|---|---|
| Stripe **online** card (what we use today) | 2.65% | NZ$0.30 |
| Stripe **in-person** card | 2.6% | NZ$0.05 |
| Tap to Pay surcharge | – | NZ$0.15 |
| **Stripe in-person, all in** | **2.6%** | **NZ$0.20** |
| Plus our 1% platform fee | 1% | – |
| **What the trainer pays, today (QR/online)** | **3.65%** | **NZ$0.30** |
| **What the trainer pays, with Tap to Pay** | **3.6%** | **NZ$0.20** |

1. Tap to Pay is **slightly cheaper** than what we do now, not more expensive.
2. **Our 1% is unchanged.** Same direct-charge mechanism, same `application_fee_amount`.
3. No hardware to buy — that's the actual saving versus a card reader.
4. There's an optional +NZ$0.08/auth for point-to-point encryption we do not need.

Source: [Stripe NZ pricing](https://stripe.com/nz/pricing)

---

## 8. The honest risks

1. **The Android bridge bug is real.** Our app loads `app.pupmanager.com` remotely rather than bundling the site. On iOS Capacitor injects its plugin bridge into any page, so plugins work. On Android it only injects into the base URL — so on `app.pupmanager.com` every plugin call fails with "not implemented on android". Capacitor issue [#7454](https://github.com/ionic-team/capacitor/issues/7454) is open; [#5455](https://github.com/ionic-team/capacitor/issues/5455) was closed "not planned". There is a community patch to `MainActivity`. The alternative — switching to `server.url` — would break our offline loader and Ionic warn against it for store builds. **Do iOS first and treat Android as a separate phase.**
2. **Apple's distribution entitlement can stall.** Developers report 26 days and 6 weeks in Apple's own forums. If it stalls, this is months, not weeks — and there is nothing we can build our way around.
3. **We'd depend on a community plugin, not a Stripe one.** Stripe ships iOS, Android and React Native SDKs — **no Capacitor SDK**. `@capacitor-community/stripe-terminal` is maintained (v8.1.1, ~13.5k weekly downloads, Tap to Pay commits this year) but it isn't Stripe's. If it goes stale we'd have to wrap the native SDKs ourselves, which is a big job.
4. **Release cadence changes.** Everything we ship today goes live on a web deploy. This lands only in a store build, so a bug fix in the tap flow needs a resubmission. The version gate matters more once this exists.
5. **App Store review of a payments feature** is stricter than a normal update, and Apple has design rules for how the tap screen must look.
6. **Android testing is awkward.** Tap to Pay refuses to run with Developer options enabled, on rooted devices, on emulators, or with screen recording or overlays active. That fights the normal debugging loop.
7. **South Africa gets nothing**, and the UI has to say why rather than just failing.

---

## 9. What I could NOT determine

~~1. Whether Stripe restricts Tap to Pay by connected-account type.~~ **Settled — Express works. See §0.**

~~2. Whether `application_fee_amount` can be set at creation.~~ **Settled — yes, at creation. See §0.**

Still open:

3. **Whether our Apple Developer account is an Organization account** and whether Karl is the Account Holder. Can't see that from the repo. (The development entitlement has since been granted, which is strong evidence it is — but the distribution one is a separate gate.)
4. **Whether Xcode Cloud can build with the Tap to Pay entitlement** — the provisioning profile has to carry it, and the profile has to be regenerated after Apple grants it. Our iOS builds go through Xcode Cloud off a release branch.
5. **In-person rates for AU / GB / CA / US.** Only NZ was verified against Stripe's rate card. Same shape, different numbers.
6. Whether Stripe's NZ "starting at 2.6%" is volume-tiered.
7. Whether Apple's tap-screen design rules conflict with our flat house style.
8. **Whether the Android bridge fix actually works on a handset.** The cause is now understood exactly (§10) and the fix is written, but it has never run — Android is phase two and the whole platform is untested here.

---

## 10. What is built

On branch **`feature/tap-to-pay`**, unpushed. Typecheck clean, lint clean, full
unit suite green (3812 passed).

### Server

| Built | File |
|---|---|
| Core Terminal library | `src/lib/terminal.ts` |
| Shared gate for all five routes | `src/app/api/terminal/_guard.ts` |
| Connection token | `src/app/api/terminal/connection-token/route.ts` |
| Apple terms link | `src/app/api/terminal/onboarding-link/route.ts` |
| PaymentIntent (`card_present`, manual capture) | `src/app/api/terminal/payment-intent/route.ts` |
| Capture | `src/app/api/terminal/capture/route.ts` |
| Eligibility — drives the UI, and says WHY | `src/app/api/terminal/eligibility/route.ts` |
| Terms acceptance, recorded from a real connection | `src/app/api/terminal/reader-connected/route.ts` |
| `terminalLocationId`, `tapToPayTermsLinkedAt`, `tapToPayTermsAcceptedAt` | `prisma/schema.prisma` + 2 migrations |

### Client

| Built | File |
|---|---|
| Device rules (iPad, iPhone XS, OS floors) — pure, unit-tested | `src/lib/tap-to-pay-device.ts` |
| The four authorities combined into one answer | `src/lib/use-tap-to-pay.ts` |
| The JS half of the native bridge | `src/lib/tap-to-pay-native.ts` |
| The tap screen a client reads | `src/components/shared/tap-to-pay-sheet.tsx` |
| Third row on the sale composer's payment step | `src/components/shared/sale-composer.tsx` |
| Settings → Payments row for Apple's terms | `src/app/(trainer)/settings/tap-to-pay-row.tsx` |

### Native

| Built | File |
|---|---|
| iOS plugin over Stripe's SDK | `ios/App/App/TapToPayPlugin.swift` |
| Android plugin over Stripe's SDK | `android/app/src/main/java/com/pupmanager/app/TapToPayPlugin.java` |
| **The Android bridge fix — blocker #3** | `android/app/src/main/java/com/pupmanager/app/RemoteOriginBridge.java` |
| Registration + injection | `.../MainActivity.java` |
| Apple entitlement, location usage string, StripeTerminal pod, iOS target 15.0 → **16.4** | `ios/App/App/App.entitlements`, `Info.plist`, `Podfile`, `project.pbxproj` |
| NFC + location permissions, minSdk 23 → **26**, Stripe Terminal deps | `android/…/AndroidManifest.xml`, `variables.gradle`, `app/build.gradle` |

### Three decisions worth knowing

**A tap is not a second kind of sale.** It rings the sale up down the ordinary
path first — the same `POST /api/trainer/finances/receivables` that "Record as
unpaid" makes, so the same invoice, the same units off the shelf through
`stock.ts`'s ledger, the same Xero codes — and only then raises a card-present
intent against that sale. There is no second writer of a sale or of stock. That
ordering is also the recovery: a tap that fails or is cancelled leaves the sale
as an unpaid invoice with its "Take payment now instead" QR, with the customer
still standing there.

**Charges stay DIRECT**, on the trainer's Express account, with our margin as
`application_fee_amount` read off the Payment row that already recorded it. No
destination charges, and no second calculation of the fee.

**Apple's terms are recorded, never claimed.** There is no "I've done it" button.
Minting a link sets `tapToPayTermsLinkedAt`; only a device that successfully
connects a reader sets `tapToPayTermsAcceptedAt`, because Stripe's SDK refuses to
connect until Apple's terms are accepted. A trainer who ticked a box without
finishing would be told they were ready and then fail at the till.

### Blocker #3 — the Android bridge — root cause, and the fix

`Bridge.loadWebView()` registers Capacitor's JS with
`WebViewCompat.addDocumentStartJavaScript(webView, script, singleton(allowedOrigin))`,
and `allowedOrigin` comes from **`appUrl` alone**. We set no `server.url`, so
`appUrl` is `https://localhost` — the bridge is injected for localhost and
nothing else. On `app.pupmanager.com` there is no `window.Capacitor`, and every
plugin call fails "not implemented on android". **This is why push, status bar
and Apple sign-in have all worked on iOS and been quietly dead on Android.**

`RemoteOriginBridge` registers the same script for our real origin as well;
`addDocumentStartJavaScript` accepts more than one origin rule, so nothing is
replaced. It reads Capacitor's script by reflection rather than rebuilding it
from the public `JSExport` helpers, because rebuilding means copying a
concatenation order that drifts on every Capacitor upgrade and only surfaces
when a plugin stops working in production. Failure is bounded: it logs, the
bridge isn't injected, `isSupported()` rejects, and the trainer is told to update
the app rather than shown a button that cannot work. Pinned to Capacitor 8.3.x.

**Untested on hardware.** The cause is certain; the fix is not proven.

### What still needs a Mac, Xcode, and a real iPhone

Nothing below can be done or verified from a CLI, and none of it was attempted.

1. `npm install` is **not** needed — the plugins use `registerPlugin` from
   `@capacitor/core`, which is already a dependency. There is no new npm package.
2. **Add `TapToPayPlugin.swift` to the App target in Xcode.** One drag. Without
   it the file is on disk and not in the build.
3. `npx cap sync ios` then `pod install` in `ios/App` — pulls `StripeTerminal ~> 4.7`.
4. **Regenerate the provisioning profile** so it carries
   `com.apple.developer.proximity-reader.payment.acceptance`. The build will not
   sign without it. Xcode Cloud needs the same profile.
5. Run on a **real iPhone XS or newer, iOS 16.4+**. Not a simulator — Apple
   refuses.
6. Android: `npx cap sync android`, then a real Android 13+ handset with NFC,
   with developer options **off** (Tap to Pay refuses otherwise), no screen
   recorder, no overlays.

## 11. Recommendation

1. **Do §5 step 1 this week** — enable Terminal and accept Apple's platform terms on the LIVE Stripe account. Free, and everything else waits on it.
2. **Get it running on one real iPhone**, then film it. The video is the distribution entitlement request, and that request is the whole remaining schedule.
3. **Ship iOS only.** Android's bridge fix is written and its root cause is understood, but nothing on that platform has run — treat it as a separate phase with its own testing, on a handset with developer options off.
4. **Soft-launch to one trainer** — ideally Brooke, in a hall, with a real card. Everything about this feature is designed around the moment it fails in front of a paying customer, and the only way to know we got that right is to watch it happen once.
