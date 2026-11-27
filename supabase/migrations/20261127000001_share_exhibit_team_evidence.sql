alter table public.exhibit_rooms
  add column if not exists inventory_found boolean not null default false,
  add column if not exists opening_found boolean not null default false;