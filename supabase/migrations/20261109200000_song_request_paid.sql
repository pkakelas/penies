-- A visitor who paid gets an email saying so, with the songs they asked for.
-- Stripe tells the database about the payment: its webhook posts straight to
-- `stripe_webhook` (through the Data API, no server in between), which checks
-- Stripe's signature, marks the form's requests as paid and writes the mail
-- with Resend through pg_net, like the request alert.
--
-- To switch it on:
--   1. Stripe -> Developers -> Webhooks: add an endpoint for the events
--      `checkout.session.completed` and `checkout.session.async_payment_succeeded`
--      at https://PROJECT.supabase.co/rest/v1/rpc/stripe_webhook?apikey=PUBLISHABLE_KEY
--   2. Save the endpoint's signing secret in Vault:
--        select vault.create_secret('whsec_…', 'stripe_webhook_secret');
--      A second endpoint (the sandbox) can have its own, under any name that
--      starts with `stripe_webhook_secret`.
-- With no such secret every call is refused. The sender's domain must be
-- verified in Resend, or Resend refuses mail to anyone but the account owner.

alter table public.song_requests
  -- The same for the songs of one form. The browser makes it up and gives it
  -- to the payment page, and Stripe gives it back with the payment.
  add column form uuid,
  -- The order requests arrived in; within one form, the order they were typed.
  add column seq bigint generated always as identity,
  -- When Stripe said the form was paid for. Only the webhook sets it.
  add column paid_at timestamptz;
create index song_requests_form_idx on public.song_requests (form);
grant insert (form) on public.song_requests to anon, authenticated;

-- The mail a visitor gets once their payment arrived: subject, html and text.
create function public.song_request_receipt(lang text, songs text[])
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  en constant boolean := lang = 'en';
  subject constant text := case when en then 'We got your request' else 'Λάβαμε την παραγγελιά σου' end;
  title constant text := case when en then 'Thank you' else 'Ευχαριστούμε' end;
  lead constant text := case when en then 'Payment received. We''re preparing your songs:'
                                     else 'Η πληρωμή έγινε. Ετοιμάζουμε τα τραγούδια σου:' end;
  -- The site's name goes between these two, as a link.
  before_site constant text := case when en then 'They''ll be on ' else 'Θα είναι στο ' end;
  after_site constant text := case when en then ' within 24 hours, and we''ll email you when they''re up.'
                                           else ' μέσα σε 24 ώρες και θα σου γράψουμε μόλις ανέβουν.' end;
  reply constant text := case when en then 'To change anything, reply to this email.'
                                      else 'Αν θες να αλλάξεις κάτι, απάντησε σε αυτό το email.' end;
  site constant text := 'https://www.penies.gr' || case when en then '/en' else '' end;
  serif constant text := 'font-family:Georgia,Times New Roman,serif;';
  sans constant text := 'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;';
  setlist text;
