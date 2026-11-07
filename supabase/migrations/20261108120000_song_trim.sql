-- Where the playable part of a recording starts and ends, in seconds from the
-- start of the recording. Null means the recording's own start or end. An
-- admin sets them in /admin to cut an intro or an outro; the player then
-- behaves as if the song began and ended there (its position starts at 0:00
-- and stops at the trimmed length).
alter table public.songs
  add column start_seconds double precision check (start_seconds >= 0),
  add column end_seconds double precision check (end_seconds > 0),
  add constraint songs_trim_in_order
    check (start_seconds is null or end_seconds is null or start_seconds < end_seconds);
