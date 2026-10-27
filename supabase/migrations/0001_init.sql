-- ===========================================================================
-- Rapport — initial schema
-- Run once in the Supabase SQL editor (or: supabase db push).
-- Safe to re-run: every object is created if-not-exists and every policy is
-- dropped before it is recreated.
-- ===========================================================================

create extension if not exists "pgcrypto";

-- ---------- profiles ----------
create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text,
  job_title text,
  -- privacy default from spec 7.9: audio is thrown away once it is transcribed
  delete_audio_after_processing boolean not null default true,
  created_at timestamptz default now()
);

-- ---------- customisable statuses ----------
create table if not exists status_options (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users on delete cascade,
  applies_to text not null check (applies_to in ('company','person')),
  label text not null,
  color text not null default '#64748B',
  sort_order int not null default 0,
  is_won boolean default false
);
create index if not exists status_options_owner_idx
  on status_options (owner_id, applies_to, sort_order);

-- ---------- companies and people ----------
create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users on delete cascade,
  name text not null,
  kind text not null default 'prospect'
    check (kind in ('prospect','client','partner','internal')),
  status_id uuid references status_options on delete set null,
  deal_value numeric,
  notes text,
  created_at timestamptz default now()
);
create index if not exists companies_owner_idx on companies (owner_id, name);

create table if not exists people (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users on delete cascade,
  company_id uuid references companies on delete set null,
  full_name text not null,
  position text,
  email text,
  status_id uuid references status_options on delete set null,
  created_at timestamptz default now()
);
create index if not exists people_owner_idx on people (owner_id, full_name);
create index if not exists people_company_idx on people (company_id);

-- ---------- meetings ----------
create table if not exists meetings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users on delete cascade,
  company_id uuid references companies on delete set null,
  title text not null,
  short_note text,
  meeting_date date default current_date,
  audio_path text,
  audio_bytes bigint,
  audio_mime text,
  audio_deleted_at timestamptz,
  duration_sec int,
  -- 'awaiting_speakers' is not in the spec state machine, which jumps from
  -- transcribing straight to analyzing. But spec 5.2 puts a mandatory human
  -- gate between the two, and leaving the row in 'transcribing' while it sits
  -- waiting for a person makes the dashboard lie about what is running.
  status text not null default 'uploaded'
    check (status in ('uploaded','transcribing','awaiting_speakers',
                      'analyzing','review','ready','failed')),
  -- free-text progress note shown under the spinner, e.g. "Transcribing part 3 of 7"
  progress_note text,
  error text,
  consent_confirmed boolean not null default false,
  share_token text unique,            -- null = private
  created_at timestamptz default now()
);
create index if not exists meetings_owner_idx on meetings (owner_id, meeting_date desc);
create index if not exists meetings_status_idx on meetings (owner_id, status);
create index if not exists meetings_company_idx on meetings (company_id);

create table if not exists meeting_participants (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings on delete cascade,
  person_id uuid references people on delete set null,
  display_name text not null,
  position text,
  is_me boolean default false,
  -- canonical label written onto the transcript once mapping is confirmed
  speaker_label text,
  mapping_confidence numeric
);
create index if not exists meeting_participants_meeting_idx
  on meeting_participants (meeting_id);

-- ---------------------------------------------------------------------------
-- Long audio is transcribed in chunks, and diarization labels are only unique
-- *within one request*. Chunk 2's "A" is not chunk 1's "A". So segments keep
-- the model's raw label forever (raw_speaker_label, namespaced c0_A / c1_B for
-- chunked runs) and speaker_label holds the canonical label chosen during
-- Speaker Review. That lets the user re-map later without re-transcribing.
-- ---------------------------------------------------------------------------
create table if not exists transcript_segments (
  id bigint generated always as identity primary key,
  meeting_id uuid not null references meetings on delete cascade,
  idx int not null,
  chunk_index int not null default 0,
  raw_speaker_label text not null,
  speaker_label text not null,
  start_sec numeric,
  end_sec numeric,
  text text not null,
  -- spec 9 barrier 3: the user may strike a candid line and regenerate without it
  excluded boolean not null default false
);
create index if not exists transcript_segments_meeting_idx
  on transcript_segments (meeting_id, idx);
