-- Which pack a payment bought, told more surely. Each Payment Link carries
-- its number of songs in its metadata (songs = 1, 3 or 5), which Stripe copies
-- to the Checkout Session. Without it, the amount: in euro cents, which with
-- Adaptive Pricing (a customer paying in their own currency) is in
-- currency_conversion, not in the session's own amounts. Failing both, three.
create function public.song_pack_paid(checkout jsonb)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when checkout #>> '{metadata,songs}' in ('1', '3', '5') then (checkout #>> '{metadata,songs}')::integer
    when lower(checkout ->> 'currency') = 'eur' and checkout ->> 'amount_subtotal' ~ '^\d{1,9}$'
      then public.song_pack((checkout ->> 'amount_subtotal')::integer)
    when lower(checkout #>> '{currency_conversion,source_currency}') = 'eur'
      and checkout #>> '{currency_conversion,amount_subtotal}' ~ '^\d{1,9}$'
      then public.song_pack((checkout #>> '{currency_conversion,amount_subtotal}')::integer)
    else public.song_pack()
  end
$$;
revoke all on function public.song_pack_paid(jsonb) from public, anon, authenticated;

-- As before, but the pack comes from song_pack_paid().
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
  -- How many songs this payment buys.
  pack integer;
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

  pack := public.song_pack_paid(checkout);
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
