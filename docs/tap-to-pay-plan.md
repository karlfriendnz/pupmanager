# Tap to Pay — can we do it, and what it takes

Research + plan. Nothing built. 2026-08-02.

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
2. **South Africa is not.** Stripe Terminal doesn't operate there at all, so ZA trainers can't have this. The button has to hide itself for them.

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
| Native app | Capacitor 8, iOS target 15.0, Android minSdk 23 | `capacitor.config.ts` |
| Native plugins today | app, push-notifications, status-bar, apple-sign-in, badge | `package.json` |

Two things worth saying out loud:

1. **The webhook already does the hard part.** A Tap to Pay payment is just a PaymentIntent. If we stamp it with the same `metadata.paymentId`, it fulfils down the identical path as a QR payment. No new fulfilment code.
2. **A stale comment.** The header of `src/lib/connect.ts` (lines 14–16) still says "destination charges". The code does **direct** charges. Worth fixing so nobody plans off the wrong sentence.

---

## 4. Blockers

| # | Blocker | What it needs | Who does it |
|---|---|---|---|
| 1 | Apple **entitlement** for Tap to Pay | Request dev entitlement, then a separate distribution entitlement. Apple wants a demo video. | **Karl** → **Apple** |
| 2 | Apple Developer account must be an **Organization** account, requested by the **Account Holder** | Confirm ours is, and that Karl is the holder | **Karl** |
| 3 | Android: Capacitor doesn't inject its plugin bridge on `allowNavigation` origins | Patch `MainActivity` (community fix), or change how the shell loads | **Us** |
| 4 | Each trainer must accept **Apple's Tap to Pay terms** individually | Stripe's Terminal Onboarding Link API, one link per connected account | **Us** (build it), **trainer** (clicks it) |
| 5 | Terminal must be on for our Stripe platform | Check/enable in the Stripe Dashboard | **Karl** / **Stripe** |
| 6 | Native binary release | New App Store + Play submission; can't ship via a normal web deploy | **Us**, then **Apple/Google** |
| 7 | Android minSdk 23 → 26, plus NFC/Bluetooth/location permissions | Build config change | **Us** |
| 8 | ZA trainers can't use it | Feature-gate by country | **Us** |

Blocker 1 is the schedule. Blocker 3 is the engineering unknown.

---

## 5. What Karl personally has to do

In order.