begin
  -- The songs numbered like the form's setlist. They are what a visitor typed, so nothing in them may act as HTML.
  select string_agg(
    '<tr>'
    || '<td width="38" valign="top" style="padding:14px 0 14px 20px;' || rule || serif || 'font-size:20px;line-height:26px;color:#d9a441;">' || place || '</td>'
    || '<td valign="top" style="padding:14px 20px 14px 0;' || rule || serif || 'font-size:18px;line-height:26px;color:#f3ece0;word-break:break-word;">'
    || replace(replace(replace(replace(song, '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;') || '</td>'
    || '</tr>',
    '' order by place)
  into setlist
  from unnest(songs) with ordinality as listed(song, place),
    lateral (select case place when 1 then '' else 'border-top:1px solid #2d2a25;' end as rule) as ruled;

  return jsonb_build_object(
    'subject', subject,
    'text', concat_ws(e'\n',
      title,
      '',
      lead,
      (select string_agg(place || '. ' || song, e'\n' order by place) from unnest(songs) with ordinality as listed(song, place)),
      '',
      before_site || 'penies.gr' || after_site,
      reply,
      '',
      site),
    'html',
      '<!doctype html>'
      || '<html lang="' || case when en then 'en' else 'el' end || '">'
      || '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
      || '<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">'
      || '<title>' || subject || '</title></head>'
      || '<body style="margin:0;padding:0;background:#0d0b09;">'
      || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0d0b09" style="background:#0d0b09;">'
      || '<tr><td align="center" style="padding:40px 16px 48px;">'
      || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">'
      || '<tr><td style="padding:0 6px 22px;' || serif || 'font-size:22px;line-height:28px;">'
      || '<a href="' || site || '" style="color:#d9a441;text-decoration:none;">Πενιές</a></td></tr>'
      || '<tr><td bgcolor="#15120e" style="background:#15120e;border:1px solid #2d2a25;border-radius:24px;padding:34px 30px 36px;">'
      || '<h1 style="margin:0;' || serif || 'font-weight:normal;font-size:34px;line-height:40px;color:#f3ece0;">' || title || '</h1>'
      || '<p style="margin:16px 0 0;' || sans || 'font-size:16px;line-height:26px;color:#f3ece0;">' || lead || '</p>'
      || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0d0b09" '
      || 'style="margin-top:22px;background:#0d0b09;border:1px solid #2d2a25;border-radius:16px;border-collapse:separate;">'
      || coalesce(setlist, '')
      || '</table>'
      || '<p style="margin:22px 0 0;' || sans || 'font-size:16px;line-height:26px;color:#f3ece0;">' || before_site
      || '<a href="' || site || '" style="color:#f4cf82;text-decoration:underline;">penies.gr</a>' || after_site || '</p>'
      || '</td></tr>'
      || '<tr><td style="padding:20px 6px 0;' || sans || 'font-size:13px;line-height:20px;color:#a89e8d;">' || reply || '</td></tr>'
      || '</table>'
      || '</td></tr></table>'
      || '</body></html>'
  );
end;
$$;
revoke all on function public.song_request_receipt(text, text[]) from public, anon, authenticated;

-- Where Stripe's webhook posts its events. The one unnamed json parameter
-- makes the Data API hand over the request's body as it was sent, which is
-- what Stripe signed. Anyone can call this, so nothing happens before the
-- signature has been checked against the secret in Vault.
create function public.stripe_webhook(json)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  payload alias for $1;
  -- "t=<unix time>,v1=<hmac of 't.body'>": https://docs.stripe.com/webhooks#verify-manually
  signature constant text := nullif(current_setting('request.headers', true), '')::json ->> 'stripe-signature';
  stamp constant text := substring(signature from 't=(\d{1,12})');
  event jsonb;
  session jsonb;
  reference text;
  payer text;
  ids uuid[];
  songs text[];
  lang text;
  email text;
  marked integer;
  api_key text;
  mail jsonb;
begin
  if stamp is null
    -- An old event sent again by someone who saw it go by.
    or abs(extract(epoch from now()) - stamp::bigint) > 300
    or not exists (
      select from vault.decrypted_secrets as secret
      where starts_with(secret.name, 'stripe_webhook_secret')
        and encode(
              extensions.hmac(
                convert_to(stamp || '.' || payload::text, 'utf8'),
                convert_to(secret.decrypted_secret, 'utf8'),
                'sha256'),
              'hex')
            in (select sent[1] from regexp_matches(signature, 'v1=([0-9a-f]{64})', 'g') as sent)
    )
  then
    raise exception 'Not signed by Stripe';
  end if;

  event := payload::jsonb;
  session := event #> '{data,object}';
  -- A payment that is still on its way (a bank transfer) comes back later as async_payment_succeeded.
  if coalesce(event ->> 'type', '') not in ('checkout.session.completed', 'checkout.session.async_payment_succeeded')
    or session ->> 'payment_status' = 'unpaid'
  then
    return;
  end if;

  reference := session ->> 'client_reference_id';
  if reference ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
    select array_agg(r.id order by r.seq), array_agg(r.song order by r.seq), min(r.lang), min(r.email)
      into ids, songs, lang, email
      from public.song_requests as r
      where r.form = reference::uuid and r.paid_at is null;
  elsif reference is null then
    -- Paid without going through the form's Pay button (a page open since before
    -- forms had a reference): the last form this email sent. Its rows were
    -- saved by one insert, so they share created_at.
    payer := lower(session #>> '{customer_details,email}');
    select array_agg(r.id order by r.seq), array_agg(r.song order by r.seq), min(r.lang), min(r.email)
      into ids, songs, lang, email
      from public.song_requests as r
      where r.email = payer and r.paid_at is null
        and r.created_at = (
          select max(last.created_at) from public.song_requests as last
          where last.email = payer and last.paid_at is null and last.created_at > now() - interval '2 days');
  end if;

  -- Stripe may send an event more than once: only the call that marks the requests writes the mail.
  update public.song_requests as r set paid_at = now() where r.id = any (ids) and r.paid_at is null;
  get diagnostics marked = row_count;
  if marked = 0 then
    return;
  end if;

  begin
    select decrypted_secret into api_key from vault.decrypted_secrets where name = 'resend_api_key';
    if api_key is not null then
      mail := public.song_request_receipt(lang, songs);
      perform net.http_post(
        url := 'https://api.resend.com/emails',
        headers := jsonb_build_object('Authorization', 'Bearer ' || api_key, 'Content-Type', 'application/json'),
        body := jsonb_build_object(
          'from', 'Πενιές <paraggelies@penies.gr>',
          'to', jsonb_build_array(email),
          'reply_to', 'pkakelas@gmail.com',
          'subject', mail ->> 'subject',
          'html', mail ->> 'html',
          'text', mail ->> 'text'
        )
      );
    end if;
  exception when others then
    -- A mail that cannot be written must not undo the payment's mark.
    raise warning 'payment confirmation not sent: %', sqlerrm;
  end;
end;
$$;
revoke all on function public.stripe_webhook(json) from public, authenticated;
grant execute on function public.stripe_webhook(json) to anon;
