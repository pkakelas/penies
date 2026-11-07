-- The order of the published songs on the landing page. An admin moves songs
-- up and down in /admin, which numbers every published song from 1; a song
-- that has not been placed yet (null) comes first, newest published first,
-- so a new song shows up at the top until it is moved.
alter table public.songs add column sort_order integer;
create index songs_order_idx on public.songs (status, sort_order, published_at desc);

-- Number the given songs 1, 2, 3… in the order of the array. Runs with the
-- caller's rights, so only admins change anything (the update policy).
create function public.reorder_songs(ids uuid[])
returns void
language sql
set search_path = ''
as $$
  update public.songs s
  set sort_order = placed.n
  from unnest(ids) with ordinality as placed(id, n)
  where s.id = placed.id;
$$;
revoke execute on function public.reorder_songs(uuid[]) from public, anon;
grant execute on function public.reorder_songs(uuid[]) to authenticated;
