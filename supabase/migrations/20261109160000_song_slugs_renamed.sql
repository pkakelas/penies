-- Give the songs that were added before slugs followed titles the address
-- their title makes. Their earlier addresses go into old_slugs (the trigger
-- from song_slug_from_title), so old links redirect.
update public.songs
set slug = public.free_song_slug(public.slugify(title), id)
where public.slugify(title) <> '' and slug <> public.slugify(title);
