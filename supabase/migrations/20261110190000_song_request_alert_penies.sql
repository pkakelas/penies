-- The site is now called Penies and lives at www.penies.gr: the request
-- alert is signed with the new name and links to the new address. The
-- function is otherwise the one from 20261110160000_song_credits.sql.
create or replace function public.song_requests_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  api_key text;
  request record;
begin
  select decrypted_secret into api_key from vault.decrypted_secrets where name = 'resend_api_key';
  if api_key is null then
    return null;
  end if;
  for request in
    select
      email,
      min(name) as name,
      min(lang) as lang,
      min(created_at) at time zone 'Europe/Athens' as athens,
      bool_and(paid_at is not null) as paid,
      array_agg(regexp_replace(song, '\s+', ' ', 'g')) as songs
    from added
    group by email
  loop
    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object('Authorization', 'Bearer ' || api_key, 'Content-Type', 'application/json'),
      body := jsonb_build_object(
        'from', 'Penies <onboarding@resend.dev>',
        'to', jsonb_build_array('pkakelas@gmail.com'),
        'reply_to', request.email,
        'subject',
          case cardinality(request.songs)
            when 1 then 'Song request: '
            else 'Song requests (' || cardinality(request.songs) || '): '
          end || left(array_to_string(request.songs, '; '), 150),
        'text', concat_ws(e'\n',
          (select string_agg(
             case cardinality(request.songs) when 1 then song else place || '. ' || song end,
             e'\n' order by place)
           from unnest(request.songs) with ordinality as listed(song, place)),
          '',
          'From: ' || coalesce(request.name || ' <' || request.email || '>', request.email)
            || ' (reply to this mail to answer them)',
          'Asked on the ' || case request.lang when 'en' then 'English' else 'Greek' end || ' site, '
            || to_char(request.athens, 'DD/MM HH24:MI') || '; promised by '
            || to_char(request.athens + interval '24 hours', 'DD/MM HH24:MI') || ' (Athens time).',
          case when request.paid then 'Paid with credits.'
               else 'Not paid yet: split it once /admin marks it Paid.' end,
          '',
          'Requests: https://www.penies.gr/admin'
        )
      )
    );
  end loop;
  return null;
exception when others then
  -- A mail that cannot be sent must not lose the visitor's requests.
  raise warning 'song request alert not sent: %', sqlerrm;
  return null;
end;
$$;