create index if not exists transcript_fts on transcript_segments
  using gin (to_tsvector('english', text));

-- one row per raw diarization label; many raw labels may map to one participant
create table if not exists speaker_mappings (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings on delete cascade,
  raw_speaker_label text not null,
  participant_id uuid references meeting_participants on delete set null,
  confidence numeric,
  reason text,
  sample_quotes jsonb default '[]',
  segment_count int default 0,
  confirmed boolean not null default false,
  unique (meeting_id, raw_speaker_label)
);

-- Per-chunk transcription state for the per-part backend, so a run that hits
-- the 300s function ceiling resumes instead of transcribing again the chunks
-- that already succeeded.
--
-- The chunk's own segments are parked here as jsonb rather than written
-- straight to transcript_segments. That buys contiguous idx numbering: the
-- final `idx` values are assigned once, after every chunk has landed and the
-- parts can be ordered, instead of being renumbered afterwards.
create table if not exists transcription_chunks (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings on delete cascade,
  chunk_index int not null,
  start_sec numeric not null,
  end_sec numeric not null,
  status text not null default 'pending'
    check (status in ('pending','running','done','failed')),
  segments jsonb not null default '[]',
  error text,
  updated_at timestamptz default now(),
  unique (meeting_id, chunk_index)
);

-- ---------- AI outputs ----------
create table if not exists meeting_reports (
  meeting_id uuid primary key references meetings on delete cascade,
  summary text,
  key_takeaways jsonb default '[]',   -- [string]
  decisions jsonb default '[]',       -- [{text, evidence_idx}]
  risks jsonb default '[]',           -- [string]
  coach jsonb default '{}',           -- see spec 5.3
  talk_ratio jsonb default '[]',      -- [{name, seconds, share}] computed in code
  follow_up_email text,
  suggested_company_status text,
  suggested_status_reason text,
  model text,
  approved_at timestamptz,
  updated_at timestamptz default now()
);

create table if not exists action_items (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings on delete cascade,
  owner_id uuid not null references auth.users on delete cascade,
  person_id uuid references people on delete set null,
  title text not null,
  assignee_name text,
  due_date date,
  evidence_idx int,
  done boolean default false,
  approved boolean default false,
  created_at timestamptz default now()
);
create index if not exists action_items_owner_idx
  on action_items (owner_id, approved, done, due_date);
create index if not exists action_items_meeting_idx on action_items (meeting_id);

-- emotion read per participant per meeting (from text only)
create table if not exists participant_reads (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings on delete cascade,
  person_id uuid references people on delete cascade,
  display_name text,
  sentiment text check (sentiment in ('positive','neutral','mixed','negative')),
  emotions text[] default '{}',
  engagement int check (engagement between 1 and 5),
  summary text,
  evidence_quote text,
  confidence text check (confidence in ('low','medium','high')),
  created_at timestamptz default now()
);
create index if not exists participant_reads_person_idx
  on participant_reads (person_id, created_at);
create index if not exists participant_reads_meeting_idx
  on participant_reads (meeting_id);

-- durable personal facts: food, hobbies, likes, dislikes, style
create table if not exists person_facts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users on delete cascade,
  person_id uuid not null references people on delete cascade,
  meeting_id uuid references meetings on delete set null,
  category text not null check (category in
    ('food_like','food_dislike','hobby','interest','dislike',
     'communication_style','personal','other')),
  fact text not null,
  evidence_quote text,
  approved boolean default false,     -- only approved facts reach the profile
  created_at timestamptz default now()
);
create index if not exists person_facts_person_idx
  on person_facts (person_id, approved);

