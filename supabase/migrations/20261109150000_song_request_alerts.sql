-- Email an alert for every song request, so it can be done within the 24
-- hours the form promises. The mail goes out through Resend's API with
-- pg_net, which sends it after the insert commits; reply to the alert to
-- answer the visitor. Resend's API key is the Vault secret `resend_api_key`;
-- until it exists no mail is sent. Add it with:
--   select vault.create_secret('re_…', 'resend_api_key');
create extension if not exists pg_net with schema extensions;

create function public.song_requests_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  api_key text;
  song text := regexp_replace(new.song, '\s+', ' ', 'g');
  athens timestamp := new.created_at at time zone 'Europe/Athens';
begin
  select decrypted_secret into api_key from vault.decrypted_secrets where name = 'resend_api_key';
  if api_key is null then
    return null;
  end if;
  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || api_key, 'Content-Type', 'application/json'),
    body := jsonb_build_object(
      'from', 'Penia <onboarding@resend.dev>',
      'to', jsonb_build_array('pkakelas@gmail.com'),
      'reply_to', new.email,
      'subject', 'Song request: ' || left(song, 120),
      'text', concat_ws(e'\n',
        song,
        '',
        'From: ' || new.email || ' (reply to this mail to answer them)',
        'Asked on the ' || case new.lang when 'en' then 'English' else 'Greek' end || ' site, '
          || to_char(athens, 'DD/MM HH24:MI') || '; promised by ' || to_char(athens + interval '24 hours', 'DD/MM HH24:MI') || ' (Athens time).',
        '',
        'Requests: https://penia-one.vercel.app/admin'
      )
    )
  );
  return null;
exception when others then
  -- A mail that cannot be sent must not lose the visitor's request.
  raise warning 'song request alert not sent: %', sqlerrm;
  return null;
end;
$$;
create trigger song_requests_alert
  after insert on public.song_requests
  for each row execute function public.song_requests_alert();
