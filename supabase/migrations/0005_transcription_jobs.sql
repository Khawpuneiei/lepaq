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
-- newest is the one that counts.
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
  completed_at timestamptz
);

create index if not exists transcription_jobs_meeting_idx
  on transcription_jobs (meeting_id, created_at desc);
create index if not exists transcription_jobs_open_idx
  on transcription_jobs (status) where status in ('queued','running');

alter table transcription_jobs enable row level security;

drop policy if exists via_meeting on transcription_jobs;
create policy via_meeting on transcription_jobs for all using (
  exists (select 1 from meetings m
          where m.id = transcription_jobs.meeting_id and m.owner_id = auth.uid()))
with check (
  exists (select 1 from meetings m
          where m.id = transcription_jobs.meeting_id and m.owner_id = auth.uid()));
