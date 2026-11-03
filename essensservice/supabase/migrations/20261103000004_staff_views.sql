-- Lesefunktionen für Büro und Küche (Listen, Tagesansicht, Verlauf, Protokoll).

create or replace function public.staff_me()
returns jsonb language sql stable security definer set search_path = public, pg_temp
as $$
  select jsonb_build_object('user_id', user_id, 'name', name, 'role', role)
    from public.staff where user_id = auth.uid() and active;
$$;

create or replace function public.office_drivers()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v jsonb;
begin
  perform public.require_role(array['buero']::public.staff_role[]);
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', d.id, 'name', d.name, 'customer_hint', d.customer_hint, 'phone', d.phone, 'active', d.active,
      'link', (select jsonb_build_object('created_at', t.created_at, 'last_used_at', t.last_used_at)
                 from public.access_tokens t where t.driver_id = d.id and t.revoked_at is null),
      'push', exists (select 1 from public.push_subscriptions p where p.driver_id = d.id and p.revoked_at is null),
      'last_order', (select max(o.service_date) from public.orders o where o.driver_id = d.id and o.status = 'bestellt'))
    order by d.active desc, d.name), '[]'::jsonb) into v
  from public.drivers d;
  return v;
end;
$$;

create or replace function public.office_couriers()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v jsonb;
begin
  perform public.require_role(array['buero']::public.staff_role[]);
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'active', c.active,
      'link', (select jsonb_build_object('created_at', t.created_at, 'last_used_at', t.last_used_at)
                 from public.access_tokens t where t.courier_id = c.id and t.revoked_at is null))
    order by c.active desc, c.name), '[]'::jsonb) into v
  from public.couriers c;
  return v;
end;
$$;

-- Alles für einen Liefertag: Bestellungen mit Standort und Gruppe, Gruppen, Fahrer ohne Bestellung.
create or replace function public.office_day(p_date date)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v jsonb;
begin
  perform public.require_role(array['buero']::public.staff_role[]);
  select jsonb_build_object(
    'service_date', p_date,
    'now', public.app_now(),
    'order_deadline', public.order_deadline(p_date),
    'location_deadline', public.location_deadline(p_date),
    'meal', (select jsonb_build_object('name', name, 'available', available) from public.daily_meals where service_date = p_date),
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'order_id', o.id, 'driver_id', d.id, 'driver_name', d.name, 'customer_hint', d.customer_hint,
        'status', public.effective_status(o.status, o.delivery_status, o.service_date),
        'note', o.note, 'updated_at', o.updated_at, 'updated_by', o.updated_by_kind,
        'location', (select jsonb_build_object('lat', l.lat, 'lng', l.lng, 'address', l.address, 'source', l.source,
                                               'set_at', l.created_at, 'set_by', l.created_by_kind)
                       from public.delivery_locations l where l.order_id = o.id and l.is_current),
        'group_id', a.group_id, 'manual', coalesce(a.manual, false),
        'delivered_at', (select c.confirmed_at from public.delivery_confirmation_items i
                           join public.delivery_confirmations c on c.id = i.confirmation_id where i.order_id = o.id))
        order by d.name)
        from public.orders o
        join public.drivers d on d.id = o.driver_id
        left join public.group_assignments a on a.order_id = o.id
       where o.service_date = p_date), '[]'::jsonb),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'group_id', g.id, 'seq', g.seq, 'released_at', g.released_at,
        'courier', (select c.name from public.delivery_run_groups rg join public.delivery_runs r on r.id = rg.run_id
                      join public.couriers c on c.id = r.courier_id where rg.group_id = g.id),
        'count', (select count(*) from public.group_assignments a join public.orders o on o.id = a.order_id
                   where a.group_id = g.id and o.status = 'bestellt'),
        'manual', exists (select 1 from public.group_assignments a where a.group_id = g.id and a.manual))
        order by g.seq)
        from public.delivery_groups g where g.service_date = p_date), '[]'::jsonb),
    'drivers_without_order', coalesce((
      select jsonb_agg(jsonb_build_object('driver_id', d.id, 'name', d.name) order by d.name)
        from public.drivers d
       where d.active and not exists (select 1 from public.orders o
                                       where o.driver_id = d.id and o.service_date = p_date and o.status = 'bestellt')), '[]'::jsonb)
  ) into v;
  return v;
