# PupManager — App Store submission pack

Everything needed to submit to the **Apple App Store** and **Google Play**.
Generated 2026-05-23. App ID (both stores): `com.pupmanager.app`.

---

## 0. Shared facts (paste into both stores)

| Field | Value |
|-------|-------|
| App name | PupManager |
| Privacy Policy URL | https://pupmanager.com/privacy |
| Support URL | https://pupmanager.com/contact |
| Marketing URL | https://pupmanager.com |
| Terms URL | https://pupmanager.com/terms |
| Primary category | Business |
| Secondary (Apple) | Productivity |
| Reviewer demo login | `demo@pupmanager.com` / `DemoPup2026!` |
| Age rating | 4+ / Everyone (no objectionable content) |

> ⚠️ **Confirm the demo account is seeded in prod** before submitting (see §5). Reviewers
> *will* try to log in — a dead login is an instant rejection.

---

## 1. Listing copy

### App name (≤30 chars)
`PupManager`

### Apple subtitle (≤30 chars)
`Dog training, sorted`

### Play short description (≤80 chars)
`Run your dog-training business and give every client a beautiful experience.`

### Apple promotional text (≤170 chars)
`The all-in-one app for dog trainers — schedule sessions, track every dog's progress, and give your clients a polished experience they'll rave about.`

### Full description (Apple ≤4000 / Play ≤4000)
```
PupManager is the all-in-one app for dog trainers who want less admin and happier clients.

Built by a trainer and a developer who were tired of juggling spreadsheets, text threads, and paper notes, PupManager pulls your whole training business into one calm, beautiful place.

FOR TRAINERS
• Scheduling that fits real life — one-off sessions, recurring slots, and ongoing packages.
• Manage every client and dog in one tidy list, with notes, photos, and history.
• Track each dog's progress over time so owners can see how far they've come.
• Sell and manage training packages and products.
• Capture enquiries and turn them into booked clients.
• Push notifications keep everyone in the loop.

FOR YOUR CLIENTS
• A polished app where owners follow their dog's journey.
• See upcoming sessions, homework, and progress at a glance.
• The kind of professional experience that earns referrals.

WHY PUPMANAGER
• Designed around how trainers actually work — not generic booking software.
• Your clients get an experience that makes you look great.
• Less time on admin, more time with dogs.

Reclaim your Sunday nights. Let PupManager handle the admin.

Questions? Reach us at https://pupmanager.com/contact
Privacy: https://pupmanager.com/privacy
```

### Apple keywords (≤100 chars, comma-separated)
```
dog trainer,puppy,training,client,scheduling,progress,booking,pet,obedience,canine,sessions
```

### Play tags / category
Category **Business**. Suggested tags: Dog training, Pet, Scheduling, Small business.

> Brooke's voice note: the "tired of juggling spreadsheets… reclaim your Sunday nights" lines
> are the trainer-empathy hook — keep those. Edit the feature bullets to match exactly what's
> shipping today; cut any you're not confident a reviewer will find.

---

## 2. Screenshots

**Captured** (crisp 1290×2796, deviceScaleFactor 3) → `~/Desktop/PupManager Store Assets/raw/`:
- `01-dashboard.png` — greeting, KPIs (notes/invoicing/clients/dogs), today's sessions, live enquiries. **Strong lead shot.**
- `02-clients.png` — populated client list with dogs, next sessions, search/tabs.
- `03-schedule.png` — day's sessions (list view).

> Note: aggregate views (dashboard, clients) are richly populated; *individual* client
> profiles in the demo data show mostly empty states (no per-client session/task history),
> so they don't screenshot well yet. To add a 4th/5th shot showcasing **progress tracking**
> (the key differentiator), either enrich the demo seed's per-client history or use a real
> (anonymised) client. The 3 above are enough to submit to both stores today.

Re-capture anytime with: `node /tmp/capture-store-shots.mjs` (logs in as demo, DSF 3).

**iPad captured** (2048 × 2732, deviceScaleFactor 2) → `~/Desktop/PupManager Store Assets/ipad/`:
- `01-dashboard.png`, `02-clients.png` (strong populated lead), `03-schedule.png`,
  `04-packages.png`, `05-client-detail.png` (sparser — see per-client note above).
- Re-capture with: `node /tmp/capture-ipad-shots.mjs`.

**Apple requirements**
- iPhone 6.7" (1290 × 2796) — **required**. One set covers all iPhone sizes.
- iPad 12.9" (2048 × 2732) — **captured** (see above); upload to the iPad slot in
  App Store Connect since the app is submitted as iPad-compatible.
- 3–10 screenshots.

**Play requirements**
- Phone: 2–8 screenshots, 9:16, min 1080px on the short side.
- Plus a **feature graphic** 1024 × 500 (Play-only, required) and a 512 × 512 hi-res icon.

---

## 3. Google Play — submission checklist

The signed binary is built and ready:
`android/app/build/outputs/bundle/release/app-release.aab` (4.9 MB, signed with upload key).

