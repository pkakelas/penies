-- A new table in `public` starts with every table right for anon and
-- authenticated (Supabase's default privileges), so the column list in the
-- previous migration restricted nothing: a visitor could send their own
-- created_at and slip past the hourly limit. Take those rights away and give
-- back only what the form and /admin use.
revoke all on public.song_requests from anon, authenticated;
grant insert (song, email, lang) on public.song_requests to anon, authenticated;
grant select, delete on public.song_requests to authenticated;
