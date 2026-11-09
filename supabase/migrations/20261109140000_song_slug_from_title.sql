-- A song's address (slug) follows its title. Whenever the title is set or
-- changes, by the worker or in /admin, the slug is made again from it, and
-- the address it had before goes into old_slugs so links to it keep working
-- (the song page redirects them).
create extension if not exists unaccent with schema extensions;

alter table public.songs add column old_slugs text[] not null default '{}';
create index songs_old_slugs_idx on public.songs using gin (old_slugs);

-- Lower-case Latin slug; Greek is transliterated ("Άτακτη" -> "atakti",
-- "Το Καφεδάκι" -> "to-kafedaki").
create function public.slugify(title text)
returns text
language sql
stable
set search_path = ''
as $$
  select trim(both '-' from regexp_replace(
    extensions.unaccent(
      translate(
        replace(replace(replace(replace(replace(replace(
          translate(lower(title), 'άέήίόύώϊϋΐΰ', 'αεηιουωιυιυ'),
          'ου', 'ou'), 'αυ', 'av'), 'ευ', 'ev'), 'θ', 'th'), 'χ', 'ch'), 'ψ', 'ps'),
        'αβγδεζηικλμνξοπρσςτυφω', 'avgdeziiklmnxoprsstyfo'
      )
    ),
    '[^a-z0-9]+', '-', 'g'
  ));
$$;

-- `wanted`, or wanted-2, wanted-3… when another song already has it.
create function public.free_song_slug(wanted text, song_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  candidate text := wanted;
  n integer := 2;
begin
  while exists (select 1 from public.songs where slug = candidate and id <> song_id) loop
    candidate := wanted || '-' || n;
    n := n + 1;
  end loop;
  return candidate;
end;
$$;
revoke execute on function public.free_song_slug(text, uuid) from public, anon, authenticated;

create function public.songs_slug_follows_title()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  wanted text := public.slugify(new.title);
begin
  if tg_op = 'INSERT' then
    if wanted <> '' then
      new.slug := public.free_song_slug(wanted, new.id);
    end if;
    return new;
  end if;
  if new.title is distinct from old.title and wanted <> '' then
    new.slug := public.free_song_slug(wanted, new.id);
  end if;
  if new.slug <> old.slug then
    new.old_slugs := array_append(array_remove(old.old_slugs, new.slug), old.slug);
  end if;
  return new;
end;
$$;
create trigger songs_slug_follows_title
  before insert or update of title, slug on public.songs
  for each row execute function public.songs_slug_follows_title();
