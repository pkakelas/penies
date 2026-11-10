-- Credits: a visitor signs in with their email (Supabase Auth, a code sent
-- by mail), pays for a pack of songs (song_pack(), three) and asks for them
-- one at a time, whenever they like. A payment adds the pack to the balance
-- kept under the visitor's email; asking for a song takes one off and saves
-- the request as paid.
--
-- Visitors never touch the two new tables: they ask my_song_credits() for
-- their balance, my_song_requests() for the songs they are waiting for and
-- spend with spend_song_credits(), all of which go by the signed-in user's
-- confirmed email. Admins are users too, but the form does not count their
-- sign-in (@admin.penia.app), so they never hold credits.

-- How many songs one payment buys. The price is set on the Stripe Payment Link
-- and written in the site's texts (request.terms and request.pay in i18n.ts).
create function public.song_pack()
returns integer
language sql
immutable
set search_path = ''
as $$ select 3 $$;
revoke all on function public.song_pack() from public, anon, authenticated;

-- Songs paid for and not asked for yet, by email.
create table public.song_credits (
  email text primary key check (email = lower(email)),
  balance integer not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

-- Every payment Stripe told us about, once: an event sent twice finds its
-- session here and is ignored. Also what to look at if a balance is doubted.
create table public.song_payments (
  -- Stripe's Checkout Session id (cs_…).
  session text primary key,
  email text not null,
  credits integer not null,
  -- The request form the payment came from, when there was one.
  form uuid,
  created_at timestamptz not null default now()
);

alter table public.song_credits enable row level security;
alter table public.song_payments enable row level security;
revoke all on public.song_credits from anon, authenticated;
revoke all on public.song_payments from anon, authenticated;
grant all on public.song_credits to service_role;
grant all on public.song_payments to service_role;

-- The signed-in user's email, once they have proved it is theirs (an email
-- that was never confirmed is no one's yet). Null for a visitor who is not signed in.
create function public.visitor_email()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select lower(u.email) from auth.users as u
  where u.id = auth.uid() and u.email_confirmed_at is not null
$$;
revoke all on function public.visitor_email() from public, anon, authenticated;

-- How many songs the signed-in visitor can still ask for.
create function public.my_song_credits()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select c.balance from public.song_credits as c where c.email = public.visitor_email()), 0)
$$;
revoke all on function public.my_song_credits() from public, anon;
grant execute on function public.my_song_credits() to authenticated;

-- The songs the signed-in visitor asked for and is waiting for: paid, and not
-- yet marked Done in /admin (which deletes the request).
create function public.my_song_requests()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select r.song from public.song_requests as r
  where r.email = public.visitor_email() and r.paid_at is not null
  order by r.seq
$$;
revoke all on function public.my_song_requests() from public, anon;
grant execute on function public.my_song_requests() to authenticated;

