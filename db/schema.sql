-- Bundler V1 schema.
-- Run this in your Supabase project: SQL Editor -> New Query -> paste -> Run.
-- Idempotent: safe to re-run while iterating.

-- =============================================================================
-- ENUMS
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'release_status') then
    create type release_status as enum ('unreleased', 'early_access', 'released');
  end if;
  if not exists (select 1 from pg_type where typname = 'swipe_direction') then
    -- 'maybe' = deferred decision, shown in its own tab, can be revisited later.
    -- 'no' = rejection, shown in its own tab too, can be reverted.
    -- 'yes' = commitment that may trigger a match - revertable only via match dismiss.
    create type swipe_direction as enum ('yes', 'no', 'maybe');
  end if;
end$$;

-- Idempotent enum extension for existing databases.
alter type swipe_direction add value if not exists 'maybe';

-- =============================================================================
-- TABLES
-- =============================================================================

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  steam_id varchar(32) not null unique,
  email varchar(255),
  discord_username varchar(64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists users_steam_id_idx on users (steam_id);

create table if not exists games (
  id uuid primary key default gen_random_uuid(),
  steam_app_id varchar(16) not null unique,
  name varchar(255) not null,
  capsule_url text,
  store_url text,
  price_cents_usd integer,
  release_status release_status not null default 'unreleased',
  release_date date,
  review_count integer,
  -- Steam doesn't expose follower count publicly for unreleased games (only the partner
  -- manager and the SteamDB extension see them, and we can't access either). Kept here
  -- for backwards-compat / future use, but not actively scraped or filtered on.
  follower_count integer,
  follower_count_synced_at timestamptz,
  follower_count_source varchar(20),
  -- Self-reported by the dev. Wishlist is the canonical pre-launch audience metric and
  -- devs see the real number in their partner manager. We trust the input and label it
  -- as self-reported in the UI. This is the field used for audience-size filtering.
  wishlist_count integer,
  wishlist_count_updated_at timestamptz,
  first_update_date date,                -- earliest news/announcement post date - proxy for "when did dev activity start"
  last_update_date date,                 -- most recent news/announcement post date - dead-game detector
  tags_source varchar(20),               -- 'steamspy' | 'genres' | 'manual'
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists games_steam_app_id_idx on games (steam_app_id);
create index if not exists games_name_lower_idx on games (lower(name));

create table if not exists game_tags (
  game_id uuid not null references games(id) on delete cascade,
  tag varchar(64) not null,
  primary key (game_id, tag)
);
create index if not exists game_tags_tag_idx on game_tags (tag);

create table if not exists game_owners (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  game_id uuid not null references games(id) on delete cascade unique, -- V1: 1 game = 1 owner. Drop the unique when going multi-owner.
  verification_code varchar(32),
  verification_initiated_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists game_owners_user_id_idx on game_owners (user_id);

create table if not exists bundle_preferences (
  game_id uuid primary key references games(id) on delete cascade,
  required_tags text[] not null default '{}',
  required_tags_match_count integer not null default 3,
  excluded_tags text[] not null default '{}',
  excluded_tags_match_count integer not null default 1,
  min_follower_count integer not null default 0,
  price_band_min_cents integer not null default 0,
  price_band_max_cents integer not null default 999999,
  notes text,
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists swipes (
  id uuid primary key default gen_random_uuid(),
  swiper_game_id uuid not null references games(id) on delete cascade,
  target_game_id uuid not null references games(id) on delete cascade,
  direction swipe_direction not null,
  created_at timestamptz not null default now(),
  unique (swiper_game_id, target_game_id),
  check (swiper_game_id <> target_game_id)
);
create index if not exists swipes_swiper_idx on swipes (swiper_game_id);
create index if not exists swipes_target_yes_idx on swipes (target_game_id) where direction = 'yes';

create table if not exists matches (
  id uuid primary key default gen_random_uuid(),
  game_a_id uuid not null references games(id) on delete cascade,
  game_b_id uuid not null references games(id) on delete cascade,
  matched_at timestamptz not null default now(),
  a_dismissed_at timestamptz,
  b_dismissed_at timestamptz,
  unique (game_a_id, game_b_id),
  check (game_a_id < game_b_id) -- enforce canonical ordering: smaller uuid first
);
create index if not exists matches_a_idx on matches (game_a_id);
create index if not exists matches_b_idx on matches (game_b_id);

create table if not exists blocks (
  blocker_game_id uuid not null references games(id) on delete cascade,
  blocked_game_id uuid not null references games(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_game_id, blocked_game_id),
  check (blocker_game_id <> blocked_game_id)
);

create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid not null references users(id) on delete cascade,
  reported_game_id uuid not null references games(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists reports_unresolved_idx on reports (created_at) where resolved_at is null;

-- =============================================================================
-- TRIGGER: updated_at maintenance
-- =============================================================================

create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$
declare
  t text;
begin
  for t in select unnest(array['users', 'games', 'game_owners', 'bundle_preferences']) loop
    execute format('drop trigger if exists trg_%s_updated_at on %s', t, t);
    execute format('create trigger trg_%s_updated_at before update on %s for each row execute function set_updated_at()', t, t);
  end loop;
end$$;

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================
-- We're using the service-role key on the server (which bypasses RLS), so RLS
-- isn't strictly required for security in V1. But enabling it is good defense
-- in depth: if the anon key ever leaks into a context it shouldn't, RLS prevents
-- read/write. We leave the policies empty/locked so the anon key sees nothing.

alter table users enable row level security;
alter table games enable row level security;
alter table game_tags enable row level security;
alter table game_owners enable row level security;
alter table bundle_preferences enable row level security;
alter table swipes enable row level security;
alter table matches enable row level security;
alter table blocks enable row level security;
alter table reports enable row level security;

-- =============================================================================
-- GRANTS FOR service_role
-- =============================================================================
-- We turn off "Automatically expose new tables" in the Supabase project security
-- settings (recommended best practice for stricter access control), which means
-- the service_role does NOT auto-receive grants on new tables. service_role
-- bypasses RLS, but it still needs SQL-level GRANTs to read/write tables.
-- Without the GRANTs you'll see error 42501: "permission denied for table users".
-- We grant ONLY to service_role, NOT to anon or authenticated, since all our
-- backend goes through service_role and the public roles should stay locked.

grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Default privileges so any future tables/sequences inherit these grants.
alter default privileges in schema public grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public grant usage, select on sequences to service_role;

-- =============================================================================
-- IDEMPOTENT MIGRATIONS
-- =============================================================================
-- Add-only changes go here so existing databases pick up new columns when this
-- file is rerun. Postgres `add column if not exists` is safe to rerun.

alter table games add column if not exists follower_count_source varchar(20);
alter table games add column if not exists tags_source varchar(20);
alter table games add column if not exists review_count integer;
alter table games add column if not exists first_update_date date;
alter table games add column if not exists last_update_date date;
alter table games add column if not exists wishlist_count integer;
alter table games add column if not exists wishlist_count_updated_at timestamptz;

alter table bundle_preferences add column if not exists required_tags_match_count integer not null default 3;
alter table bundle_preferences add column if not exists excluded_tags_match_count integer not null default 1;
