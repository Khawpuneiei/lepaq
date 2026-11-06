-- ===========================================================================
-- Guest accounts: one meeting each, and moving a guest into a Google account
--
-- Run after 0005. Safe to re-run.
--
-- A guest is a Supabase anonymous user: a real account with no email. Each
-- meeting it processes costs GPU time and Claude calls, and anyone can make
-- a guest, so a guest gets one meeting with a few tries at each paid step.
--
-- The counts live here, written only by the server, because a guest can
-- change its own meetings and transcripts through row level security:
-- deleting a meeting and making it again, or setting its status back, must
-- not buy another transcription. For the same reason there is no
-- foreign key to meetings. The primary key makes the claim atomic: two
-- meetings processed at the same moment cannot both win.
--
-- Nobody but the service role touches this table or calls these functions:
-- row level security is on with no policy, and execute is revoked below.
-- ===========================================================================

create table if not exists guest_meetings (
  user_id uuid primary key references auth.users on delete cascade,
  meeting_id uuid not null,
  -- /process calls that started GPU work or reused a stored transcript
  transcriptions int not null default 0,
  -- /analyze and /regenerate calls, each one Claude report
  analyses int not null default 0,
  created_at timestamptz not null default now()
);

alter table guest_meetings add column if not exists transcriptions int not null default 0;
alter table guest_meetings add column if not exists analyses int not null default 0;

alter table guest_meetings enable row level security;

-- ---------------------------------------------------------------------------
-- rapport_guest_charge: claim the guest's one meeting and, for a paid step,
-- count it. Answers 'ok', 'other_meeting' (the guest's one meeting is a
-- different one) or 'used_up' (this step has been tried as often as its
-- limit allows).
--
-- p_kind is one of
--   'claim'              count nothing
--   'transcribe'         one /process call that starts GPU work or reuses a
--                        stored transcript. Also refused once the reports are
--                        used up: Retry on a meeting whose last report failed
--                        starts here, and a new transcript would be no use.
--   'analyze'            one Claude report from /analyze or /regenerate
--   'refund_transcribe'  give back a 'transcribe' that spent nothing, because
--                        the GPU service turned the job down or another
--                        request had already started it
--
-- An earlier draft took one limit; that version is dropped first.
-- ---------------------------------------------------------------------------
drop function if exists public.rapport_guest_charge(uuid, uuid, text, int);

