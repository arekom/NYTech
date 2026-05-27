# Future Self Studio

A single-purpose web app that runs at the Space of Mind booth on an iPad.
One attendee at a time records a 30–120 second message to themselves; the
app emails it back to them 10 days later.

It is not a demo. It is the product experience.

---

## Flow

1. **Welcome** — sets the frame.
2. **Intake** — first name, email, one priming field.
3. **Prompt** — the single question, large and centered.
4. **Recording** — live waveform + counting-up timer, one take, 30s minimum.
5. **Processing** — 45-second theatrical pause while the real upload happens.
6. **Confirmation** — shows the delivery date; the brand line closes the loop.

Done button wipes session state and returns to Screen 1.

---

## Stack

| Layer       | Choice                                    |
|-------------|-------------------------------------------|
| Frontend    | Next.js 15 (App Router) + React 19, vanilla CSS |
| Audio       | `MediaRecorder` API, Web Audio `AnalyserNode` for waveform |
| Audio storage | Vercel Blob                             |
| Database    | Vercel Postgres / Neon (`postgres` driver) |
| Email       | Resend                                    |
| Scheduling  | Vercel Cron — daily at 14:00 UTC          |

---

## Setup

### 1. Install
```powershell
npm install
```

### 2. Provision services

- **Vercel Blob** — in the Vercel dashboard, create a Blob store and copy the read/write token.
- **Postgres** — Vercel Postgres or Neon; copy the connection URL.
- **Resend** — create an API key, verify the sending domain, set the `From` address.

### 3. Configure env

Copy `.env.example` to `.env.local` and fill in:

```
POSTGRES_URL=...
BLOB_READ_WRITE_TOKEN=...
RESEND_API_KEY=...
RESEND_FROM="Space of Mind <studio@spaceofmind.app>"
CRON_SECRET=...long-random-string...
DELIVERY_DELAY_DAYS=10
EVENT_NAME="NY Tech Week"
NEXT_PUBLIC_APP_URL=https://your-deployment.vercel.app
```

### 4. Initialize the database
```powershell
npm run db:init
```
Creates the `sessions` table and the `deliver_at` index.

### 5. Run locally
```powershell
npm run dev
```
Visit `http://localhost:3000` in Safari/Chrome. The browser will request
microphone permission on Screen 4.

### 6. Deploy
```powershell
vercel deploy
```
Set the same env vars in the Vercel project. `vercel.json` registers the
daily cron at the project root.

---

## Booth setup

- **Device**: iPad Pro 12.9" in Safari, full-screen via "Add to Home Screen" → tap the icon.
- **Mic**: external USB-C condenser (Blue Yeti Nano or equivalent).
- **Network**: hotspot or venue Wi-Fi. The app gracefully degrades — if the
  upload fails, the recording is held in `localStorage` and surfaces a
  "Saved locally — will sync" status. (Reconnect handling is best-effort
  for the booth; a staff member should verify uploads at end of day.)
- **Privacy screen**: physical flanking shields on the iPad. One staff
  member present at all times — to receive the moment, not to explain it.
- **Kiosk lock**: enable iOS Guided Access (triple-press the side button)
  to prevent attendees from leaving Safari.

---

## How delivery works

- On upload, a row is written to `sessions` with `deliver_at = now() + DELIVERY_DELAY_DAYS`.
- A Vercel Cron job at `/api/cron/deliver` runs daily at 14:00 UTC.
- For each row where `deliver_at <= now()` and `delivered_at is null`:
  1. Send the email via Resend with an inline `<audio>` player and download link.
  2. Mark `delivered_at`.
  3. Delete the audio blob from Vercel Blob storage.
  4. Clear `audio_url` from the row.
- Result: no recording persists past delivery + ~24h.

To change the cron cadence, edit `vercel.json`. To send manually for testing:
```powershell
curl -H "Authorization: Bearer $env:CRON_SECRET" https://your-deployment.vercel.app/api/cron/deliver
```

---

## Design notes

The brief calls for **"recording studio meets lab report. Not wellness. Not journaling. Precision."** The design system in `app/globals.css` enforces this:

- Single tone palette: near-black background, off-white type. One accent color (signal red) used only for the live REC dot.
- Type pairing: serif (Times) for the questions/headlines, monospace (SF Mono) for technical labels, sans for body.
- Buttons are **lines with arrows**, not blocks. Hairline rules separate sections. No rounded corners, no shadows, no gradients.
- Waveform is an oscilloscope-style time-domain trace, not a generic VU bar — drawn on a high-DPI canvas with tick marks and a baseline.
- The 45-second processing pause is non-negotiable. The progress bar fills regardless of real upload time. "Preparing delivery to your future self" — not "uploading."

---

## What this app deliberately does not do

- No "Submit" / "Save" / "Upload" language anywhere user-facing.
- No spinners or generic loading states.
- No more than 6 screens.
- No re-record, no pause, no playback before send. One take.
- No tracking, no analytics. The only persistence is the session row, which is destroyed (audio) / retained (metadata) after delivery.

---

## File map

```
app/
  page.tsx                   - top-level state machine
  layout.tsx                 - HTML shell, viewport lock
  globals.css                - brand system
  api/
    upload/route.ts          - POST recording, write to Blob + Postgres
    cron/deliver/route.ts    - daily cron: send + delete
components/
  Waveform.tsx               - oscilloscope canvas
  screens/
    Welcome.tsx
    Intake.tsx
    Prompt.tsx
    Recording.tsx
    Processing.tsx
    Confirmation.tsx
lib/
  db.ts                      - postgres client
  email.ts                   - Resend + email template
scripts/
  init-db.ts                 - schema bootstrap
vercel.json                  - cron registration
```
