alter table public.exhibit_rooms
  alter column status set default 'waiting';

alter table public.exhibit_rooms
  drop constraint if exists exhibit_rooms_status_check;

alter table public.exhibit_rooms
  add constraint exhibit_rooms_status_check
  check (status in ('waiting', 'active', 'completed', 'expired'));
