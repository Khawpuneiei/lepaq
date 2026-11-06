# Architecture

How one meeting gets from an uploaded recording to an approved report, with
the file that does each step. Everything here was read from the code on
`main`. Anything marked **not verified** could not be confirmed from the code
alone.

The default transcription backend is the GPU jobs backend
(`TRANSCRIBE_BACKEND=jobs`, `lib/ai/transcribe.ts`). The per-part backend
(`whisperlah`) is described briefly at the end.

## 1. One meeting, end to end

| # | Step | File | Meeting status after |
|---|---|---|---|
| 1 | Create the meeting, get a signed upload URL | `app/api/meetings/route.ts` | `uploaded` |
| 2 | Browser compresses and uploads the audio | `components/meeting/new-meeting-wizard.tsx`, `lib/audio/compress-client.ts` | `uploaded` |
| 3 | Start one GPU transcription job | `app/api/meetings/[id]/process/route.ts` → `lib/asr/jobs.ts` `processWithJob` | `transcribing` |
| 4 | GPU service reports back (signed callback) | `app/api/transcription/callback/route.ts` → `applyJobReport` | `transcribing` |
| 5 | Save transcript, propose speakers (Claude call A) | `lib/pipeline/finishTranscription.ts`, `lib/ai/mapSpeakers.ts` | `awaiting_speakers` |
| 6 | Rep confirms who is who, analysis runs (Claude call B) | `app/api/meetings/[id]/analyze/route.ts` → `lib/pipeline/runAnalysis.ts` | `analyzing`, then `review` |
| 7 | Rep edits and approves | `app/api/meetings/[id]/approve/route.ts` | `ready` |
| 8 | Optional public share link | `app/api/meetings/[id]/share/route.ts`, `app/s/[token]/page.tsx` | `ready` |

Any step can end in `failed` with a readable `error` and a Retry button.

### 1. Create (`POST /api/meetings`)
The body is checked with zod. `consent_confirmed` must be the literal `true`,
and there must be at least one participant. The route inserts the `meetings`
row and its `meeting_participants`, then asks Supabase Storage for a signed
upload URL at `{user_id}/{meeting_id}.{ext}`. The audio never passes through
the route, because Vercel refuses request bodies over about 4.5 MB.

### 2. Upload (browser)
The wizard re-encodes the file to mono 16 kHz MP3 with ffmpeg.wasm
(`lib/audio/compress-client.ts`) and PUTs it with `uploadToSignedUrl`. If
ffmpeg cannot load or the result is no smaller, `compressAudio` returns
the original file and that is uploaded instead.

### 3. Process (`POST /api/meetings/[id]/process`)
`processWithJob` in `lib/asr/jobs.ts` decides between three cases:
1. a job is already open and younger than 2 hours: return `{queued:true}`;
2. the latest job is `done` and still holds its transcript: reuse it, with no
   GPU and no audio needed. Moving `completed_at` acts as a lease so two
   Retries cannot both take it;
3. otherwise sign a 6-hour download URL for the audio, insert a
   `transcription_jobs` row and POST `{job_id, audio_url, callback_url, ...}`
   to `{WHISPERLAH_URL}/jobs` (`startTranscriptionJob`).

The partial unique index `transcription_jobs_one_open_idx`
(`supabase/migrations/0005_transcription_jobs.sql`) means a meeting can only
have one queued or running job, whatever the code does.

### 4. Callback (`POST /api/transcription/callback`)
No user session. The only credential is `X-Lepaq-Signature`, an HMAC-SHA256
of `"{timestamp}.{raw body}"` with `CALLBACK_SECRET`. `verifyCallbackSignature`
checks it in constant time and refuses timestamps more than 300 s off,
before the body is parsed. `applyJobReport` then claims the job with a
conditional update (`status in ('queued','running')`), so a repeated callback
or a callback racing the status poll does the work only once. A report for a
job that a Retry has replaced is ignored (`isLatestJob`).

### 5. Transcript and speaker proposal
`finishTranscription` (shared by both backends):
- writes `transcript_segments` in batches of 500, with `idx` assigned once so
  evidence citations stay stable;
- writes voice embeddings to `speaker_embeddings` (pgvector);
- asks Claude to map raw diarization labels to named participants
  (`mapSpeakers`, call A) and stores the proposals in `speaker_mappings`;
- deletes the audio from Storage if the profile's
  `delete_audio_after_processing` is on;
- sets the meeting to `awaiting_speakers`.

### 6. Confirm speakers and analyse (`POST /api/meetings/[id]/analyze`)
The rep's choices are saved as confirmed `speaker_mappings`, every transcript
line is rewritten to the participant's name, and `runAnalysis` runs:
- talk time is computed in code (`lib/talkRatio.ts`), not by the model;
- already-approved facts are passed in so the model does not repeat them;
- `analyzeMeeting` (`lib/ai/analyze.ts`, call B) returns the report;
- the report is upserted into `meeting_reports` with `approved_at = null`;
  unapproved `action_items` and `person_facts` are replaced, approved ones are
  kept; `participant_reads` are replaced;
- the meeting moves to `review`.

Afterwards the route clears the stored transcript copy on
`transcription_jobs.result` and `transcription_chunks.segments`.
`POST /regenerate` (`app/api/meetings/[id]/regenerate/route.ts`) re-runs
`runAnalysis` on the same transcript, for example after the rep strikes a line
(`transcript_segments.excluded`).

