-- ===========================================================================
-- Lepaq — voice embeddings from the self-hosted transcription stack
--
-- Run after 0003. Safe to re-run.
--
-- With TRANSCRIBE_BACKEND=whisperlah the server returns one voice centroid per
-- speaker label (pyannote community-1's built-in WeSpeaker ResNet34, 256-dim,
-- not fine-tuned). They are kept so the same voice can later be matched across
-- the parts of a split recording and across meetings.
--
-- `model` is stored with every vector because vectors from different
-- embedders live in different spaces: a later swap (ReDimNet2+ is 192-dim)
-- must never be compared against old rows. The column is untyped `vector`
-- for the same reason; `dim` is checked against it.
--
-- A voiceprint is biometric data about the people in the room. Rows are
-- owner-only through the meeting and go when the meeting goes. Nothing reads
-- them yet, and matching a contact by voice needs a consent flow first.
-- ===========================================================================

create extension if not exists vector with schema extensions;

alter table transcription_chunks
  add column if not exists speakers jsonb not null default '{}';

create table if not exists speaker_embeddings (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings on delete cascade,
  raw_speaker_label text not null,
  model text not null,
  dim int not null,
  embedding extensions.vector not null,
  created_at timestamptz default now(),
  unique (meeting_id, raw_speaker_label, model),
  check (extensions.vector_dims(embedding) = dim)
);

create index if not exists speaker_embeddings_meeting_idx
  on speaker_embeddings (meeting_id);

alter table speaker_embeddings enable row level security;

drop policy if exists via_meeting on speaker_embeddings;
create policy via_meeting on speaker_embeddings for all using (
  exists (select 1 from meetings m
          where m.id = speaker_embeddings.meeting_id and m.owner_id = auth.uid()))
with check (
  exists (select 1 from meetings m
          where m.id = speaker_embeddings.meeting_id and m.owner_id = auth.uid()));
