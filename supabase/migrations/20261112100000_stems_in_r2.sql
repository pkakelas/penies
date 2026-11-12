-- Stems move from Supabase Storage to Cloudflare R2, which does not charge
-- for downloads: a visit to a song page is about 23 MB of them, and the Free
-- plan's 5 GB a month was gone in three days.
--
-- The R2 bucket is private. A visitor's browser gets the stems through links
-- that this database signs (stem_links), so a draft's audio stays admin-only.
-- The worker saves what the signing needs with set_r2_stems(); nothing has to
-- be typed into the Vault by hand.

-- Where a song's stems are: the paths in `stems` are the same in both places.
-- `uv run worker.py to-r2` copies a song over and then changes this.
alter table public.songs
  add column storage text not null default 'supabase'
  check (storage in ('supabase', 'r2'));

-- The R2 bucket and a key that can read it, as JSON in the Vault secret
-- `r2_stems`: {"endpoint": "https://<account id>.r2.cloudflarestorage.com",
-- "bucket": "…", "access_key": "…", "secret_key": "…"}. Called by the worker
-- with what is in its .env, so the two cannot drift apart.
create function public.set_r2_stems(config jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved uuid;
begin
  if config->>'endpoint' !~ '^https://[a-z0-9.-]+$'
    or config->>'bucket' !~ '^[a-z0-9-]+$'
    or config->>'access_key' !~ '^[A-Za-z0-9]+$'
    or coalesce(config->>'secret_key', '') = '' then
    raise exception 'r2_stems needs endpoint (https://host, no path), bucket, access_key and secret_key';
  end if;
  select id into saved from vault.secrets where name = 'r2_stems';
  if saved is null then
    perform vault.create_secret(config::text, 'r2_stems');
  elsif (select decrypted_secret from vault.decrypted_secrets where id = saved) is distinct from config::text then
    perform vault.update_secret(saved, config::text);
  end if;
end;
$$;
revoke all on function public.set_r2_stems(jsonb) from public, anon, authenticated;
grant execute on function public.set_r2_stems(jsonb) to service_role;

-- A link that downloads one object from R2 without any other credentials,
-- good for `expires` seconds from `signed_at`: an S3 "presigned URL"
-- (AWS Signature Version 4 in the query string; R2's region is "auto").
-- https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
create function public.r2_signed_url(
  endpoint text, bucket text, object_key text, access_key text, secret_key text,
  signed_at timestamptz, expires integer
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  host text := regexp_replace(endpoint, '^https://', '');
  stamp text := to_char(signed_at at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"');
  day text := left(stamp, 8);
  scope text := day || '/auto/s3/aws4_request';
  path text := '/' || bucket || '/' || object_key;
  query text;
  request text;
  to_sign text;
  signing_key bytea;
begin
  -- Only characters that a URL takes as they are, so nothing here needs
  -- escaping. A stem's path is "<song id>/<stem>.m4a".
  if path !~ '^[A-Za-z0-9._/-]+$' or access_key !~ '^[A-Za-z0-9]+$' then
    raise exception 'r2_signed_url: unexpected characters in the path or the access key';
  end if;
  query := 'X-Amz-Algorithm=AWS4-HMAC-SHA256'
    || '&X-Amz-Credential=' || access_key || '%2F' || replace(scope, '/', '%2F')
    || '&X-Amz-Date=' || stamp
    || '&X-Amz-Expires=' || expires
    || '&X-Amz-SignedHeaders=host';
  request := E'GET\n' || path || E'\n' || query || E'\nhost:' || host || E'\n\nhost\nUNSIGNED-PAYLOAD';
  to_sign := E'AWS4-HMAC-SHA256\n' || stamp || E'\n' || scope || E'\n'
    || encode(sha256(convert_to(request, 'UTF8')), 'hex');
  signing_key := extensions.hmac(convert_to(day, 'UTF8'), convert_to('AWS4' || secret_key, 'UTF8'), 'sha256');
  signing_key := extensions.hmac(convert_to('auto', 'UTF8'), signing_key, 'sha256');
  signing_key := extensions.hmac(convert_to('s3', 'UTF8'), signing_key, 'sha256');
  signing_key := extensions.hmac(convert_to('aws4_request', 'UTF8'), signing_key, 'sha256');
  return 'https://' || host || path || '?' || query
    || '&X-Amz-Signature=' || encode(extensions.hmac(convert_to(to_sign, 'UTF8'), signing_key, 'sha256'), 'hex');
end;
$$;
-- It only does arithmetic on what it is given; the worker checks it against
-- its own S3 library.
revoke all on function public.r2_signed_url(text, text, text, text, text, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.r2_signed_url(text, text, text, text, text, timestamptz, integer)
  to service_role;

-- Download links for a song's stems, stem name -> URL, for whoever may read
-- the song: anyone for a published song, admins (and the worker) for the
-- rest. Null when the song is not readable, is not in R2, or R2 is not set up.
--
-- The links are signed on a fixed five-day grid and last seven days, so
-- everyone gets the same link for days at a time and a browser that has a
-- stem keeps using its copy; a link always has at least two days left. A
-- link handed out before a song was unpublished goes on working until then.
create function public.stem_links(song_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  the_song public.songs;
  config jsonb;
  signed_at timestamptz := to_timestamp(floor(extract(epoch from now()) / 432000) * 432000);
  links jsonb := '{}';
  stem record;
begin
  select s.* into the_song
  from public.songs s
  where s.id = stem_links.song_id
    and s.storage = 'r2'
    and (
      s.status = 'published'
      or (select public.is_admin())
      or coalesce((select auth.role()), '') = 'service_role'
    );
  if not found then
    return null;
  end if;
  select decrypted_secret::jsonb into config from vault.decrypted_secrets where name = 'r2_stems';
  if config is null then
    return null;
  end if;
  for stem in select key, value from jsonb_each_text(the_song.stems) loop
    links := links || jsonb_build_object(stem.key, public.r2_signed_url(
      config->>'endpoint', config->>'bucket', stem.value,
      config->>'access_key', config->>'secret_key', signed_at, 604800
    ));
  end loop;
  return links;
end;
$$;
revoke all on function public.stem_links(uuid) from public;
grant execute on function public.stem_links(uuid) to anon, authenticated, service_role;
