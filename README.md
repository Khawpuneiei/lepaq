# Rapport — Meeting Intelligence CRM

Upload a meeting recording, get back a report you can send, follow-ups you
actually keep, and a relationship record for everyone in the room.

Built from `MVP_BUILD_SPEC.md`. Everything the AI produces is a **private
draft** until the user approves it — that stance shapes the data model and the
UI, and it is not decoration.

---

## Quick start

```bash
npm install
cp .env.example .env.local   # then fill it in, see below
npm run dev
```

The app will not do anything useful until Supabase is set up.

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Open the SQL editor and run `supabase/migrations/0001_init.sql` in full.
   It creates every table, all row level security policies, the private
   `meeting-audio` storage bucket with its policies, and the trigger that
   gives each new user the default status lists.
   It is safe to re-run.
3. Copy Project Settings → API into `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` — server only, never `NEXT_PUBLIC`

### 2. OpenAI

Add `OPENAI_API_KEY`. The model ids live in env vars so a rename is a
dashboard edit rather than a deploy:

| Variable | Default | Notes |
|---|---|---|
| `OPENAI_TRANSCRIBE_MODEL` | `gpt-4o-transcribe-diarize` | The diarizing variant. Plain `gpt-4o-transcribe` returns no speaker labels. |
| `OPENAI_LLM_MODEL` | `gpt-5.6-luna` | Swap to a larger tier if reports read thin. |
| `OPENAI_REASONING_EFFORT` | `medium` | Set to `none` if you point `OPENAI_LLM_MODEL` at a non-reasoning model, which would otherwise reject the `reasoning` parameter. |

**Check the model ids against the current OpenAI docs before your first run.**
They came from the spec and were not verified against a live account here.
The SDK types in `node_modules/openai` do confirm the shape of the diarize
call: `response_format: "diarized_json"`, `chunking_strategy: "auto"`
(required above 30 seconds), and no `prompt` support.

### 3. Signing in during development

If the owner account has no password set, or you would rather not type one
thirty times a day, put this in `.env.local`:

```
DEV_AUTH_BYPASS=true
OWNER_EMAIL=you@example.com
```

The login page then offers **Sign in without a password**, which mints a real
Supabase session through the admin API and writes the normal session cookie.
RLS, the proxy guard and every route behave exactly as they do for a real
user — it is a shortcut past typing a password, not past authentication.

It cannot reach production. The route, the button and the proxy exemption all
require `NODE_ENV !== "production"`, which `next build` sets. Verified against
a production build with `DEV_AUTH_BYPASS=true` still set: the button is absent
from the page, an anonymous request is bounced to `/login`, and an
*authenticated* request — where the proxy does let it through — gets a 404
from the route itself.

### 4. Demo data

```bash
npm run seed
```

Creates `sarah@rapport.demo` / `rapport-demo-123` with 8 companies, 14 people,
5 meetings, 9 follow-ups and the saved facts the demo script leans on. One
meeting is deliberately left in `review` so the dashboard inbox is not empty.

---

## How a meeting flows through the system

```
browser                          server                        storage / OpenAI
───────                          ──────                        ────────────────
POST /api/meetings ───────────►  create rows, sign upload URL
upload file ──────────────────────────────────────────────►    Supabase Storage
POST .../process ─────────────►  download, split if needed ──► gpt-4o-transcribe-diarize
                                 stitch, propose speakers ───► gpt-5.6-luna (call A)
                   ◄───────────  status: awaiting_speakers
user confirms speakers
POST .../analyze ─────────────►  rewrite labels, analyse ────► gpt-5.6-luna (call B)
                   ◄───────────  status: review
user approves ────────────────►  status: ready
```

States: `uploaded → transcribing → awaiting_speakers → analyzing → review →
ready`, plus `failed` with an error message and a Retry button.

`review` means AI output exists but nobody has approved it. Anything
unapproved wears a **Draft** badge.

---

## Long recordings

The spec capped uploads at 25MB and put chunking on the roadmap. This build
does the chunking, so the cap is the Supabase object limit (50MB) instead.

Two different ceilings drive the decision, and conflating them is how this
goes wrong:

- **Size** — OpenAI refuses audio over 25MB per request. Re-encoding to mono
  16kHz 48kbps MP3 costs about 6KB/s, so an hour of speech is roughly 21MB.
  Compression alone rescues most real meetings.
- **Time** — a Vercel function dies at 300s. A single 90-minute transcription
  request can outlive that even though the file would have fitted. So audio
  past 25 minutes is split and the parts run concurrently.

**Before any of that, the browser shrinks the file.** A 90-minute recording
off a phone is 120-130MB and the Supabase free tier refuses a storage object
over 50MB, so `lib/audio/compress-client.ts` re-encodes it to mono 16kHz
48kbps MP3 with ffmpeg.wasm before it is uploaded. Measured on the real
61-minute test recording: **86.3MB down to 21.0MB, 76% smaller**, about 60
seconds of encoding plus a one-off 32MB core download on first use. That is
the same encode that already produced 1022 diarized segments and a clean
analysis, so nothing is lost by it.

The core is served from `/public/ffmpeg` (copied out of node_modules by
postinstall, gitignored) rather than a CDN, and the single-threaded build is
used deliberately so no COOP/COEP headers are needed. If it cannot load for
any reason, the original file is uploaded instead and the old size limit
applies — compression is an optimisation, never a gate.

