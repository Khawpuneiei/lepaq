-- ===========================================================================
-- Lepaq — one transcription job per recording
--
-- Run after 0004. Safe to re-run.
--
-- With TRANSCRIBE_BACKEND=jobs the whole recording goes to the GPU service in
-- one request instead of 10-minute parts: /process creates a job and returns,
-- the service calls /api/transcription/callback when it is done, and
-- /status (plus a daily cron) asks the service about jobs that went quiet.
-- One request for the whole file also means speaker A is the same person
-- from the first minute to the last.
--
-- `id` is generated here and doubles as the service's idempotency key. A
-- Retry from the app makes a new row, so one meeting can have several; the
-- newest is the one that counts, and at most one is ever open.
--
-- `result` keeps the service's transcript until the meeting is analysed, so
-- a Retry after speaker mapping or analysis failed starts from it instead of
-- sending the recording to the GPU again.
--
-- Only the server writes here (service role). Signed-in users can read
-- their own meetings' jobs and nothing more.
-- ===========================================================================

create table if not exists transcription_jobs (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings on delete cascade,
  status text not null default 'queued'
    check (status in ('queued','running','done','failed')),
  model_version text,
  error text,
  created_at timestamptz not null default now(),
  -- last time we heard from the service, by callback or by asking
  checked_at timestamptz not null default now(),
  completed_at timestamptz,
  result jsonb
);

-- for a database that ran an earlier version of this file
alter table transcription_jobs add column if not exists result jsonb;

create index if not exists transcription_jobs_meeting_idx
  on transcription_jobs (meeting_id, created_at desc);
create index if not exists transcription_jobs_open_idx
  on transcription_jobs (status) where status in ('queued','running');

-- One open job per meeting, so a double-clicked Retry cannot pay for two.
-- Any duplicates left by an earlier version lose to the newest first.
update transcription_jobs j
   set status = 'failed', error = 'Replaced by a newer job.', completed_at = now()
 where j.status in ('queued','running')
   and exists (select 1 from transcription_jobs n
               where n.meeting_id = j.meeting_id
                 and n.status in ('queued','running')
                 and n.created_at > j.created_at);
create unique index if not exists transcription_jobs_one_open_idx
  on transcription_jobs (meeting_id) where status in ('queued','running');

alter table transcription_jobs enable row level security;

-- Read-only for users: a row they could insert or edit would hold the open
-- slot for their meeting, or sit in the cron's queue, or pretend to be done.
drop policy if exists via_meeting on transcription_jobs;
drop policy if exists via_meeting_read on transcription_jobs;
create policy via_meeting_read on transcription_jobs for select using (
  exists (select 1 from meetings m
          where m.id = transcription_jobs.meeting_id and m.owner_id = auth.uid()));
revoke insert, update, delete on transcription_jobs from anon, authenticated;