end;
$$;

create or replace function public.office_location_history(p_order uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v jsonb;
begin
  perform public.require_role(array['buero']::public.staff_role[]);
  select coalesce(jsonb_agg(jsonb_build_object(
      'lat', l.lat, 'lng', l.lng, 'address', l.address, 'source', l.source, 'accuracy_m', l.accuracy_m,
      'set_at', l.created_at, 'set_by', l.created_by_kind, 'current', l.is_current,
      'staff_name', (select s.name from public.staff s where s.user_id = l.created_by_staff))
    order by l.created_at desc), '[]'::jsonb) into v
  from public.delivery_locations l where l.order_id = p_order;
  return v;
end;
$$;

create or replace function public.office_notifications(p_date date)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v jsonb;
begin
  perform public.require_role(array['buero']::public.staff_role[]);
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', n.id, 'driver_name', d.name, 'status', n.status, 'attempts', n.attempts,
      'last_error', n.last_error, 'created_at', n.created_at, 'sent_at', n.sent_at)
    order by n.created_at desc), '[]'::jsonb) into v
  from public.notifications n
  join public.orders o on o.id = n.order_id
  join public.drivers d on d.id = n.driver_id
  where o.service_date = p_date;
  return v;
end;
$$;

create or replace function public.office_audit(p_date date, p_limit integer default 200)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v jsonb;
begin
  perform public.require_role(array['buero']::public.staff_role[]);
  select coalesce(jsonb_agg(x order by (x->>'id')::bigint desc), '[]'::jsonb) into v from (
    select jsonb_build_object(
      'id', a.id, 'at', a.at, 'actor_kind', a.actor_kind, 'action', a.action, 'entity', a.entity, 'details', a.details,
      'actor_name', coalesce(
        (select s.name from public.staff s where s.user_id = a.actor_id),
        (select d.name from public.drivers d where d.id = a.actor_id),
        (select c.name from public.couriers c where c.id = a.actor_id)),
      'driver_name', (select d.name from public.orders o join public.drivers d on d.id = o.driver_id
                       where a.entity = 'order' and o.id = a.entity_id)) as x
      from public.audit_log a
     where a.service_date = p_date or (a.service_date is null and (a.at at time zone 'Europe/Berlin')::date = p_date)
     order by a.id desc
     limit least(greatest(coalesce(p_limit, 200), 1), 1000)) s;
  return v;
end;
$$;

-- Tagesgerichte im Überblick (Küche und Büro)
create or replace function public.kitchen_meals(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v jsonb;
begin
  perform public.require_role(array['kueche', 'buero']::public.staff_role[]);
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'service_date', m.service_date, 'name', m.name, 'description', m.description,
      'internal_price', m.internal_price, 'available', m.available, 'updated_at', m.updated_at,
      'orders', (select count(*) from public.orders o where o.meal_id = m.id and o.status = 'bestellt'))
    order by m.service_date), '[]'::jsonb) into v
  from public.daily_meals m where m.service_date between p_from and p_to;
  return v;
end;
$$;

revoke execute on function
  public.staff_me(), public.office_drivers(), public.office_couriers(), public.office_day(date),
  public.office_location_history(uuid), public.office_notifications(date), public.office_audit(date, integer),
  public.kitchen_meals(date, date)
from public, anon;
grant execute on function
  public.staff_me(), public.office_drivers(), public.office_couriers(), public.office_day(date),
  public.office_location_history(uuid), public.office_notifications(date), public.office_audit(date, integer),
  public.kitchen_meals(date, date)
to authenticated, service_role;
