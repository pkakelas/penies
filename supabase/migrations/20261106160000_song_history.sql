-- Who sang a song first, and when. Free text, because for old songs the date
-- is often only a year or a rough guess. Who sings in this recording is `artist`.
alter table public.songs
  add column first_performed text not null default '',
  add column first_singer text not null default '';
