create table if not exists public.exhibit_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{6}$'),
  status text not null default 'active' check (status in ('active','completed','expired')),
  host_player_id uuid,
  state jsonb not null default '{"security_solved":false,"archive_unlocked":false,"clue_found":false}'::jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.exhibit_players (
  id uuid primary key,
  room_id uuid not null references public.exhibit_rooms(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 20),
  room_key text not null default 'main' check (room_key in ('main','security','archive')),
  x double precision not null default 50 check (x between 0 and 100),
  y double precision not null default 74 check (y between 0 and 100),
  inventory jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
alter table public.exhibit_rooms drop constraint if exists exhibit_rooms_host_player_id_fkey;
alter table public.exhibit_rooms add constraint exhibit_rooms_host_player_id_fkey
  foreign key (host_player_id) references public.exhibit_players(id) on delete set null;
create index if not exists exhibit_players_room_id_idx on public.exhibit_players(room_id);
create index if not exists exhibit_players_last_seen_idx on public.exhibit_players(last_seen);
alter table public.exhibit_rooms enable row level security;
alter table public.exhibit_players enable row level security;
revoke all on table public.exhibit_rooms from anon, authenticated;
revoke all on table public.exhibit_players from anon, authenticated;
grant all on table public.exhibit_rooms to service_role;
grant all on table public.exhibit_players to service_role;