### 7. Approve (`POST /api/meetings/[id]/approve`)
One request carries the edited summary and email plus the ids of ticked
action items and facts. It sets `approved_at`, approves exactly what was
ticked (and un-approves the rest), optionally applies the suggested company
status, and sets the meeting to `ready`. This route uses the user's own
Supabase client, so RLS applies to every write.

### 8. Share
`POST /share` only works on a `ready` meeting and stores a random 32-hex
`share_token`. `app/s/[token]/page.tsx` runs with the service role but selects
named columns only (`summary, key_takeaways, decisions, approved_at` and
approved action items), and returns 404 unless `approved_at` is set.
`DELETE /share` nulls the token, which revokes the link.

## 2. Auth and row-level security

- **Session.** Supabase Auth cookies. `proxy.ts` (Next 16's name for
  middleware) refreshes the session on every request and redirects signed-out
  visitors to `/login`, except for public prefixes: `/login`, `/auth`, `/s/`,
  `/demo`, the transcription callback and `/api/cron/`.
- **Routes do not trust the proxy.** Every `/api/meetings/[id]/*` route calls
  `requireUser` and `requireOwnedMeeting` (`lib/api.ts`), which looks the
  meeting up with `owner_id = user.id`.
- **RLS.** Every table has RLS on. Tables with `owner_id` use `own_rows`
  (`owner_id = auth.uid()`); tables under a meeting use `via_meeting`, which
  checks the parent meeting's owner (`0001_init.sql`). `transcription_jobs`
  is select-only for users, with writes revoked (`0005`). Storage policies
  key off the first folder of the object path being the user's id.
- **Service role.** `lib/supabase/admin.ts` bypasses RLS. Its header comment
  limits it to the pipeline, the share page and the seed script, and the
  pipeline routes check ownership before using it. `import "server-only"`
  makes a client-side import a build error.
- **Dev sign-in.** `app/api/dev/login/route.ts` mints a real session for
  `OWNER_EMAIL`, but only when `NODE_ENV !== "production"` and
  `DEV_AUTH_BYPASS === "true"`. `next build` sets `NODE_ENV=production`.

## 3. Where Claude is called, and how its output is checked

Both calls go through `structuredCall` in `lib/ai/respond.ts`:
- streamed request with a JSON Schema output format and a cached system
  prompt (`lib/ai/prompts.ts`);
- the text is parsed as JSON and validated with zod (`lib/ai/schema.ts`), then
  `clampAnalysis` enforces list lengths the JSON Schema cannot;
- on refusal, `max_tokens`, empty text, invalid JSON, failed validation, rate
  limit, 5xx or a dropped stream, it retries once on `LLM_FALLBACK_MODEL`
  (default `claude-sonnet-5-5` after `claude-haiku-5-5`). A 400 is not
  retried. The model that answered is stored in `meeting_reports.model`;
- `sanitiseAnalysis` (`lib/ai/analyze.ts`) then drops evidence indexes that are
  not in the transcript, loose due dates, statuses the user has not defined,
  people who were not in the meeting, and fact categories that are malformed
  or sensitive (`normaliseFactCategory`, backed by a check constraint in
  `0003`).

| Call | Where | Output |
|---|---|---|
| A, speaker mapping | `lib/ai/mapSpeakers.ts`, from `finishTranscription` | label → participant, confidence, reason |
| B, meeting analysis | `lib/ai/analyze.ts`, from `runAnalysis` | summary, decisions, action items, people reads, facts, coach notes, email draft |

## 4. Failure handling

- Each pipeline route catches errors, sets the meeting to `failed` with
  `friendlyError(err)` (`lib/api.ts`), and returns JSON. The UI shows Retry.
- **Lost callback.** `GET /status` (polled by the open page) calls
  `reconcileMeeting`: once a job has been quiet for 2 minutes it asks
  `GET {WHISPERLAH_URL}/jobs/{id}`; after 2 hours it fails the job
  ("Transcription took more than two hours").
- **Late result.** If a job we timed out locally reports `done` later,
  `applyJobReport` revives the meeting and carries on.
- **Interrupted save.** If a job is `done` but the meeting is still
  `transcribing` 6 minutes later, the meeting is failed, and Retry resumes from
  the stored transcript without the GPU.
- The callback returns 5xx on internal errors so the service retries
  (1, 4, 16 s, per the route comment; the service side is **not verified**
  here).

## 5. The cron route

`vercel.json` schedules `GET /api/cron/transcription-jobs` daily at 03:00 UTC.
The route (`app/api/cron/transcription-jobs/route.ts`) requires
`Authorization: Bearer $CRON_SECRET`, loads up to 100 meetings still at
`transcribing`, oldest first, and runs `reconcileMeeting` on each within a
150 s budget. It covers meetings whose tab was closed, since `/status` only
runs while a page is open.

## 6. The per-part backend

With `TRANSCRIBE_BACKEND=whisperlah`, `/process` downloads the audio, splits
it with ffmpeg (`lib/audio/chunk.ts`), and transcribes parts concurrently
(`lib/concurrency.ts`, default 3 at a time) against `WHISPERLAH_URL`. Each
part's result is stored on its `transcription_chunks` row. If the function
nears its 300 s limit it returns `{complete:false}` and the client calls again,
skipping parts already `done`. Labels are namespaced per part (`c0_A`), and the
speaker review step merges them. It then calls the same `finishTranscription`.
