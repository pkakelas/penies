-- Drafts that did not split well can be put away instead of deleted: an
-- archived song keeps its stems, is only visible to admins (like a draft) and
-- is listed on /admin/archive, from where it can go back to the drafts.
alter type public.song_status add value if not exists 'archived' after 'published';