Server-side, `lib/audio/chunk.ts` then picks one of three paths:

1. short and small — send the original bytes, ffmpeg never runs;
2. oversized but under 25 minutes — one re-encoded MP3, still one request;
3. longer — split into parts (default 10 min), transcribed 3 at a time.

**Speaker labels are per-request.** Chunk 2's "Speaker A" is not chunk 1's
"Speaker A". Rather than matching voices acoustically, labels are namespaced
(`c0_A`, `c1_B`) and the existing speaker-mapping step reconciles them across
parts — reusing the Speaker Review screen as the safety net instead of
inventing a fragile new one. Several labels collapsing onto one participant is
the normal result.

**Resumability.** Each part's transcript is stored on its
`transcription_chunks` row as it lands. If the function runs out of time,
`/process` returns `{complete: false}` and the client calls it again; the next
invocation skips the parts already done. That is what makes a 90-minute
recording finish without a queue or a background worker.

```bash
npm run check:audio   # verifies all three paths against generated audio
```

---

## Privacy decisions worth knowing before you change anything

These are load-bearing, not preferences (spec section 9):

- **There is no team view.** Not hidden — absent.
- **Audio is deleted after processing by default.** Everything downstream
  works from the transcript, so the recording is dead weight the moment it is
  transcribed.
- **The coach has no sharing path in the code at all.** No scores, no grades,
  no trends. The moment it looks like a performance metric a manager could
  ask for, the product stops being adopted.
- **`app/s/[token]/page.tsx` names its fields explicitly and never uses
  `select("*")`.** It is the only public page and it runs with the service
  role, so adding a column to `meeting_reports` must not silently start
  publishing it.
- **Sensitive categories are excluded in the prompt** (health, religion,
  politics, ethnicity, sexuality, finances, family problems) and facts stay
  unapproved until a human ticks them.

PDPA: this app stores personal data about third parties. Get proper legal
advice before putting real customer data in it. This is not legal advice.

---

## Deploying

1. **GitHub** — push the repo. `.env*` is gitignored; `.env.example` is not.
2. **Vercel** — import the repo, add every variable from `.env.example` for
   Production and Preview, deploy.
3. **Fluid Compute** — Project → Settings → Functions. Required for
   `maxDuration = 300` to be honoured on Hobby. Without it the long-audio
   path will keep needing resume rounds.
4. **Supabase URL config** — Authentication → URL Configuration. Set Site URL
   to your deployed domain and add `https://<your-domain>/**` to Redirect
   URLs, or login redirects break in production. Update `NEXT_PUBLIC_APP_URL`
   to match, since the share dialog builds links from it.

**Function size.** `ffmpeg-static` is around 78MB on Linux. `next.config.ts`
traces only the linux/x64 ffprobe binary to keep the rest out. It fits inside
the 250MB uncompressed limit, but if you add heavy dependencies later this is
the first thing that will push you over.

Hobby is for non-commercial use. Fine for demos and user interviews.

---

## Project layout

```
app/
  (app)/          dashboard, meetings, people, companies, follow-ups, settings
  (auth)/login
  api/meetings/   create, process, analyze, approve, share, audio, regenerate
  s/[token]/      the only public page
components/
  layout/ dashboard/ meeting/ people/ shared/ ui/
lib/
  ai/             transcribe, mapSpeakers, analyze, prompts, schema, respond
  audio/chunk.ts  the long-audio splitter
  pipeline/       runAnalysis, shared by analyze and regenerate
  supabase/       client (browser), server (RSC), admin (service role)
supabase/migrations/0001_init.sql
scripts/          seed.ts, check-audio.ts
proxy.ts          auth guard — Next 16 renamed middleware to proxy
```

Companies, people, statuses, facts and action items are plain Supabase CRUD
under RLS from the browser. They have no API route on purpose.

---

## Commands

```bash
npm run dev           # dev server
npm run build         # production build
npm run typecheck     # tsc --noEmit
npm run lint
npm run seed          # demo data
npm run check:audio   # long-audio splitter smoke test
```

---

## Where this build departs from the spec

| Spec | Here | Why |
|---|---|---|
| Upload capped at 25MB, chunking on the roadmap | Capped at the 50MB Supabase limit, split server-side | Requested as part of this build |
| `middleware.ts` | `proxy.ts` | Next.js 16 renamed it; same file position and behaviour |
| State machine `transcribing → analyzing` | Added `awaiting_speakers` between them | Spec 5.2 puts a mandatory human gate there. Leaving the row in `transcribing` while it waits on a person makes the dashboard lie about what is running |
| Speaker label stored on `meeting_participants` | Added `speaker_mappings` and `transcript_segments.raw_speaker_label` | One participant now maps to many raw labels, one per part. An array column would not have supported re-mapping without re-transcribing |
| Analysis schema defined once in zod | zod for validation, hand-written JSON Schema for the API | Strict structured output requires `additionalProperties: false` and every property in `required`, and ignores `maxItems`. Caps are enforced in `clampAnalysis` instead |
| Handover brief, optionally one LLM call | Template over existing data only | The spec marked the LLM call optional; the template needs no key and cannot invent a commitment |
| Tailwind config file | Tailwind v4 CSS-first tokens in `app/globals.css` | v4 is what `create-next-app` ships now |

One thing worth flagging: the spec's own note that "Text2Speech: GPT-4o
Transcribe" should be speech-to-text is correct, and no text-to-speech exists
anywhere in this build.
