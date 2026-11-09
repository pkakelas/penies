-- Songs that visitors ask for with the form on the landing page.
-- Anyone may add a request; only admins read and delete them (in /admin).
create table public.song_requests (
  id uuid primary key default gen_random_uuid(),
  -- What the visitor typed: usually a title and who sings it.
  song text not null check (char_length(song) between 2 and 300),
  email text not null check (char_length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  -- The language of the page the request came from, for the reply.
  lang text not null default 'el' check (lang in ('el', 'en')),
  created_at timestamptz not null default now()
);
create index song_requests_created_idx on public.song_requests (created_at);

-- Tidy what was typed, and refuse new requests when 30 arrived within the
-- last hour, so a script cannot fill the table. Runs as the owner because
-- visitors cannot read the table to count.
create function public.song_requests_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.song_requests where created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Too many song requests right now';
  end if;
  new.song := btrim(new.song);
  new.email := lower(btrim(new.email));
  return new;
end;
$$;
create trigger song_requests_before_insert
  before insert on public.song_requests
  for each row execute function public.song_requests_before_insert();

alter table public.song_requests enable row level security;
-- Visitors set these three columns only; id and created_at are the defaults.
grant insert (song, email, lang) on public.song_requests to anon, authenticated;
grant select, delete on public.song_requests to authenticated;
grant all on public.song_requests to service_role;

create policy "Anyone can ask for a song"
  on public.song_requests for insert to anon, authenticated
  with check (true);
create policy "Admins can read song requests"
  on public.song_requests for select to authenticated
  using ((select public.is_admin()));
create policy "Admins can delete song requests"
  on public.song_requests for delete to authenticated
  using ((select public.is_admin()));
