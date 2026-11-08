-- Who wrote the music. Free text, like the singers' names.
alter table public.songs add column composer text not null default '';