-- Ask for songs with credits: one credit per song, saved as paid requests
-- (they show up in /admin and send the alert like any other). Returns the
-- credits left. Empty entries are skipped; with too few credits nothing is
-- saved.
create function public.spend_song_credits(songs text[], name text, lang text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner constant text := public.visitor_email();
  picked text[];
  left_over integer;
begin
  if owner is null then
    raise exception 'Not signed in';
  end if;
  select array_agg(btrim(song) order by place) into picked
    from unnest(songs) with ordinality as typed(song, place)
    where btrim(song) <> '';
  if picked is null then
    raise exception 'No songs';
  end if;

  update public.song_credits as c
    set balance = c.balance - cardinality(picked), updated_at = now()
    where c.email = owner and c.balance >= cardinality(picked)
    returning c.balance into left_over;
  if not found then
    raise exception 'Not enough credits';
  end if;

  -- One insert, so the alert lists them together; the checks on song_requests still apply.
  insert into public.song_requests (song, name, email, lang, form, paid_at)
    select song, spend_song_credits.name, owner, spend_song_credits.lang, form.id, now()
    from unnest(picked) with ordinality as listed(song, place), (select gen_random_uuid() as id) as form
    order by place;
  return left_over;
end;
$$;
revoke all on function public.spend_song_credits(text[], text, text) from public, anon;
grant execute on function public.spend_song_credits(text[], text, text) to authenticated;

-- The mail a visitor gets once their payment arrived: how many songs they
-- can ask for and where. `songs` are the ones the payment itself paid for,
-- which only a form from before credits has (its songs were saved first).
create function public.song_request_receipt(lang text, songs text[], left_over integer)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  en constant boolean := lang = 'en';
  any_songs constant boolean := coalesce(cardinality(songs), 0) > 0;
  subject constant text := case when en then 'We got your request' else 'Λάβαμε την παραγγελιά σου' end;
  title constant text := case when en then 'Thank you' else 'Ευχαριστούμε' end;
  lead constant text := case
    when any_songs then case when en then 'Payment received. We''re preparing your songs:'
                                     else 'Η πληρωμή έγινε. Ετοιμάζουμε τα τραγούδια σου:' end
    else case when en then 'Payment received.' else 'Η πληρωμή έγινε.' end
  end;
  -- The site's name goes between these two, as a link.
  before_site constant text := case when en then 'They''ll be on ' else 'Θα είναι στο ' end;
  after_site constant text := case when en then ' within 24 hours, and we''ll email you when they''re up.'
                                           else ' μέσα σε 24 ώρες και θα σου στείλουμε email μόλις ανέβουν.' end;
  -- The songs left to ask for; again the site's name goes in between.
  before_left constant text := case
    when en and left_over = 1 then 'You have one song' || case when any_songs then ' left' else '' end || '. Ask for it whenever you like on '
    when en then 'You have ' || left_over || ' songs' || case when any_songs then ' left' else '' end || '. Ask for them whenever you like on '
    when left_over = 1 then case when any_songs then 'Σου μένει ακόμα' else 'Έχεις' end || ' ένα τραγούδι. Ζήτα το όποτε θέλεις από το '
    else case when any_songs then 'Σου μένουν ακόμα ' else 'Έχεις ' end || left_over || ' τραγούδια. Ζήτα τα όποτε θέλεις από το '
  end;
  after_left constant text := case when en then ', signing in with this email.' else ', μπαίνοντας με αυτό το email.' end;
  reply constant text := case when en then 'To change anything, reply to this email.'
                                      else 'Αν θες να αλλάξεις κάτι, απάντησε σε αυτό το email.' end;
  site constant text := 'https://www.penies.gr' || case when en then '/en' else '' end;
  serif constant text := 'font-family:Georgia,Times New Roman,serif;';
  sans constant text := 'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;';
  paragraph constant text := '<p style="margin:22px 0 0;' || sans || 'font-size:16px;line-height:26px;color:#f3ece0;">';
  link constant text := '<a href="' || site || '" style="color:#f4cf82;text-decoration:underline;">penies.gr</a>';
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
      case when any_songs then before_site || 'penies.gr' || after_site end,
      case when left_over > 0 then before_left || 'penies.gr' || after_left end,
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
      || case when any_songs then
           '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0d0b09" '
           || 'style="margin-top:22px;background:#0d0b09;border:1px solid #2d2a25;border-radius:16px;border-collapse:separate;">'
           || coalesce(setlist, '')
           || '</table>'
           || paragraph || before_site || link || after_site || '</p>'
         else '' end
      || case when left_over > 0 then paragraph || before_left || link || after_left || '</p>' else '' end
      || '</td></tr>'
      || '<tr><td style="padding:20px 6px 0;' || sans || 'font-size:13px;line-height:20px;color:#a89e8d;">' || reply || '</td></tr>'
      || '</table>'
      || '</td></tr></table>'
      || '</body></html>'
  );
end;
$$;
revoke all on function public.song_request_receipt(text, text[], integer) from public, anon, authenticated;
drop function public.song_request_receipt(text, text[]);

