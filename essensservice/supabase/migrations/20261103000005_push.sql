-- Web-Push-Versand: Nachrichten reservieren, Ergebnis speichern, Wiederholungen planen.
-- Nur für den Server (service_role). Jede Nachricht wird höchstens einmal erfolgreich zugestellt.

alter table public.notifications add column claimed_until timestamptz;

-- Reserviert versandbereite Nachrichten (optional nur bestimmte IDs) für 2 Minuten.
-- p_force: Wartezeit bis zum nächsten Versuch ignorieren (Knopf „Erneut senden“).
create or replace function public.push_claim(p_ids uuid[] default null, p_force boolean default false, p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare v jsonb;
begin
  with c as (
    select n.id from public.notifications n
     where n.status in ('ausstehend', 'fehlgeschlagen')
       and n.attempts < 5
       and (n.claimed_until is null or n.claimed_until < public.app_now())
       and (p_ids is null or n.id = any (p_ids))
       and (p_force or p_ids is not null or n.next_attempt_at is null or n.next_attempt_at <= public.app_now())
     order by n.created_at
     limit least(greatest(coalesce(p_limit, 100), 1), 500)
     for update skip locked
  ), u as (
    update public.notifications n
       set claimed_until = public.app_now() + interval '2 minutes', attempts = n.attempts + 1
      from c where n.id = c.id
    returning n.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', u.id, 'order_id', u.order_id, 'attempts', u.attempts,
      'confirmed_at', (select cf.confirmed_at from public.delivery_confirmation_items i
                         join public.delivery_confirmations cf on cf.id = i.confirmation_id where i.order_id = u.order_id),
      'subscriptions', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'endpoint', p.endpoint, 'p256dh', p.p256dh, 'auth', p.auth))
                                   from public.push_subscriptions p where p.driver_id = u.driver_id and p.revoked_at is null), '[]'::jsonb))), '[]'::jsonb)
    into v from u;
  return v;
end;
$$;

-- Ergebnis eines Versandversuchs. Abgelaufene Abos (404/410) werden gesperrt.
create or replace function public.push_result(
  p_id uuid, p_status public.notification_status, p_error text default null, p_revoke uuid[] default null)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if p_revoke is not null then
    update public.push_subscriptions set revoked_at = public.app_now() where id = any (p_revoke) and revoked_at is null;
  end if;
  update public.notifications
     set status = p_status,
         last_error = left(p_error, 500),
         sent_at = case when p_status = 'gesendet' then public.app_now() else sent_at end,
         -- Wiederholung nach 1, 4, 9, 16 Minuten
         next_attempt_at = case when p_status = 'fehlgeschlagen' then public.app_now() + make_interval(mins => attempts * attempts) end,
         claimed_until = null
   where id = p_id and status <> 'gesendet';
end;
$$;

-- IDs fehlgeschlagener Nachrichten eines Liefertags (für „Erneut senden“ im Büro).
create or replace function public.office_failed_notification_ids(p_date date)
returns uuid[] language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v uuid[];
begin
  perform public.require_role(array['buero']::public.staff_role[]);
  select array_agg(n.id) into v from public.notifications n join public.orders o on o.id = n.order_id
   where o.service_date = p_date and n.status in ('fehlgeschlagen', 'ausstehend');
  return coalesce(v, '{}');
end;
$$;

revoke execute on function public.push_claim(uuid[], boolean, integer), public.push_result(uuid, public.notification_status, text, uuid[]),
  public.office_failed_notification_ids(date) from public, anon, authenticated;
grant execute on function public.push_claim(uuid[], boolean, integer), public.push_result(uuid, public.notification_status, text, uuid[])
  to service_role;
grant execute on function public.office_failed_notification_ids(date) to authenticated, service_role;
