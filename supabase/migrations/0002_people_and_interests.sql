-- ===========================================================================
-- Rapport — one row per person, and richer facts for the Table of Interest
--
-- Run after 0001_init.sql. Safe to re-run.
--
-- Three things happen here:
--   1. existing duplicate companies and people are MERGED, not deleted
--   2. unique indexes stop the duplicates coming back
--   3. person_facts gains the categories the Table of Interest has columns for
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Merge duplicate companies
--
-- Every meeting that named a company by typing it created a fresh row, so a
-- second meeting with the same client produced a second company. Keep the
-- oldest row of each (owner, name) and repoint everything at it.
-- ---------------------------------------------------------------------------
create temporary table company_merge as
select
  id,
  first_value(id) over (
    partition by owner_id, lower(trim(name))
    order by created_at, id
  ) as keeper
from companies;

update people p
   set company_id = m.keeper
  from company_merge m
 where p.company_id = m.id and m.id <> m.keeper;

update meetings mt
   set company_id = m.keeper
  from company_merge m
 where mt.company_id = m.id and m.id <> m.keeper;

delete from companies c
 using company_merge m
 where c.id = m.id and m.id <> m.keeper;

-- ---------------------------------------------------------------------------
-- 2. Merge duplicate people
--
-- Same cause: runAnalysis created a person for every participant that had no
-- person_id, so three meetings with Chad produced three Chads. Facts, emotion
-- reads, follow-ups and meeting links all move to the survivor, so nothing
-- that was learned about the person is lost — it just ends up on one profile
-- instead of scattered across three.
--
-- Runs after the company merge so company_id is already canonical.
-- ---------------------------------------------------------------------------
create temporary table people_merge as
select
  id,
  first_value(id) over (
    partition by owner_id, lower(trim(full_name)), coalesce(company_id::text, '~')
    order by created_at, id
  ) as keeper
from people;

update person_facts f
   set person_id = m.keeper
  from people_merge m
 where f.person_id = m.id and m.id <> m.keeper;

update participant_reads r
   set person_id = m.keeper
  from people_merge m
 where r.person_id = m.id and m.id <> m.keeper;

update meeting_participants mp
   set person_id = m.keeper
  from people_merge m
 where mp.person_id = m.id and m.id <> m.keeper;

update action_items a
   set person_id = m.keeper
  from people_merge m
 where a.person_id = m.id and m.id <> m.keeper;

delete from people p
 using people_merge m
 where p.id = m.id and m.id <> m.keeper;

-- ---------------------------------------------------------------------------
-- 3. Stop it happening again
--
-- The application also checks before inserting, but a constraint is the only
-- thing that holds when two meetings are processed at the same time.
-- coalesce(...,'~') is needed because NULL company_id would otherwise never
-- collide with itself in a unique index.
-- ---------------------------------------------------------------------------
create unique index if not exists companies_owner_name_uniq
  on companies (owner_id, lower(trim(name)));

create unique index if not exists people_owner_name_company_uniq
  on people (owner_id, lower(trim(full_name)), coalesce(company_id::text, '~'));

-- ---------------------------------------------------------------------------
-- 4. Categories for the Table of Interest
--
-- The table has a column per category, so the categories have to exist before
-- the model can fill them. 'movie' and 'drink' are new; everything already
-- stored keeps working.
-- ---------------------------------------------------------------------------
alter table person_facts drop constraint if exists person_facts_category_check;

alter table person_facts add constraint person_facts_category_check
  check (category in (
    'food_like','food_dislike','drink','movie','hobby','interest','dislike',
    'communication_style','personal','other'
  ));

-- One approved fact per person per category is what the table shows first;
-- this index just makes that lookup cheap.
create index if not exists person_facts_person_category_idx
  on person_facts (person_id, category, approved);
