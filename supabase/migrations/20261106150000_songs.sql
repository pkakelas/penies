-- Penia: songs, admins, and the storage bucket that holds each song's stems.

-- Who may use /admin. Rows are added with `uv run worker.py add-admin`.
create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;
-- No policies: nobody reads or writes this table through the API.
-- Access rules ask is_admin() instead.

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admins where user_id = (select auth.uid())
  );
$$;
grant execute on function public.is_admin() to anon, authenticated;

-- A song goes: queued -> processing -> draft -> published.
--   queued      an admin added the YouTube link; the worker has not started
--   processing  the worker is downloading / splitting / uploading
--   draft       stems are ready; only admins can see and test it
--   published   listed on the site for everyone
--   failed      the worker gave up; `error` says why, an admin can retry
create type public.song_status as enum ('queued', 'processing', 'draft', 'published', 'failed');

create table public.songs (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  youtube_id text not null unique,
  youtube_url text not null,
  title text not null default '',
  artist text not null default '',
  status public.song_status not null default 'queued',
  -- What the worker is doing: step is download | guitar | vocals | upload,
  -- step_detail is MVSEP's own status line (queue position and so on).
  step text not null default '',
  step_detail text not null default '',
  error text not null default '',
  duration_seconds real,
  -- Stem name -> path inside the "stems" bucket, for example
  -- {"instruments": "<song id>/instruments.mp3", ...}
  stems jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  constraint published_songs_have_stems check (status <> 'published' or stems <> '{}'::jsonb)
);
create index songs_status_idx on public.songs (status, created_at);

create function public.songs_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if new.status = 'published' and old.status <> 'published' then
    new.published_at := now();
  end if;
  return new;
end;
$$;
create trigger songs_before_update
  before update on public.songs
  for each row execute function public.songs_before_update();

alter table public.songs enable row level security;
grant select on public.songs to anon;
grant select, insert, update, delete on public.songs to authenticated;
grant all on public.songs, public.admins to service_role;

create policy "Anyone can read published songs"
  on public.songs for select to anon, authenticated
  using (status = 'published');
create policy "Admins can read every song"
  on public.songs for select to authenticated
  using ((select public.is_admin()));
create policy "Admins can add songs"
  on public.songs for insert to authenticated
  with check ((select public.is_admin()));
create policy "Admins can change songs"
  on public.songs for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy "Admins can delete songs"
  on public.songs for delete to authenticated
  using ((select public.is_admin()));

-- Stems live in a private bucket, one folder per song id.
insert into storage.buckets (id, name, public, file_size_limit)
values ('stems', 'stems', false, 52428800);

-- A stem is readable when its song is readable: the lookup below runs with
-- the caller's own rights, so visitors match published songs only and admins
-- match every song.
create policy "Stems are readable when their song is"
  on storage.objects for select to anon, authenticated
  using (
    bucket_id = 'stems'
    and exists (
      select 1 from public.songs s
      where s.id::text = (storage.foldername(name))[1]
    )
  );
create policy "Admins can delete stems"
  on storage.objects for delete to authenticated
  using (bucket_id = 'stems' and (select public.is_admin()));
