# Google OAuth Verification — PupManager (Google Calendar)

Getting the app **verified** removes the "Google hasn't verified this app" warning.
That warning is what breaks the connect flow on iPad / mobile / in-app browsers
(Google blocks the "Advanced → unsafe" bypass there), so verification is the real
fix for making Google Calendar connect work on mobile — not just polish.

- **Project:** `pupmanager-ccff3` (project number `318725505721`)
- **OAuth client:** `PupManager` — `318725505721-d38ndo6b92gv3uvh4cosqi3n0bvc9rjh.apps.googleusercontent.com`
- **Scopes to verify (both "sensitive", NOT "restricted" → no paid CASA security assessment):**
  - `https://www.googleapis.com/auth/calendar.events`
  - `https://www.googleapis.com/auth/calendar.freebusy`
- **Where to submit:** Google Cloud Console → Google Auth Platform → **Verification Center**

---

## 1. Prerequisites checklist (do these BEFORE submitting)

| Item | Status | Notes |
|------|--------|-------|
| Privacy policy live on your domain | ✅ | `https://pupmanager.com/privacy` (200, mentions Google + calendar + data retention/deletion) |
| Terms of service live | ✅ | `https://pupmanager.com/terms` (200) |
| Consent-screen branding verified | ✅ | Verification Center showed "Your branding has been verified" |
| App home page set | ⬜ | Set to `https://pupmanager.com` on the Branding page |
| **Domain verified in Google Search Console** | ⬜ | `pupmanager.com` must be a verified property under the SAME Google account (DNS TXT). Verification fails without this. |
| **Google Calendar API enabled** on the project | ⬜ | APIs & Services → Library → "Google Calendar API" → Enable. Also required for the scopes to appear in the picker AND for sync to actually write events (else 403 SERVICE_DISABLED). |
| **Both scopes registered** under Data Access | ⬜ | Data Access → Add or remove scopes → add the two calendar scopes (paste manually if they don't appear until the API is enabled) → Save. Until they're registered here, Verification Center says "verification not required". |
| Privacy policy contains a Google "Limited Use" disclosure | ⬜ (verify) | Add/confirm a line stating PupManager's use of Google user data complies with the Google API Services User Data Policy, including Limited Use. Reviewers look for this. |

---

## 2. Scope justifications (paste these into the submission form)

**`.../auth/calendar.events`**
> PupManager is a scheduling tool for dog trainers. When a trainer connects their
> own Google Calendar, we write their PupManager sessions, group classes and
> blocked-out (unavailable) time into that calendar as events, and keep them in
> sync — creating an event when a session is booked, updating it when the session
> is edited, and deleting it when the session is cancelled. This is a one-way sync
> into the trainer's own calendar so their schedule is always current on every
> device. We do not read or modify any events we did not create for this purpose.

**`.../auth/calendar.freebusy`**
> We query the trainer's free/busy information so we can warn them of clashes when
> they schedule a session over a time they are already busy in Google Calendar.
> Only busy time ranges are used (start/end times) — no event titles, attendees or
> details are read for this check. This prevents double-booking against commitments
> that live outside PupManager.

**Data handling summary (if asked):** Data is per-trainer and private to that
trainer — each trainer connects their own Google account, and their calendar data
is only ever shown back to them. Sync is one-way out; the only data read in is
free/busy times for clash warnings. Tokens are stored encrypted at rest and are
revoked when the trainer disconnects.

---

## 3. Demo video script (record in ONE take, ~2–3 min)

Google reviewers must see: (a) the app's real domain, (b) the OAuth consent screen
listing the exact scopes, and (c) each scope actually being used in the product.
Hit all three and the video passes.

**Before recording:**
- Use **desktop Chrome** (clean, reliable). Screen-record at 1080p (QuickTime / Loom).
- Sign into a real or demo **trainer** account that has **a couple of sessions**
  already scheduled, and have that trainer's **Google Calendar** open in a second tab.
- Narrate aloud OR add on-screen captions. English (or subtitled).
- The app should already be verified-pending; if the "unverified" screen still
  shows during recording, that's fine — reviewers expect it pre-verification.

### Shot list

**[0:00–0:15] — Identity & domain**
- Show the browser with the address bar reading **`https://app.pupmanager.com`**.
- Say: *"This is PupManager, a scheduling app for professional dog trainers, at
  app.pupmanager.com. I'll show how it uses the two Google Calendar scopes we're
  requesting."*

**[0:15–0:30] — Start the OAuth flow (shows the client ID)**
- Go to **Schedule → Google Calendar add-on → "Connect Google Calendar"**.
- Let it redirect to **accounts.google.com** and **pause on that screen for ~2s so
  the address bar is visible** — the `client_id=318725505721-d38ndo…` in the URL is
  what ties this video to our OAuth client. Say: *"This begins the OAuth consent
  flow for our client."*

**[0:30–1:00] — The consent screen (shows BOTH scopes)**
- Pick the Google account.
- On the permissions screen, **slowly read each requested permission aloud** so the
  scopes are clearly on screen:
  - *"See and download the availability (free/busy) on your calendars"* → `calendar.freebusy`
  - *"Edit events on your calendars"* → `calendar.events`
- Click **Allow / Continue**. Show it landing back in PupManager, now **Connected**.

**[1:00–1:45] — Demonstrate `calendar.events` (write / update / delete)**
- In PupManager, **create a new session** (or open an existing one) with a client.
- Switch to the **Google Calendar** tab, refresh → **show the PupManager session now
  appears as an event** on the trainer's calendar. Say: *"The session we just booked
  is written into the trainer's Google Calendar using calendar.events."*
- Back in PupManager, **edit the session time** → return to Google Calendar → show
  the event **moved**. Then **cancel the session** in PupManager → show the event is
  **removed** from Google Calendar. Say: *"Edits and cancellations stay in sync."*

**[1:45–2:20] — Demonstrate `calendar.freebusy` (read for clash warning)**
- In Google Calendar, point to an existing personal busy event (e.g. "Dentist").
- In PupManager's Schedule, **try to book a session over that same time** → show the
  **double-booking / clash warning** that appears. Say: *"PupManager reads the
  trainer's free/busy times via calendar.freebusy to warn them when they're about to
  book over something they're already committed to — only the busy time is used, no
  event details."*

**[2:20–2:40] — Wrap-up**
- Say: *"To summarise: calendar.events lets trainers push their PupManager sessions,
  classes and blocked time into their own Google Calendar and keep them in sync;
  calendar.freebusy lets us warn them of clashes. All data is the trainer's own
  calendar, one-way out, and private to them."*

**Upload:** unlisted **YouTube** link (Google requires a shareable video URL). Paste
that link into the verification submission.

---

## 4. After submission

- Google emails the developer contact (**karlfriend.nz@gmail.com**) — watch it and
  reply fast; unanswered questions stall the review for weeks.
- Timeline: typically a few days to ~2–3 weeks for sensitive scopes.
- Until approved: the app works on **desktop** via Advanced → Go to PupManager, but
  **iPad/mobile will keep failing** until the warning is gone. Verification is the fix.