1. **Check the Apple Developer account is an "Organization" account**, not Individual, and that you are the Account Holder. Apple will not grant the entitlement otherwise.
2. **Request the development entitlement** at [developer.apple.com](https://developer.apple.com/documentation/proximityreader/setting-up-the-entitlement-for-tap-to-pay-on-iphone). Usually approved in 1–2 business days.
3. **Later, request the distribution entitlement.** This is the slow one — expect 1–2 weeks, sometimes longer. Apple asks for a video of the payment flow, so this can only happen after we have something working.
4. **In the Stripe Dashboard, confirm Terminal is enabled** on the PupManager platform account, and accept Apple's Acceptance Platform terms as a platform.
5. **Decide the packaging** — does Tap to Pay ride on the existing `pos` add-on, or is it its own paid add-on?
6. **Accept there is a store submission.** Unlike everything else we ship, this cannot go live with a web deploy. It lands only in a new app build.
7. **Tell trainers what device they need**: iPhone XS or newer on a current iOS, or an Android 13+ phone with NFC and the Play Store.

Do 1 and 2 now. They cost nothing and they start the clock on the slow part.

---

## 6. What we build, in order

| # | Piece | What it is | Size |
|---|---|---|---|
| 1 | `POST /api/terminal/connection-token` | Calls `terminal.connection_tokens.create` with the trainer's `stripeAccount`. The SDK asks for this itself. | **S** — half a day |
| 2 | Terminal **Location** per trainer | Create one on the connected account (business name + address), store `terminalLocationId` on `TrainerProfile`. Needed at connect time. | **S** — one small schema field |
| 3 | `POST /api/terminal/onboarding-link` | Terminal Onboarding Link, `link_type: apple_terms_and_conditions`, `on_behalf_of: <trainer account>`. Trainer clicks it once, ever. Add a row to Settings → Payments. | **S** |
| 4 | `POST /api/terminal/payment-intent` | Reuse `createPaymentRecord()` from `connect-checkout.ts`, then create a PaymentIntent on the connected account: `payment_method_types: ['card_present']`, `capture_method: 'manual'`, our `application_fee_amount`, `metadata.paymentId`. | **M** |
| 5 | `POST /api/terminal/capture` | Capture the authorised intent. Must happen within 2 days or the auth expires. | **S** |
| 6 | Native plugin | Install `@capacitor-community/stripe-terminal` (v8, Capacitor 8, Tap to Pay is a first-class option). Add the Apple entitlement, the Info.plist keys, bump Android minSdk, patch the Android bridge. | **L** — the risky one |
| 7 | UI | A third row in the sale composer's "How are they paying?" step: **"Tap their card on this phone"** — shown only on native, on a supported platform, in a supported country, with the add-on on. Then a full-screen tap prompt. | **M** |
| 8 | Fulfilment | **Nothing.** The existing `payment_intent.succeeded` webhook already resolves by `metadata.paymentId`. | **–** |
| 9 | Tests | Unit tests for the five routes incl. tenant + ownership guards. Native flow can't be e2e'd — cover it at the API boundary. | **M** |

Rough order of the whole thing, if Apple behaves: **3–5 weeks of build**, plus **2–4 weeks waiting on Apple**, plus store review. Call it **6–8 weeks to a trainer actually tapping a card**, and iOS first.

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

1. **Whether Stripe restricts Tap to Pay by connected-account type** (Express vs Standard vs Custom). Every Connect + Terminal doc I read describes direct charges and never names an account-type restriction — but it never affirmatively says Express is fine either. **We are on Express.** Confirm with Stripe support before committing.
2. **Whether `application_fee_amount` can be set when the PaymentIntent is created for a card-present direct charge**, or whether it must be adjusted before manual capture. Stripe's collect-payment doc says to *"inspect each PaymentIntent and modify the application fee, if needed, before manually capturing"*, which hints at the latter. Affects step 4 above.
3. **Whether our Apple Developer account is an Organization account** and whether Karl is the Account Holder. Can't see that from the repo.
4. **Whether Xcode Cloud can build with the Tap to Pay entitlement** — the provisioning profile has to carry it. Our iOS builds go through Xcode Cloud off a release branch.
5. **In-person rates for AU / GB / CA / US.** Only NZ was verified against Stripe's rate card. Same shape, different numbers.
6. Whether Stripe's NZ "starting at 2.6%" is volume-tiered.
7. Whether Apple's tap-screen design rules conflict with our flat house style.

---

## 10. What is already built

On branch **`feature/tap-to-pay`**. Server side only. 18 unit tests green, typecheck clean.

| Built | File |
|---|---|
| Core Terminal library | `src/lib/terminal.ts` |
| Shared gate for all four routes | `src/app/api/terminal/_guard.ts` |
| Connection token | `src/app/api/terminal/connection-token/route.ts` |
| Apple terms link | `src/app/api/terminal/onboarding-link/route.ts` |
| PaymentIntent (card_present) | `src/app/api/terminal/payment-intent/route.ts` |
| Capture | `src/app/api/terminal/capture/route.ts` |
| Eligibility (drives the UI) | `src/app/api/terminal/eligibility/route.ts` |
| `terminalLocationId` + migration | `prisma/schema.prisma` |
| Tests | `tests/unit/security/terminal-tap-to-pay-routes.test.ts` |

**Not built, and deliberately so:** the native Capacitor plugin and the sale-composer UI. Both are blocked on things outside the code — Apple's entitlement, and the Capacitor Android bridge bug. Writing them now would mean writing them blind.

The server half is inert until the native half exists. It charges nobody and changes no existing behaviour.

---

## 11. Recommendation

1. Karl does steps 1 and 2 of section 5 **this week** — free, and it starts the Apple clock.
2. Ask Stripe support the Express-account question (section 9.1) before any code.
3. Build iOS only. Ship Android as a phase two, once the bridge patch is proven.
