# Lepaq — Meeting Intelligence CRM

*Every coffee chat, remembered.* Private AI memory for B2B relationship
builders.

Upload a meeting recording, get back a report you can send, follow-ups you
actually keep, and a relationship record for everyone in the room.

Built from an internal MVP spec that is not part of this repository; the
"spec 5.3"-style references in comments point to its sections. Everything the
AI produces is a **private draft** until the user approves it — that stance
shapes the data model and the UI, and it is not decoration.

For how a meeting moves through the code, file by file, see
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). The schema is in
[Data model](#data-model).

---

## Live app

Lepaq is deployed at **[lepaq-ai.vercel.app](https://lepaq-ai.vercel.app/)**
(Vercel, deployed from `main`).

---

## Speech recognition: WhisperLah

Lepaq transcribes meetings with **WhisperLah**, our own Singlish speech
recognition model: a LoRA adapter on OpenAI's open `whisper-large-v3-turbo`,
trained on IMDA's National Speech Corpus plus English meeting speech. It runs
as an int8 CTranslate2 model on a GPU service, next to pyannote community-1
for speaker labels (see [Architecture](#architecture)).

- On seven contamination-checked Singlish test sets, it has the lowest word
  error rate of the 18 systems tested (17 other open models and OpenAI API
  settings) on five of them. That includes 14.8% on SASRBench-v1 (next best
  15.8%, OpenAI GPT Transcribe) and 18.0% on NSC two-person conversation
  (next best 25.2%). It is behind A*STAR's MERaLiON-2-3B on the two
  read-speech sets.
- It writes down 76% of Singlish discourse particles (lah, leh, lor …) on NSC
  conversation, against 50% for the next best system.
- The model weights are proprietary and are not published.

Benchmark harness, per-clip results and charts:
[github.com/Khawpuneiei/WhisperLah](https://github.com/Khawpuneiei/WhisperLah).
How it is built, trained, evaluated and served:
[WhisperLah technical report (PDF)](https://github.com/Khawpuneiei/WhisperLah/blob/main/docs/WhisperLah-Technical-Report.pdf).

---

## Architecture

Five parts: the rep's browser, Next.js functions on Vercel, the GPU service
on Modal, Claude, and Supabase. Numbered edges are the user's path through a
meeting; orange marks where the value compounds — the analysis step and the
per-person memory it writes.

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontFamily":"Arial, Helvetica, sans-serif","fontSize":"15px","primaryColor":"#F7F5F1","primaryTextColor":"#1F1E1C","primaryBorderColor":"#DCD5C8","lineColor":"#8A857C","clusterBkg":"#FFFFFF","clusterBorder":"#DCD5C8","edgeLabelBackground":"#FFFFFF","tertiaryColor":"#FFFFFF","titleColor":"#5F5B54"},"flowchart":{"wrappingWidth":320,"nodeSpacing":28,"rankSpacing":90,"curve":"basis","padding":12}}}%%
flowchart LR
    subgraph B["REP'S BROWSER · Next.js client"]
        direction TB
        UP["<b>New-meeting wizard</b><br/>record here or upload a file<br/>participants · PDPA consent"]
        WASM["<b>ffmpeg.wasm</b><br/>mono 16 kHz · 48 kbps<br/>86 MB → 21 MB"]
        REV["<b>Speaker review</b><br/>rep confirms who is who"]
        APP["<b>Report · People · Table of Interest</b><br/>pipeline · follow-ups · handover"]
        UP --> WASM
    end

    subgraph V["VERCEL · Next.js 16 · Node functions"]
        direction TB
        PX["<b>proxy.ts</b> · every request<br/>session refresh · auth guard"]
        CREATE["<b>POST /api/meetings</b><br/>meeting row + signed upload URL"]
        PROC["<b>POST /process</b><br/>signs a 6-hour audio URL<br/>posts one GPU job"]
        CB["<b>POST /transcription/callback</b><br/>signed · status poll as backup<br/>saves transcript → maps speakers"]
        ANA["<b>POST /analyze · /regenerate</b><br/>structured analysis<br/>one profile per person"]
        APR["<b>POST /approve · /share</b><br/>only ticked items go live"]
        SHARE["<b>/s/:token</b><br/>approved summary only"]
    end

    subgraph G["MODAL · GPU service"]
        direction TB
        STT["<b>WhisperLah · pyannote community-1</b><br/>WeSpeaker ResNet34 voice embeddings<br/>whole recording in one job"]
    end

    subgraph A["ANTHROPIC"]
        direction TB
        LLM["<b>Claude Haiku 5.5</b><br/>Sonnet 5.5 fallback · structured JSON"]
    end

    subgraph S["SUPABASE · row-level security on every table"]
        direction TB
        STO[("<b>Storage</b> · private<br/>audio deleted after use")]
        DBM[("<b>Meetings</b><br/>transcripts · speakers · reports<br/>follow-ups · emotion reads")]
        DBP[("<b>Person memory</b><br/>people · companies · facts<br/>interest columns")]
        AUTH["<b>Auth</b>"]
    end

    UP -- "1 · create" --> CREATE
    WASM -- "2 · upload via signed URL" --> STO
    UP -- "3 · process" --> PROC
    REV -- "4 · confirm speakers" --> ANA
    APP -- "5 · approve / share" --> APR

    PROC -- "job · signed audio URL" --> STT
    STT -- "fetch audio" --> STO
    STT -- "transcript" --> CB
    CB -- "call A · speakers" --> LLM
    ANA -- "call B · analysis" --> LLM

    PROC --> DBM
    CB --> DBM
    ANA --> DBM
    ANA -- "facts · profiles" --> DBP
    APR --> DBM
    SHARE -. "named fields only" .-> DBM
    APP -- "CRUD under RLS" --> DBP
    PX -.-> AUTH

    classDef core fill:#F6E6D6,stroke:#E2803B,stroke-width:2px,color:#1F1E1C
    classDef ai fill:#FFFFFF,stroke:#1F1E1C,stroke-width:1.5px,color:#1F1E1C
    class DBP,ANA core
    class STT,LLM ai
```

A static copy is in [`docs/architecture.png`](docs/architecture.png) for
viewers that do not render Mermaid. The step-by-step walk through the code,
with file paths, is [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Regenerate it from the block above (for
example at mermaid.live) when the diagram changes.

---

## Data model

Sixteen tables in `public`, from `supabase/migrations/0001`-`0005`, plus
Supabase's own `auth.users`. Every arrow is a foreign key in the SQL (27 in
all); a ring on the parent side means the column is nullable.

```mermaid
erDiagram
    auth_users ||--o| profiles : "has"
    auth_users ||--o{ status_options : "owns"
    auth_users ||--o{ companies : "owns"
    auth_users ||--o{ people : "owns"
    auth_users ||--o{ meetings : "owns"
    auth_users ||--o{ action_items : "owns"
    auth_users ||--o{ person_facts : "owns"
    auth_users ||--o{ interest_columns : "owns"

    status_options |o--o{ companies : "status of"
    status_options |o--o{ people : "status of"
    companies |o--o{ people : "employs"
    companies |o--o{ meetings : "is met in"

    meetings ||--o{ meeting_participants : "has"
    people |o--o{ meeting_participants : "attends as"
    meetings ||--o{ transcript_segments : "has"
    meetings ||--o{ speaker_mappings : "has"
    meeting_participants |o--o{ speaker_mappings : "is voice"
    meetings ||--o{ transcription_chunks : "split into"
    meetings ||--o{ transcription_jobs : "sent as"
    meetings ||--o{ speaker_embeddings : "has"
    meetings ||--o| meeting_reports : "has"
    meetings ||--o{ action_items : "produces"
    people |o--o{ action_items : "assigned"
    meetings ||--o{ participant_reads : "has"
    people |o--o{ participant_reads : "read of"
    people ||--o{ person_facts : "remembered"
    meetings |o--o{ person_facts : "source of"

    auth_users {
        uuid id PK "managed by Supabase Auth"
    }
    profiles {
        uuid id PK, FK
        text full_name
        boolean delete_audio_after_processing
    }
    status_options {
        uuid id PK
        uuid owner_id FK
        text applies_to "company or person"
        text label
        boolean is_won
    }
    companies {
        uuid id PK
        uuid owner_id FK
        uuid status_id FK
        text name "unique per owner, case-insensitive"
        text kind
        numeric deal_value
    }
    people {
        uuid id PK
        uuid owner_id FK
        uuid company_id FK
        uuid status_id FK
        text full_name "unique per owner and company"
        text email
    }
    meetings {
        uuid id PK
        uuid owner_id FK
        uuid company_id FK
        text title
        text status "uploaded to ready, or failed"
        text audio_path
        boolean consent_confirmed
        text share_token UK
    }
    meeting_participants {
        uuid id PK
        uuid meeting_id FK
        uuid person_id FK
        text display_name
        boolean is_me
        text speaker_label
    }
    transcript_segments {
        bigint id PK
        uuid meeting_id FK
        int idx
        text raw_speaker_label
        text speaker_label
        numeric start_sec
        text text "GIN full-text index"
        boolean excluded
    }
    speaker_mappings {
        uuid id PK
        uuid meeting_id FK "unique with raw label"
        uuid participant_id FK
        text raw_speaker_label
        boolean confirmed
    }
    transcription_chunks {
        uuid id PK
        uuid meeting_id FK "unique with chunk_index"
        int chunk_index
        text status
        jsonb segments
    }
    transcription_jobs {
        uuid id PK
        uuid meeting_id FK "one open job per meeting"
        text status "queued, running, done, failed"
        timestamptz checked_at
        jsonb result
    }
    speaker_embeddings {
        uuid id PK
        uuid meeting_id FK
        text raw_speaker_label
        text model
        int dim
        vector embedding "pgvector"
    }
    meeting_reports {
        uuid meeting_id PK, FK
        text summary
        jsonb coach
        jsonb talk_ratio
        text model
        timestamptz approved_at
    }
    action_items {
        uuid id PK
        uuid meeting_id FK
        uuid owner_id FK
        uuid person_id FK
        text title
        date due_date
        boolean approved
    }
    participant_reads {
        uuid id PK
        uuid meeting_id FK
        uuid person_id FK
        text sentiment
        int engagement "1 to 5"
    }
    person_facts {
        uuid id PK
        uuid owner_id FK
        uuid person_id FK
        uuid meeting_id FK
        text category "open, sensitive ones blocked"
        text fact
        boolean approved
    }
    interest_columns {
        uuid id PK
        uuid owner_id FK "unique with key"
        text key
        text label
        text_array categories
    }
```

Design choices that are in the SQL, not just in the app:

- **Owner-scoped rows under RLS.** Tables with an `owner_id` get an `own_rows` policy (`owner_id = auth.uid()`); meeting children get `via_meeting`, which checks the parent meeting's owner (`0001`, `0004`, `0005`).
- **Jobs are read-only to users.** `transcription_jobs` has a select-only policy and `insert, update, delete` are revoked from `anon` and `authenticated`, so only the service role writes there (`0005`).
- **One open job per meeting.** A partial unique index on `transcription_jobs (meeting_id) where status in ('queued','running')` means a double-clicked Retry cannot start two GPU jobs (`0005`).
- **Raw and canonical speaker labels.** `transcript_segments` keeps the diariser's `raw_speaker_label` next to the confirmed `speaker_label`, and `speaker_mappings` is unique on `(meeting_id, raw_speaker_label)`, so speakers can be re-mapped without re-transcribing (`0001`).
- **Full-text search on transcripts.** A GIN index on `to_tsvector('english', text)` over `transcript_segments` (`0001`).
- **pgvector for voiceprints.** `speaker_embeddings.embedding` is an untyped `vector` with a check that `vector_dims(embedding) = dim`, and `model` is part of the unique key so vectors from different embedders are never mixed (`0004`).
- **No duplicate people or companies.** Unique indexes on `lower(trim(name))` per owner (and per company for people, with `coalesce` so a null company still collides) (`0002`).
- **Sensitive facts blocked in the database too.** `person_facts.category` must match `^[a-z][a-z0-9_]{0,38}$` and is not allowed to be health, religion, politics, ethnicity, sexuality, finances and the like (`0003`).

---

## How a meeting flows through the system

```
browser                          server                        storage / GPU / Claude
───────                          ──────                        ──────────────────────
POST /api/meetings ───────────►  create rows, sign upload URL
upload file ──────────────────────────────────────────────►    Supabase Storage
POST .../process ─────────────►  sign audio URL, post job ───► GPU service on Modal
                   ◄───────────  status: transcribing          (fetches the audio itself)
                                 callback or status poll ◄───  transcript, voice embeddings
                                 propose speakers ───────────► Claude (call A)
GET .../status     ◄───────────  status: awaiting_speakers
user confirms speakers
POST .../analyze ─────────────►  rewrite labels, analyse ────► Claude (call B)
                   ◄───────────  status: review
user approves ────────────────►  status: ready
```

States: `uploaded → transcribing → awaiting_speakers → analyzing → review →
ready`, plus `failed` with an error message and a Retry button.

`review` means AI output exists but nobody has approved it. Anything
unapproved wears a **Draft** badge.

---

## Long recordings

The spec capped uploads at 25MB and put chunking on the roadmap. The cap here
is the Supabase object limit (50MB) instead. The GPU service takes the whole
recording in one job, so length only matters to the browser upload and to the
per-part backend (`TRANSCRIBE_BACKEND=whisperlah`), which splits server-side.

For the per-part backend, two different ceilings drive the decision, and
conflating them is how this goes wrong:

- **Size** — each request stays under 20MB (`CHUNK_TARGET_BYTES`). Re-encoding
  to mono 16kHz 48kbps MP3 costs about 6KB/s, so 20MB holds just under an
  hour of speech, and a recording short enough to go as one request (see
  Time) always fits once re-encoded.
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

Server-side, on the per-part backend, `lib/audio/chunk.ts` then picks one of
three paths:

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

### Self-hosted transcription (test branch)

`TRANSCRIBE_BACKEND=whisperlah` sends the recording part by part to our own
server, `singlish-asr/scripts/serve/server.py`:

| Job | Model |
|---|---|
| Words | WhisperLah v2 (Whisper large-v3-turbo + our Singlish adapter, CTranslate2 int8) |
| Who spoke when | pyannote `speaker-diarization-community-1` |
| Voice embedding | pyannote's built-in WeSpeaker ResNet34, 256-dim, not fine-tuned |

The server returns `{speaker, start, end, text}` segments for each part;
`/process` stores them per part, resumes and stitches them as described above,
and speaker mapping and review work as on the jobs backend. It also returns
one voice embedding per speaker label; those are kept on the chunk row while
it is in flight and then written to `speaker_embeddings` with the model name
(migration `0004`). Nothing reads them yet: they are there to test matching
the same voice across parts and across meetings.

To try it locally: start the server on the GPU machine, apply
`0004_speaker_embeddings.sql`, then in `.env.local`

```
TRANSCRIBE_BACKEND=whisperlah
WHISPERLAH_URL=http://127.0.0.1:8765
WHISPERLAH_MODE=room
```

Vercel cannot reach `127.0.0.1`, so a deployed build needs the server behind
a public URL with `WHISPERLAH_TOKEN` set. The model weights stay on the
serving machine and are never committed.

### Whole-file jobs on the GPU service

`TRANSCRIBE_BACKEND=jobs` is the default and the deployed shape of the same
stack, served from Modal. Three settings, all set in Vercel:

| Variable | What it is |
|---|---|
| `WHISPERLAH_URL` | base URL of the Modal app; `/jobs` and `/jobs/{id}` are appended |
| `WHISPERLAH_TOKEN` | bearer token the service expects on both |
| `CALLBACK_SECRET` | shared secret the service signs its callbacks with |

`/process` no longer downloads or splits anything: it signs a 6-hour URL for
the audio, records a row in `transcription_jobs` (migration `0005`), posts
`{job_id, audio_url, callback_url, mode, num_speakers}` to
`{WHISPERLAH_URL}/jobs`, and returns. The service transcribes the whole
recording in one request, so speaker A is the same person all meeting and the
300 s function limit no longer applies, then POSTs the result to
`/api/transcription/callback`.

- The GPU scales to zero when idle, so the first job after a quiet spell
  waits for one to start. Measured on Modal's L4 with a 17.5-minute meeting:
  229 s from POST to done cold (about 160 s of it starting the GPU), 49 s
  warm. The processing screen and the meeting page say "Waiting for the GPU
  to start" meanwhile, then "Transcribing" once the service reports the job
  running, which it does only once the models are loaded.
- The callback must reach the app over public https. A Vercel preview sends
  its own deployment URL, and Deployment Protection would answer the service
  with a 401 there (which it does not retry). Turn on **Protection Bypass for
  Automation** in the project's Deployment Protection settings and Vercel
  exposes `VERCEL_AUTOMATION_BYPASS_SECRET`, which is then added to the
  callback URL. Without it a preview still works, but each result arrives
  through the status poll, about two minutes late.
- The callback is signed: `X-Lepaq-Signature: v1=<hex HMAC-SHA256(CALLBACK_SECRET, "{timestamp}.{raw body}")>`,
  checked in constant time against the raw body, with at most 300 s of clock
  skew. A repeated callback, or one for a job superseded by a Retry, does nothing.
- If no callback arrives, `/status` (which the processing screen and the
  meeting page poll) asks `GET {WHISPERLAH_URL}/jobs/{id}` after 2 quiet
  minutes, and a daily Vercel cron (`vercel.json`, `CRON_SECRET`) does the
  same for closed tabs. A job still unfinished after two hours fails the
  meeting with a Retry button; if its transcript turns up later anyway, the
  meeting picks it back up.
- The transcript is kept on the job row until the meeting is analysed. A
  Retry after speaker mapping or analysis failed starts from it, without the
  GPU and without the audio. If saving it is cut off part way (a function
  timeout), the meeting fails after 6 minutes and Retry resumes the same way.
- One open job per meeting (a unique index), so a double-clicked Retry cannot
  pay for two. Users can read their jobs but not write them.
- Everything after the transcript (speaker mapping, embeddings, audio
  deletion) is `lib/pipeline/finishTranscription.ts`, shared with the chunked path.

---

## Recording in the browser

**Record** in the top bar opens a new meeting and starts recording in one tap
(`/meetings/new?record=1`). Pause stops capture without ending the session,
so an off-the-record stretch is never in the file. Finish hands the audio to
the same path a picked file takes. `components/meeting/audio-recorder.tsx`
holds it.

- **Format.** Chrome, Edge and Firefox record Opus in WebM; Safari records AAC
  in MP4. Both are asked for 48kbps mono, which is already the compressor's
  target, so a WebM recording skips the browser compression step.
- **Duration.** MediaRecorder writes WebM as a stream and never fills in its
  length. On the per-part backend, `probeDuration` falls back to decoding the
  file when the header says `N/A`, so a long recording is still split instead
  of being sent as one request. `npm run check:audio` covers this case. The
  GPU jobs backend sends the whole file whatever its length.
- **Nothing is uploaded while recording.** The audio lives in the tab until
  Process meeting. A screen wake lock and a leave-page warning keep it from
  being lost by accident, and the rep can save a copy before processing.
  Closing the tab mid-meeting still loses it — the honest limit of a web app.

---

## Landing page

`/` is the public landing page (`app/(landing)/page.tsx`, sections in
`components/landing/`). It is static, reads no session and runs no queries.
The session proxy does not run on it at all: the matcher in `proxy.ts` leaves
out `/` and its prefetch forms, so the page never waits on Supabase. It leaves
out the `/demo` walkthrough the page links to for the same reason, and the
files crawlers fetch (`robots.txt`, `sitemap.xml`, the preview images,
`.well-known/`) so they are not redirected to sign-in. Every app route still
needs a sign-in. "Open Lepaq" goes to `/dashboard`, and the proxy sends a
signed-out visitor through `/login?next=/dashboard`. Signed-in visitors see the
same page; redirecting them from `/` would put Supabase back in front of it.

The page is one scroll story (`components/landing/story.tsx`) that follows a
single sample line from a coffee chat, "Send the proposal by Friday, can?".
A sticky stage holds three scenes (the spoken line, the transcript and report,
the person's page) while four chapters scroll past: Written down, Drafted,
Your call, Remembered. Each chapter names the statuses it covers with the
app's own labels (Transcribing, Check speakers, Analysing, Needs review,
Approved). On desktop the chapters sit in the stage's left column; below
64rem (1024px at the usual text size) the stage pins to the top and the
chapters scroll under it. On short screens below that width (a phone held
sideways, a laptop at 150-200% zoom) the stage scrolls away with the page
instead, since pinned it would leave no room to read. The breakpoints are in
rem, like Tailwind's, so a larger default text size gets the layout that much
text needs: a 1440px window at 200% text is laid out like a 720px one. The
stage drops its least important lines as it gets shorter or narrower, so the
Approve button and the open follow-up stay in view, and on a narrow stage
with large text its titles shrink to fit their card rather than run out of it.

Each step forward plays on the stage: the line settles into the transcript,
the task, the date and the person lift out of it into the draft, approving
stamps the report, and the follow-up files onto Jamie's page. The flights
(`components/landing/motion.ts`) move a copy of each phrase on a short arc
with the Web Animations API while the real one waits, invisible, where it
lands. Scrolling back plays the first and last flights in reverse and fades
the rest. Jumping several chapters at once, from the rail, a link or a reload
on `#chapter-approved`, switches straight to the right state. With reduced
motion on there are no flights, only the state changes.

The stage is an illustration. It is hidden from screen readers, and each
chapter carries a text version of what it shows; "Skip the story" goes to the
benchmark. It is marked `translate="no"`, because a page translator rewriting
the text React swaps there crashes React. It only pins once the story's script
has run, and an error boundary swaps in a plain page of the chapters if that
script fails, so the words never depend on it.

Everything here is local state and saves nothing. Jamie Tan and Harbour Studio
are made up, and the page says so wherever they appear. The sections after the
story rise in once, when scrolled to (`components/landing/reveal.tsx`). What
is already on screen when the page wakes up is never hidden to play that
entrance, and printing shows everything.

**Claims.** The page makes claims about accuracy and privacy. Check every
change to one against the owner's claim review
(`pitch-deck/overclaim-review.md` in the project files; it is not in this
repo) and against the code that backs it:

- The WhisperLah numbers in `components/landing/sections.tsx` are copied from
  the WhisperLah README results table. Update them in the same commit as that
  table, and keep the wording to "every model we tested".
- Name the mode and the precision behind every comparison. Lepaq sends room
  mode (`lib/asr/jobs.ts`), so the page leads with room-mode results.
  SASRBench scores only the person wearing the mic, so its 14.8% is near-mic
  mode, and room mode's 17.1% stands beside it. MERaLiON-2-10B was run in
  4-bit. Café noise and speaker labels are not benchmarked yet, and the page
  says so.
- Production serves an int8 build of WhisperLah v3, within a point of the
  evaluation numbers; `npm run preflight` prints the `model_version` it
  answers with. If the served model changes, check the numbers on the page.
- A privacy promise has to hold in the code: what waits for your approval,
  what a share link shows, where audio is processed (Modal, US East) and
  which model writes the report (Claude).

**Metadata.** The preview image is `app/opengraph-image.png`, with its alt
text in `app/opengraph-image.alt.txt`; `app/robots.ts` and `app/sitemap.ts`
serve the crawler files. Their absolute links, the canonical URL and the
structured data come from `lib/site.ts`: `NEXT_PUBLIC_APP_URL` first, then
Vercel's production domain. Static pages read them at build time, so change
the variable, then redeploy. Shared summaries at `/s/...` are `noindex`, and
unfurl as a plain card: they set their own Open Graph tags, which drops the
landing page's preview image.

**Checking it.** With a build running (`npm run build && npm run start`),
`npm run check:landing` drives a headless Chrome or Edge through the page:
the metadata and crawler files, a shared summary's plain preview card, `/`
and the walkthrough answering without the proxy, the security headers, the
sign-in page's `?next=` cases, every chapter link at seven screen sizes and
at 200% text, the stage keeping its Approve button in view with nothing
printed over it, running out of its card or breaking where a flight lands,
at twenty-six short, narrow or large-text sizes (the desktop ones again with
the classic scrollbars Windows draws), the opening clear of the spoken line
as the first scroll moves it, the closing picture of the app at the same
sizes, the header keeping one row, Back after the page's #links and out of
the walkthrough, a reload at the top staying there, the header's logo going
back to the top, focus outlines and focus scrolling, a simulated page
translator, reduced motion, printing, and the page with JavaScript off or
with the story's script failing. Point it at a deploy with
`npm run check:landing -- --base=https://<domain>`, or run part of it with
`-- --only=tight,back`. The plan behind it, with the finding each check
guards, is `docs/landing-page-plan.md`.

---

## Product walkthrough

`/demo` is a 71-second film of the product, played by the app itself. The
screens are the real components (the new-meeting wizard, speaker review,
meeting detail, Table of Interest, share dialog), rendered with made-up data
from `components/demo/fixtures.ts` on `/demo/frame`, inside an iframe. A
director (`components/demo/player.tsx`) moves a cursor and a camera over
them, following the keyframes in `components/demo/script.ts`. The page is
public and runs no queries.

Because the film is the components, it changes when they do. Cursor and
camera targets are found the way a person would, by visible text or
aria-label (`text=Approve report`, `label=Who is voice B?`), so a renamed
button needs its query updated in `script.ts`. Captions there only describe
what the code does; change them in the same commit as the feature.

To render it to an MP4:

```bash
npm run build && npm run start   # one terminal
npm run demo:record              # another; writes demo-out/lepaq-demo.mp4
```

The recorder steps the film's clock one frame at a time in headless Edge or
Chrome and pipes screenshots to ffmpeg, so the output is a smooth 1080p/30
file however slow the machine. `npm run demo:record -- --stills=13.8,44`
writes PNGs of single moments instead, for checking a change.

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
   Production and Preview, deploy. Leave out the local development block at
   its end (`DEV_AUTH_BYPASS`, `OWNER_EMAIL`, `OWNER_USER_ID`): it is for your
   machine and the scripts, and nothing in production needs it.
3. **Fluid Compute** — Project → Settings → Functions. Required for
   `maxDuration = 300` to be honoured on Hobby. The routes that call Claude
   need the time: the job callback, `/status`, the cron and a Retry through
   `/process` (speaker mapping), and `/analyze` and `/regenerate` (the
   report). Cut short, they leave the meeting part way through. The per-part
   backend's resume loop also leans on it.
4. **Supabase URL config** — Authentication → URL Configuration. Set Site URL
   to your deployed domain and add `https://<your-domain>/**` to Redirect
   URLs, or login redirects break in production. Update `NEXT_PUBLIC_APP_URL`
   to match, since the share dialog builds links from it, and the landing
   page's preview card, canonical URL and sitemap do too. Those are read at
   build time, so redeploy after changing it. Then run
   `npm run check:landing -- --base=https://<your-domain>`.

**Function size.** `ffmpeg-static` is around 78MB on Linux. `next.config.ts`
traces that one binary into the `/process` function; ffprobe is not shipped
at all. It fits inside
the 250MB uncompressed limit, but if you add heavy dependencies later this is
the first thing that will push you over.

Hobby is for non-commercial use. Fine for demos and user interviews.

---

## Project layout

```
app/
  (landing)/      the public landing page at /
  (app)/          dashboard, meetings, people, companies, follow-ups, settings
  (auth)/login
  api/meetings/   create, process, status, analyze, approve, share, audio, regenerate
  api/transcription/callback   where the GPU service reports a finished job
  api/cron/transcription-jobs  daily sweep for jobs whose callback never came
  s/[token]/      a shared meeting summary, public by link
components/
  landing/ layout/ dashboard/ meeting/ people/ shared/ ui/
lib/
  ai/             transcribe, claude, mapSpeakers, analyze, prompts, schema, respond
  asr/jobs.ts     whole-file jobs on the GPU service
  audio/chunk.ts  the long-audio splitter (per-part backend)
  pipeline/       finishTranscription (after any transcript), runAnalysis (analyze, regenerate)
  supabase/       client (browser), server (RSC), admin (service role)
docs/             architecture.png, landing-page-plan.md
supabase/migrations/  0001-0005, run in order
scripts/          preflight, e2e, try-pipeline, seed, check-audio, check-landing
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
npm run preflight     # env, tables, bucket, Claude key and the GPU service, without writing
npm run e2e -- a.m4a  # create, upload, process, analyze, approve, share, public page, against the dev server
npm run check:audio   # long-audio splitter smoke test
npm run demo:record   # render /demo to demo-out/lepaq-demo.mp4 (app must be running)
npm run check:landing # the landing page in a headless browser (app must be running; -- --base=<url>)
npm run check:pages   # every app screen against live data, signed in as OWNER_EMAIL (dev server running)
```

---

## Where this build departs from the spec

| Spec | Here | Why |
|---|---|---|
| Upload capped at 25MB, chunking on the roadmap | Capped at the 50MB Supabase limit; the GPU service takes the whole file, the per-part backend splits it | Requested as part of this build |
| `middleware.ts` | `proxy.ts` | Next.js 16 renamed it; same file position and behaviour |
| State machine `transcribing → analyzing` | Added `awaiting_speakers` between them | Spec 5.2 puts a mandatory human gate there. Leaving the row in `transcribing` while it waits on a person makes the dashboard lie about what is running |
| Speaker label stored on `meeting_participants` | Added `speaker_mappings` and `transcript_segments.raw_speaker_label` | One participant now maps to many raw labels, one per part. An array column would not have supported re-mapping without re-transcribing |
| Analysis schema defined once in zod | zod for validation, hand-written JSON Schema for the API | Structured output requires `additionalProperties: false` on every object and does not support `maxItems`. Caps are enforced in `clampAnalysis` instead |
| Handover brief, optionally one LLM call | Template over existing data only | The spec marked the LLM call optional; the template needs no key and cannot invent a commitment |
| Tailwind config file | Tailwind v4 CSS-first tokens in `app/globals.css` | v4 is what `create-next-app` ships now |

One thing worth flagging: the spec's own note that "Text2Speech: GPT-4o
Transcribe" should be speech-to-text is correct, and no text-to-speech exists
anywhere in this build.
