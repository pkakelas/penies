-- The confirmation mail says «θα σου στείλουμε email», as the request form
-- does since it stopped saying «θα σου γράψουμε». Only that phrase changes;
-- the rest of the function is as it was.
create or replace function public.song_request_receipt(lang text, songs text[])
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
                                           else ' μέσα σε 24 ώρες και θα σου στείλουμε email μόλις ανέβουν.' end;
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
