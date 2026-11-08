-- An instrumental has no singer. An admin ticks it when adding the link; the
-- worker then leaves out the vocals stem (the preset always makes one, and
-- for an instrumental it is only noise), and the player shows no vocals
-- switch. `first_singer` and `artist` then hold who plays, not who sings.
alter table public.songs
  add column instrumental boolean not null default false;