create or replace function public.rapport_guest_charge(
  p_user uuid,
  p_meeting uuid,
  p_kind text,
  p_transcribe_limit int,
  p_analyze_limit int
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  claim public.guest_meetings%rowtype;
begin
  if p_kind not in ('claim', 'transcribe', 'analyze', 'refund_transcribe') then
    raise exception 'rapport_guest_charge: unknown kind %', p_kind;
  end if;

  insert into public.guest_meetings (user_id, meeting_id)
  values (p_user, p_meeting)
  on conflict (user_id) do nothing;

  -- the row lock makes two simultaneous charges count one after the other
  select * into claim from public.guest_meetings where user_id = p_user for update;

  if claim.meeting_id <> p_meeting then
    return 'other_meeting';
  end if;

  if p_kind = 'transcribe' then
    if claim.transcriptions >= p_transcribe_limit or claim.analyses >= p_analyze_limit then
      return 'used_up';
    end if;
    update public.guest_meetings set transcriptions = transcriptions + 1 where user_id = p_user;
  elsif p_kind = 'analyze' then
    if claim.analyses >= p_analyze_limit then
      return 'used_up';
    end if;
    update public.guest_meetings set analyses = analyses + 1 where user_id = p_user;
  elsif p_kind = 'refund_transcribe' then
    update public.guest_meetings set transcriptions = greatest(transcriptions - 1, 0) where user_id = p_user;
  end if;

  return 'ok';
end $$;

-- ---------------------------------------------------------------------------
-- rapport_adopt_guest: a guest pressed Continue with Google and came back as
-- p_member. If that account is new, or has no meetings, companies or people
-- and no password, everything the guest made becomes the member's and the
-- guest is deleted. Answers 'moved', or 'kept' when nothing was changed
-- because the member already has their own things or a password (or either
-- side is not what it should be).
--
-- The browser proves both sides: it holds the guest's session cookie, and
-- the Google sign-in it finished was one it started (PKCE). That is why this
-- is used instead of Supabase's manual identity linking, which attaches a
-- Google account to whichever user started the link, in any browser.
--
-- Locking both users first also holds back anything that writes a row for
-- the guest meanwhile (a report being saved, say): it waits, and once the
-- guest is gone it fails instead of leaving a row behind for nobody.
-- ---------------------------------------------------------------------------
create or replace function public.rapport_adopt_guest(p_guest uuid, p_member uuid)
returns text
language plpgsql
-- deletes the guest from auth.users and hands over its stored files
security definer
set search_path = ''
as $$
declare
  guest_user auth.users%rowtype;
  member_user auth.users%rowtype;
begin
  if p_guest = p_member then
    return 'kept';
  end if;

  select * into guest_user from auth.users where id = p_guest for update;
  select * into member_user from auth.users where id = p_member for update;

  if guest_user.id is null or member_user.id is null
     or not coalesce(guest_user.is_anonymous, false)
     or coalesce(member_user.is_anonymous, false) then
    return 'kept';
  end if;

  if exists (select 1 from public.meetings where owner_id = p_member)
     or exists (select 1 from public.companies where owner_id = p_member)
     or exists (select 1 from public.people where owner_id = p_member) then
    return 'kept';
  end if;

  -- A password account can be made by anyone who types the email, before its
  -- owner ever signs in with Google, and with Confirm email off Supabase then
  -- links the Google sign-in to it. Moving a guest in would hand the guest's
  -- meetings to whoever chose that password.
  if coalesce(member_user.encrypted_password, '') <> ''
     or exists (select 1 from auth.identities where user_id = p_member and provider = 'email') then
    return 'kept';
  end if;

  -- The member's statuses and interest columns stay as they are. A guest
  -- status with the same kind and label as one of the member's is folded
  -- into it; one the guest's companies and people still use follows the
  -- member's own, in the guest's order; the rest (starter statuses the
  -- member renamed or removed, say) go.
  update public.companies c
  set status_id = pair.member_status
  from (
    select distinct on (g.id) g.id as guest_status, m.id as member_status
    from public.status_options g
    join public.status_options m
      on m.owner_id = p_member and m.applies_to = g.applies_to
     and lower(trim(m.label)) = lower(trim(g.label))
    where g.owner_id = p_guest
    order by g.id, m.sort_order, m.id
  ) pair
  where c.owner_id = p_guest and c.status_id = pair.guest_status;

  update public.people p
  set status_id = pair.member_status
  from (
    select distinct on (g.id) g.id as guest_status, m.id as member_status
    from public.status_options g
    join public.status_options m
      on m.owner_id = p_member and m.applies_to = g.applies_to
     and lower(trim(m.label)) = lower(trim(g.label))
    where g.owner_id = p_guest
    order by g.id, m.sort_order, m.id
  ) pair
  where p.owner_id = p_guest and p.status_id = pair.guest_status;

  delete from public.status_options g
  where g.owner_id = p_guest
    and (exists (select 1 from public.status_options m
                 where m.owner_id = p_member and m.applies_to = g.applies_to
                   and lower(trim(m.label)) = lower(trim(g.label)))
         or not (exists (select 1 from public.companies c where c.status_id = g.id)
                 or exists (select 1 from public.people p where p.status_id = g.id)));

  update public.status_options g
  set owner_id = p_member,
      sort_order = g.sort_order + coalesce(
        (select max(m.sort_order) + 1 from public.status_options m
         where m.owner_id = p_member and m.applies_to = g.applies_to), 0)
  where g.owner_id = p_guest;

  -- Interest columns are keyed per owner; the member's column wins a key
  -- both have, and the facts filed under it show there. Of the rest, only
  -- a column that shows one of the guest's facts comes along.
  delete from public.interest_columns g
  where g.owner_id = p_guest
    and (exists (select 1 from public.interest_columns m
                 where m.owner_id = p_member and m.key = g.key)
         or not exists (select 1 from public.person_facts f
                        where f.owner_id = p_guest
                          and (f.category = g.key or f.category = any (g.categories))));

  update public.interest_columns g
  set owner_id = p_member,
      sort_order = g.sort_order + coalesce(
        (select max(m.sort_order) + 1 from public.interest_columns m
         where m.owner_id = p_member), 0)
  where g.owner_id = p_guest;

  update public.companies set owner_id = p_member where owner_id = p_guest;
  update public.people set owner_id = p_member where owner_id = p_guest;
  update public.meetings set owner_id = p_member where owner_id = p_guest;
  update public.action_items set owner_id = p_member where owner_id = p_guest;
  update public.person_facts set owner_id = p_member where owner_id = p_guest;

  -- The member's own name and title stay; a blank one takes the guest's.
  -- Recordings are kept if either side asked to keep them: the guest's
  -- recordings arrive under the member's setting, and a fresh account still
  -- has the default (delete), which would otherwise throw away audio the
  -- guest chose to keep.
  update public.profiles m
  set full_name = coalesce(nullif(trim(m.full_name), ''), nullif(trim(g.full_name), '')),
      job_title = coalesce(nullif(trim(m.job_title), ''), nullif(trim(g.job_title), '')),
      delete_audio_after_processing = m.delete_audio_after_processing and g.delete_audio_after_processing
  from public.profiles g
  where m.id = p_member and g.id = p_guest;

  -- Recordings stay where they are (the server reads them with the service
  -- role); only their owner changes, since Supabase will not delete a user
  -- who still owns a stored file. Both owner columns, where they exist.
  if exists (select 1 from information_schema.columns
             where table_schema = 'storage' and table_name = 'objects' and column_name = 'owner_id') then
    execute 'update storage.objects set owner_id = $1 where owner_id = $2'
      using p_member::text, p_guest::text;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'storage' and table_name = 'objects' and column_name = 'owner') then
    execute 'update storage.objects set owner = $1 where owner = $2'
      using p_member, p_guest;
  end if;

  -- takes the guest's profile, its guest_meetings row and its sessions with it
  delete from auth.users where id = p_guest;
  return 'moved';
end $$;

revoke all on function public.rapport_guest_charge(uuid, uuid, text, int, int) from public, anon, authenticated;
revoke all on function public.rapport_adopt_guest(uuid, uuid) from public, anon, authenticated;
grant execute on function public.rapport_guest_charge(uuid, uuid, text, int, int) to service_role;
grant execute on function public.rapport_adopt_guest(uuid, uuid) to service_role;
