-- ===========================================================================
-- Rapport — the Table of Interest becomes the user's own table
--
-- Run after 0002. Safe to re-run.
--
-- Until now the columns were hard-coded and person_facts.category was a fixed
-- enum, which meant the model could only ever report the four things we
-- thought of in advance. If a client spent ten minutes on their football team,
-- that landed in Notes and stayed there.
--
-- After this: the user owns their columns, and the model may propose a new one
-- when a meeting turns up something that does not fit. A proposal is only ever
-- a suggestion — nothing appears as a column until the user adds it, which is
-- the same approve-before-use rule the rest of the app runs on.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The columns themselves
--
-- `key` is the stable identifier and matches person_facts.category.
-- `categories` is what the column displays, which can be more than one key:
-- "Favourite food" shows what they like AND what they avoid, because "no
-- spicy food" is as useful as "loves laksa" when you are booking lunch.
-- ---------------------------------------------------------------------------
create table if not exists interest_columns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users on delete cascade,
  key text not null,
  label text not null,
  icon text not null default 'sparkles',
  categories text[] not null default '{}',
  sort_order int not null default 0,
  is_default boolean not null default false,
  created_at timestamptz default now(),
  unique (owner_id, key)
);

create index if not exists interest_columns_owner_idx
  on interest_columns (owner_id, sort_order);

alter table interest_columns enable row level security;

drop policy if exists own_rows on interest_columns;
create policy own_rows on interest_columns for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 2. person_facts.category becomes open
--
-- The enum is replaced by a format check. The model can now return 'sport' or
-- 'travel'; what it cannot do is return free prose as a category, or anything
-- long enough to break a table header.
--
-- The sensitive-category exclusions (health, religion, politics, ethnicity,
-- sexuality, finances, family problems) are NOT relaxed by this. They live in
-- the system prompt and in sanitiseAnalysis, and a blocklist below backs them
-- up, because an open vocabulary is exactly where that rule could quietly
-- erode.
-- ---------------------------------------------------------------------------
alter table person_facts drop constraint if exists person_facts_category_check;

alter table person_facts add constraint person_facts_category_check
  check (
    category ~ '^[a-z][a-z0-9_]{0,38}$'
    and category not in (
      'health','medical','illness','religion','religious','politics',
      'political','ethnicity','race','sexuality','sexual_orientation',
      'finances','financial','salary','income','family_problems','divorce'
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Seed the four defaults for everybody who already exists
-- ---------------------------------------------------------------------------
insert into interest_columns (owner_id, key, label, icon, categories, sort_order, is_default)
select u.id, d.key, d.label, d.icon, d.categories, d.sort_order, true
  from auth.users u
 cross join (values
   ('food',  'Favourite food',  'utensils',     array['food_like','food_dislike'], 1),
   ('movie', 'Favourite film',  'clapperboard', array['movie'],                    2),
   ('hobby', 'Hobby',           'palette',      array['hobby'],                    3),
   ('drink', 'Favourite drink', 'coffee',       array['drink'],                    4)
 ) as d(key, label, icon, categories, sort_order)
on conflict (owner_id, key) do nothing;

-- ---------------------------------------------------------------------------
-- 4. And for everybody who signs up from now on
-- ---------------------------------------------------------------------------
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

  insert into public.interest_columns (owner_id, key, label, icon, categories, sort_order, is_default)
  values
    (new.id, 'food',  'Favourite food',  'utensils',     array['food_like','food_dislike'], 1, true),
    (new.id, 'movie', 'Favourite film',  'clapperboard', array['movie'],                    2, true),
    (new.id, 'hobby', 'Hobby',           'palette',      array['hobby'],                    3, true),
    (new.id, 'drink', 'Favourite drink', 'coffee',       array['drink'],                    4, true)
  on conflict (owner_id, key) do nothing;

  return new;
end $$;