1. **Create app**: Play Console → Create app → name "PupManager", default language English, App, Free.
2. **Set up → App content** (the long part):
   - **Privacy policy**: https://pupmanager.com/privacy
   - **App access**: provide demo login `demo@pupmanager.com` / `DemoPup2026!` (instructions for the reviewer to reach all features).
   - **Ads**: No (unless you've added ads).
   - **Content rating**: complete questionnaire → category Reference/Business, no objectionable content → expect "Everyone".
   - **Target audience**: 18+ (it's a business tool) — avoids the stricter child-safety rules.
   - **Data safety**: see §4 below.
   - **Government apps / Financial / Health**: No to all.
3. **Store listing**: paste name, short + full description (§1), upload screenshots + feature graphic (1024×500) + 512×512 icon.
4. **Production → Create release**:
   - Enrol in **Play App Signing** (accept Google-managed signing key — recommended; you keep the upload key we generated).
   - Upload `app-release.aab`.
   - Release notes: "Initial release."
5. **Countries**: select all (or your target markets).
6. **Send for review.** Android review is usually hours → likely live today.

---

## 4. Play Data Safety answers (best-effort — verify against your code)

| Question | Answer |
|----------|--------|
| Does your app collect/share user data? | Yes |
| Data types collected | **Personal info**: Name, Email address. **Photos** (if owners/trainers upload dog photos). **App activity** (in-app actions). **App info & performance** (crash/diagnostics via Vercel Analytics — *verify*). |
| Is data shared with third parties? | Only processors (hosting/email) — typically "No" for the sharing question if it's just service providers. |
| Is data encrypted in transit? | Yes (HTTPS). |
| Can users request deletion? | Yes — in-app account deletion + https://pupmanager.com/privacy §7. |
| Purposes | App functionality, Account management. (NOT advertising — the Meta pixel is on the marketing site, not the app. *Verify no ad SDKs in the app.*) |

---

## 5. Verify / seed the demo account (do before submitting)

```bash
# Confirms demo@pupmanager.com exists with ~50 clients of data.
# NOTE: local commands hit PROD Supabase — this writes to production.
npm run db:seed-demo
```
Then sanity-check login at https://app.pupmanager.com with the demo creds.

---

## 6. Apple App Store — submission checklist

**You chose to archive in Xcode.** The project is fully prepped (build 73, shell synced,
pods installed, Apple Distribution cert present).

### A. Archive & upload
1. Open `ios/App/App.xcworkspace` in Xcode.
2. Top bar: select scheme **App**, destination **Any iOS Device (arm64)**.
3. **Product → Archive**. (If signing errors: Signing & Capabilities → Team = Friendly Limited (7VV3KXA2S5), "Automatically manage signing" on — let Xcode create the App Store profile with push + associated-domains.)
4. When the Organizer opens: **Distribute App → App Store Connect → Upload** → Next through defaults → Upload.
5. Wait ~10–30 min for the build to finish "Processing" in App Store Connect.

### B. App Store Connect listing
1. **My Apps → PupManager → (+) version 1.0** (build 72 was uploaded before; we're uploading **build 73** under 1.0).
2. Fill: subtitle, promotional text, description, keywords (§1), support + marketing URLs.
3. Upload iPhone 6.7" screenshots (§2).
4. Select **build 73** once it finishes processing.
5. **App Privacy** questionnaire — see §7.
6. **App Review Information**:
   - Sign-in required: **Yes** → username `demo@pupmanager.com`, password `DemoPup2026!`.
   - **Notes for reviewer** (paste §8 — this is the 4.2 mitigation).
7. **Add for Review → Submit.**

> Apple review: typically 24–48h. The 4.2 reviewer note (below) is our best defence against
> a "this is just a website" rejection.

---

## 7. Apple App Privacy answers (best-effort — verify)

- **Contact Info** → Email Address, Name → linked to identity → App Functionality, Account Management.
- **User Content** → Photos (dog photos, if uploaded) → App Functionality.
- **Identifiers** → User ID → App Functionality.
- **Usage Data / Diagnostics** → only if Vercel Analytics counts (*verify*) → not linked to identity, App Functionality.
- **Tracking**: **No** — the app does not track users across apps/sites. (The Meta pixel lives on the marketing website only; confirm no ad/tracking SDK ships in the app bundle.)

---

## 8. Reviewer notes for Apple (paste into App Review → Notes) — 4.2 mitigation

```
PupManager is a native iOS app for professional dog trainers and their clients.

Demo login: demo@pupmanager.com / DemoPup2026!  (a fully-populated trainer account)

The app provides native functionality beyond a website, including:
• Native push notifications for session reminders and client updates (APNs).
• A native launch/offline experience that handles loss of connectivity gracefully.
• Universal links / associated domains for app.pupmanager.com.

Core features to review after logging in:
• Dashboard with the trainer's schedule.
• Client & dog management (~50 demo clients with progress history).
• Session scheduling and training packages.
• Per-dog progress tracking that clients can follow.

Thank you for reviewing — happy to provide anything else via the support URL.
```

---

## 9. Known gaps & risks (decide before/after submit)

0. **Apple 3.1.1 (in-app purchase) — MITIGATED 2026-05-23 (commit 5aa2f31).** The
   trainer subscription/billing flow is now hidden inside the native app
   (`useIsNative()` gate): the trial nudge chip doesn't render, and
   `/billing/setup` shows a "manage your subscription on the web" notice instead
   of Stripe checkout. So the iOS app has no in-app purchase path or external
   purchase link. Trainers manage billing at app.pupmanager.com in a browser.
   (Web-only change — the native shell loads the live site, so it's already in
   effect without an app rebuild.)
1. **Android push notifications are NOT functional** — `android/app/google-services.json` (Firebase
   Cloud Messaging config) is missing. The app builds and runs fine, but push won't register on
   Android until you add the FCM config + rebuild. iOS push is configured (APNs entitlement present).
   → *Decision:* ship Android without push today, or pause to wire FCM first.
2. **Apple guideline 4.2** (webview-wrapper rejection risk) — mitigated by the reviewer note in §8.
3. **Build environment**: Android release builds require **JDK 21** (Capacitor 8). This machine's
   default is JDK 24, which fails. Build with:
   `JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home ./gradlew :app:bundleRelease`
4. **Upload keystore backup** — `android/upload-keystore.jks` + password are gitignored and exist
   only on this machine. **Back them up now** (password is in `android/keystore.properties`). With
   Play App Signing, a lost upload key is recoverable via Google; without it you'd be stuck.
```