-- ---------------------------------------------------------------------------
-- New user bootstrap: profile row + the default status lists from spec 4.
-- Done as a trigger rather than on first login so it cannot be skipped.
-- ---------------------------------------------------------------------------
-- Named with a rapport_ prefix on purpose. `handle_new_user` and
-- `on_auth_user_created` are the names every Supabase tutorial uses, so a
-- project that already hosts another app very likely has its own. A bare
-- `create or replace function public.handle_new_user()` would overwrite that
-- app's signup hook, and `drop trigger if exists on_auth_user_created` would
-- delete its trigger — both silently, with no error to notice.
create or replace function public.rapport_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  company_labels text[] := array['New Lead','Qualified','Proposal','Negotiation','Won','On Hold','Lost'];
  company_colors text[] := array['#64748B','#0EA5E9','#1E3A8A','#E8D48B','#10B981','#94A3B8','#DC2626'];
  person_labels  text[] := array['Champion','Supporter','Neutral','Sceptic','Blocker','Unknown'];
  person_colors  text[] := array['#10B981','#0EA5E9','#64748B','#E8D48B','#F97316','#94A3B8'];
  i int;
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;

  for i in 1 .. array_length(company_labels, 1) loop
    insert into public.status_options (owner_id, applies_to, label, color, sort_order, is_won)
    values (new.id, 'company', company_labels[i], company_colors[i], i, company_labels[i] = 'Won');
  end loop;

  for i in 1 .. array_length(person_labels, 1) loop
    insert into public.status_options (owner_id, applies_to, label, color, sort_order)
    values (new.id, 'person', person_labels[i], person_colors[i], i);
  end loop;

  return new;
end $$;

drop trigger if exists on_auth_user_created_rapport on auth.users;
create trigger on_auth_user_created_rapport
  after insert on auth.users
  for each row execute function public.rapport_handle_new_user();

-- ---------- RLS: owner-only everywhere ----------
alter table profiles              enable row level security;
alter table status_options        enable row level security;
alter table companies             enable row level security;
alter table people                enable row level security;
alter table meetings              enable row level security;
alter table meeting_participants  enable row level security;
alter table transcript_segments   enable row level security;
alter table speaker_mappings      enable row level security;
alter table transcription_chunks  enable row level security;
alter table meeting_reports       enable row level security;
alter table action_items          enable row level security;
alter table participant_reads     enable row level security;
alter table person_facts          enable row level security;

drop policy if exists own_profile on profiles;
create policy own_profile on profiles for all
  using (id = auth.uid()) with check (id = auth.uid());

-- tables that carry owner_id directly
do $$
declare t text;
begin
  foreach t in array array['status_options','companies','people','meetings',
                           'action_items','person_facts'] loop
    execute format('drop policy if exists own_rows on %I;', t);
    execute format(
      'create policy own_rows on %I for all using (owner_id = auth.uid())
       with check (owner_id = auth.uid());', t);
  end loop;
end $$;

-- child tables reached through the parent meeting
do $$
declare t text;
begin
  foreach t in array array['meeting_participants','transcript_segments',
                           'speaker_mappings','transcription_chunks',
                           'meeting_reports','participant_reads'] loop
    execute format('drop policy if exists via_meeting on %I;', t);
    execute format(
      'create policy via_meeting on %I for all using (
         exists (select 1 from meetings m
                 where m.id = %I.meeting_id and m.owner_id = auth.uid()))
       with check (
         exists (select 1 from meetings m
                 where m.id = %I.meeting_id and m.owner_id = auth.uid()));',
      t, t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Storage: private bucket, one folder per user.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('meeting-audio', 'meeting-audio', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;

drop policy if exists "meeting audio read own"   on storage.objects;
drop policy if exists "meeting audio insert own" on storage.objects;
drop policy if exists "meeting audio update own" on storage.objects;
drop policy if exists "meeting audio delete own" on storage.objects;

create policy "meeting audio read own" on storage.objects for select to authenticated
  using (bucket_id = 'meeting-audio'
         and (storage.foldername(name))[1] = auth.uid()::text);

create policy "meeting audio insert own" on storage.objects for insert to authenticated
  with check (bucket_id = 'meeting-audio'
              and (storage.foldername(name))[1] = auth.uid()::text);

create policy "meeting audio update own" on storage.objects for update to authenticated
  using (bucket_id = 'meeting-audio'
         and (storage.foldername(name))[1] = auth.uid()::text);

create policy "meeting audio delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'meeting-audio'
         and (storage.foldername(name))[1] = auth.uid()::text);
