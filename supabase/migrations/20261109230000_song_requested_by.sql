-- Who asked for the song: the name a visitor gave in the request form, typed
-- in by an admin. Free text, like the singers' names; empty when nobody asked.
-- The song page and the landing page's list show it.
alter table public.songs add column requested_by text not null default '';