-- As before (signature and events), and now: the payment is recorded once by
-- its Checkout Session and buys a pack of credits for the signed-in visitor
-- whose id the form gave the payment page; the mail says how many they have.
-- A payment from a page open since before credits still names a request
-- form (or nothing): that form's songs are marked paid and use up as much of
-- the pack as there are of them.
create or replace function public.stripe_webhook(json)
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
  pack constant integer := public.song_pack();
  event jsonb;
  checkout jsonb;
  reference text;
  form uuid;
  payer text;
  ids uuid[];
  songs text[];
  lang text;
  owner text;
  counted integer;
  left_over integer;
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
  checkout := event #> '{data,object}';
  -- A payment that is still on its way (a bank transfer) comes back later as async_payment_succeeded.
  if coalesce(event ->> 'type', '') not in ('checkout.session.completed', 'checkout.session.async_payment_succeeded')
    or checkout ->> 'payment_status' = 'unpaid'
  then
    return;
  end if;

  reference := checkout ->> 'client_reference_id';
  payer := nullif(lower(btrim(checkout #>> '{customer_details,email}')), '');
  if reference ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
    -- The form gives the payment page the signed-in visitor's id: the pack
    -- goes under the email they sign in with, whatever email they pay with.
    select lower(u.email) into owner from auth.users as u
      where u.id = reference::uuid and u.email_confirmed_at is not null;
    if owner is null then
      -- Not a visitor: the id of a request form whose songs were saved before paying.
      form := reference::uuid;
      -- Marked before credits existed: an old event sent again.
      if exists (select from public.song_requests as r where r.form = reference::uuid and r.paid_at is not null) then
        return;
      end if;
      select (array_agg(r.id order by r.seq))[1:pack], (array_agg(r.song order by r.seq))[1:pack], min(r.lang), min(r.email)
        into ids, songs, lang, owner
        from public.song_requests as r
        where r.form = reference::uuid;
    end if;
  elsif reference is null and payer is not null then
    -- Paid without going through the form's Pay button (a page open since before
    -- forms had a reference): the last form this email sent. Its rows were
    -- saved by one insert, so they share created_at.
    select (array_agg(r.id order by r.seq))[1:pack], (array_agg(r.song order by r.seq))[1:pack], min(r.lang), min(r.email)
      into ids, songs, lang, owner
      from public.song_requests as r
      where r.email = payer and r.paid_at is null
        and r.created_at = (
          select max(last.created_at) from public.song_requests as last
          where last.email = payer and last.paid_at is null and last.created_at > now() - interval '2 days');
  end if;
  -- With neither a visitor nor a form, the credits wait under the email that paid.
  owner := coalesce(owner, payer);
  if owner is null then
    raise warning 'payment % has no email to keep its credits under', checkout ->> 'id';
    return;
  end if;
  lang := coalesce(lang, case when checkout ->> 'locale' like 'en%' then 'en' else 'el' end);

  -- Stripe may send an event more than once: only the first call for a session counts.
  insert into public.song_payments (session, email, credits, form)
    values (coalesce(checkout ->> 'id', event ->> 'id'), owner, pack, form)
    on conflict (session) do nothing;
  get diagnostics counted = row_count;
  if counted = 0 then
    return;
  end if;

  update public.song_requests as r set paid_at = now() where r.id = any (ids) and r.paid_at is null;
  get diagnostics counted = row_count;
  insert into public.song_credits as c (email, balance) values (owner, pack - counted)
    on conflict (email) do update set balance = c.balance + excluded.balance, updated_at = now()
    returning c.balance into left_over;

  begin
    select decrypted_secret into api_key from vault.decrypted_secrets where name = 'resend_api_key';
    if api_key is not null then
      mail := public.song_request_receipt(lang, songs, left_over);
      perform net.http_post(
        url := 'https://api.resend.com/emails',
        headers := jsonb_build_object('Authorization', 'Bearer ' || api_key, 'Content-Type', 'application/json'),
        body := jsonb_build_object(
          'from', 'Πενιές <paraggelies@penies.gr>',
          'to', jsonb_build_array(owner),
          'reply_to', 'pkakelas@gmail.com',
          'subject', mail ->> 'subject',
          'html', mail ->> 'html',
          'text', mail ->> 'text'
        )
      );
    end if;
  exception when others then
    -- A mail that cannot be written must not undo the payment.
    raise warning 'payment confirmation not sent: %', sqlerrm;
  end;
end;
$$;

-- The alert says whether the songs are paid for: the form's are not yet when
-- it goes out (they are saved before the payment), songs asked for with
-- credits are. Only that line changes.
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
        'from', 'Penia <onboarding@resend.dev>',
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
          'Requests: https://penia-one.vercel.app/admin'
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
