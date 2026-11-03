-- Agrarlohn Essensservice – Geschäftslogik
-- Alle Regeln (Fristen, Bewertungspflicht, Rollen, Gruppierung) werden hier
-- serverseitig durchgesetzt. Fehler werden als Code-Text gemeldet (z. B. 'BESTELLSCHLUSS'),
-- die Oberfläche übersetzt sie in verständliche Meldungen.

-- ===========================================================================
-- Zeit
-- ===========================================================================
create or replace function public.berlin_today(p_now timestamptz default public.app_now())
returns date language sql stable
as $$ select (p_now at time zone 'Europe/Berlin')::date; $$;

-- 09:00 Uhr Ortszeit des Liefertags (Sommer-/Winterzeit über die Zeitzonendatenbank)
create or replace function public.order_deadline(p_date date)
returns timestamptz language sql immutable
as $$ select (p_date + time '09:00') at time zone 'Europe/Berlin'; $$;

-- 10:30 Uhr Ortszeit: Standortschluss und endgültige Liefergruppen
create or replace function public.location_deadline(p_date date)
returns timestamptz language sql immutable
as $$ select (p_date + time '10:30') at time zone 'Europe/Berlin'; $$;

-- Für welchen Tag ein Fahrer gerade bestellen kann: bis 09:00 heute, danach morgen.
create or replace function public.driver_order_date(p_now timestamptz default public.app_now())
returns date language sql stable
as $$
  select case when p_now < public.order_deadline(public.berlin_today(p_now))
              then public.berlin_today(p_now)
              else public.berlin_today(p_now) + 1 end;
$$;

-- ===========================================================================
-- Hilfsfunktionen
-- ===========================================================================
create or replace function public.distance_m(lat1 float8, lng1 float8, lat2 float8, lng2 float8)
returns float8 language sql immutable
as $$
  select 2 * 6371008.8 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)));
$$;

create or replace function public.hash_token(p_token text)
returns bytea language sql immutable set search_path = public, extensions, pg_temp
as $$ select extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'); $$;

create or replace function public.log_audit(
  p_actor public.actor_kind, p_actor_id uuid, p_action text, p_entity text,
  p_entity_id uuid, p_date date, p_details jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public, pg_temp
as $$
  insert into public.audit_log (actor_kind, actor_id, action, entity, entity_id, service_date, details)
  values (p_actor, p_actor_id, p_action, p_entity, p_entity_id, p_date, coalesce(p_details, '{}'::jsonb));
$$;

-- Prüft die Rolle des angemeldeten Mitarbeiters, liefert Nutzer-ID und Rolle.
create or replace function public.require_role(p_roles public.staff_role[])
returns public.staff_role language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_role public.staff_role;
begin
  select role into v_role from public.staff where user_id = auth.uid() and active;
  if v_role is null or not (v_role = any (p_roles)) then
    raise exception 'KEINE_BERECHTIGUNG' using errcode = '42501';
  end if;
  return v_role;
end;
$$;

create or replace function public.actor_of(p_role public.staff_role)
returns public.actor_kind language sql immutable
as $$ select case p_role when 'buero' then 'buero'::public.actor_kind else 'kueche'::public.actor_kind end; $$;

-- Löst einen persönlichen Fahrerlink auf. Ungültige oder gesperrte Links → Fehler.
create or replace function public.token_driver(p_token text)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_driver uuid;
begin
  update public.access_tokens t set last_used_at = public.app_now()
    from public.drivers d
   where t.token_hash = public.hash_token(coalesce(p_token, ''))
     and t.subject = 'fahrer' and t.revoked_at is null
     and d.id = t.driver_id and d.active
  returning t.driver_id into v_driver;
  if v_driver is null then
    raise exception 'UNGUELTIGER_LINK' using errcode = '28000';
  end if;
  return v_driver;
end;
$$;

create or replace function public.token_courier(p_token text)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_courier uuid;
begin
  update public.access_tokens t set last_used_at = public.app_now()
    from public.couriers c
   where t.token_hash = public.hash_token(coalesce(p_token, ''))
     and t.subject = 'lieferfahrer' and t.revoked_at is null
     and c.id = t.courier_id and c.active
  returning t.courier_id into v_courier;
  if v_courier is null then
    raise exception 'UNGUELTIGER_LINK' using errcode = '28000';
  end if;
  return v_courier;
end;
$$;

-- Das zuletzt tatsächlich erhaltene Essen, falls es noch nicht bewertet ist.
create or replace function public.pending_rating_order(p_driver uuid)
returns uuid language sql stable security definer set search_path = public, pg_temp
as $$
  select last.id
    from (select o.id
            from public.orders o
            join public.delivery_confirmation_items i on i.order_id = o.id
           where o.driver_id = p_driver and o.status = 'bestellt'
           order by o.service_date desc
           limit 1) last
   where not exists (select 1 from public.ratings r where r.order_id = last.id);
$$;

-- Status aus Sicht der Oberfläche, inkl. abgeleitetem „in_vorbereitung“.
create or replace function public.effective_status(p_status public.order_status,
  p_delivery public.delivery_status, p_date date)
returns text language sql stable
as $$
  select case
    when p_status = 'storniert' then 'storniert'
    when p_delivery <> 'offen' then p_delivery::text
    when public.app_now() >= public.order_deadline(p_date) then 'in_vorbereitung'
    else 'offen' end;
$$;

-- ===========================================================================
-- Liefergruppen (maximal 500 m paarweise, manuelle Zuordnungen haben Vorrang)
-- ===========================================================================
create or replace function public.next_group_seq(p_date date)
returns integer language sql stable security definer set search_path = public, pg_temp
as $$
  select min(s)::int
    from generate_series(1, (select coalesce(max(seq), 0) + 1 from public.delivery_groups where service_date = p_date)) s
   where not exists (select 1 from public.delivery_groups g where g.service_date = p_date and g.seq = s);
$$;

create or replace function public.cleanup_groups(p_date date)
returns void language sql security definer set search_path = public, pg_temp
as $$
  delete from public.delivery_groups g
   where g.service_date = p_date
     and not exists (select 1 from public.group_assignments a where a.group_id = g.id)
     and not exists (select 1 from public.delivery_confirmations c where c.group_id = g.id)
     and not exists (select 1 from public.delivery_run_groups r where r.group_id = g.id);
$$;

-- Automatische Gruppierung eines Liefertags.
-- Verfahren: agglomeratives Clustering mit vollständiger Verknüpfung (complete linkage).
-- Zwei Gruppen werden nur zusammengelegt, wenn danach ALLE Standorte paarweise höchstens
-- 500 m auseinanderliegen. Berücksichtigt werden nur offene Bestellungen mit Koordinaten
-- und ohne manuelle Büro-Zuordnung. Gruppen mit manuellen Zuordnungen bleiben unberührt.
create or replace function public.regroup_day(p_date date)
returns integer language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  c_max constant float8 := 500;
  v_ids uuid[]; v_lat float8[]; v_lng float8[];
  n int; i int; j int; k int; a int; b int; ba int; bb int;
  d float8[]; alive boolean[]; cl int[];
  best float8; v float8;
  r record; v_group uuid; v_used uuid[] := '{}'; v_count int := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('essen-gruppen-' || p_date::text, 0));

  select array_agg(o.id order by o.created_at, o.id),
         array_agg(l.lat order by o.created_at, o.id),
         array_agg(l.lng order by o.created_at, o.id)
    into v_ids, v_lat, v_lng
    from public.orders o
    join public.delivery_locations l on l.order_id = o.id and l.is_current and l.lat is not null
   where o.service_date = p_date and o.status = 'bestellt' and o.delivery_status = 'offen'
     and not exists (select 1 from public.group_assignments g where g.order_id = o.id and g.manual);
  v_ids := coalesce(v_ids, '{}');
  n := coalesce(array_length(v_ids, 1), 0);

  -- Automatische Zuordnungen, die nicht mehr passen (storniert, Standort entfernt), lösen.
  delete from public.group_assignments ga
   using public.orders o
   where ga.order_id = o.id and o.service_date = p_date and not ga.manual
     and o.delivery_status = 'offen' and not (o.id = any (v_ids));

  if n > 0 then
    d := array_fill(0::float8, array[n * n]);
    alive := array_fill(true, array[n]);
    cl := array(select generate_series(1, n));
    for i in 1 .. n loop
      for j in i + 1 .. n loop
        v := public.distance_m(v_lat[i], v_lng[i], v_lat[j], v_lng[j]);
        d[(i - 1) * n + j] := v;
        d[(j - 1) * n + i] := v;
      end loop;
    end loop;

    loop
      best := null;
      for a in 1 .. n loop
        continue when not alive[a];
        for b in a + 1 .. n loop
          continue when not alive[b];
          v := d[(a - 1) * n + b];
          if v <= c_max and (best is null or v < best) then
            best := v; ba := a; bb := b;
          end if;
        end loop;
      end loop;
      exit when best is null;
      -- bb in ba aufgehen lassen; Abstand neu = größter Einzelabstand (complete linkage)
      for k in 1 .. n loop
        if alive[k] and k <> ba and k <> bb then
          v := greatest(d[(ba - 1) * n + k], d[(bb - 1) * n + k]);
          d[(ba - 1) * n + k] := v;
          d[(k - 1) * n + ba] := v;
        end if;
      end loop;
      alive[bb] := false;
      for k in 1 .. n loop
        if cl[k] = bb then cl[k] := ba; end if;
      end loop;
    end loop;

    for r in
      select array_agg(v_ids[s.idx] order by s.idx) as members
        from (select cl[x] as root, x as idx from generate_series(1, n) x) s
       group by s.root
       order by count(*) desc, min(s.idx)
    loop
      -- vorhandene automatische Gruppe mit der größten Überschneidung weiterverwenden
      select ga.group_id into v_group
        from public.group_assignments ga
        join public.delivery_groups g on g.id = ga.group_id
       where ga.order_id = any (r.members) and not ga.manual and g.service_date = p_date
         and not (ga.group_id = any (v_used))
         and not exists (select 1 from public.group_assignments m where m.group_id = ga.group_id and m.manual)
         and not exists (select 1 from public.delivery_run_groups rg where rg.group_id = ga.group_id)
       group by ga.group_id, g.seq
       order by count(*) desc, g.seq
       limit 1;
      if v_group is null then
        insert into public.delivery_groups (service_date, seq)
        values (p_date, public.next_group_seq(p_date))
        returning id into v_group;
      end if;
      v_used := v_used || v_group;

      insert into public.group_assignments (order_id, group_id, manual, assigned_by_kind)
      select m, v_group, false, 'system' from unnest(r.members) m
      on conflict (order_id) do update
        set group_id = excluded.group_id, assigned_at = public.app_now(),
            assigned_by_kind = 'system', assigned_by_staff = null
        where public.group_assignments.group_id <> excluded.group_id
          and not public.group_assignments.manual;
      v_count := v_count + 1;
    end loop;
  end if;

  perform public.cleanup_groups(p_date);
  return v_count;
end;
$$;

-- Bis 10:30 löst jede relevante Änderung eine neue Gruppierung aus; danach sind die
-- Gruppen endgültig und werden nur noch vom Büro verändert.
create or replace function public.maybe_regroup(p_date date)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if public.app_now() < public.location_deadline(p_date) then
    perform public.regroup_day(p_date);
  end if;
end;
$$;

-- ===========================================================================
-- Fahrer (Aufruf nur durch den Server mit dem Token aus dem persönlichen Link)
-- ===========================================================================
create or replace function public.driver_state(p_token text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_driver uuid := public.token_driver(p_token);
  v_now timestamptz := public.app_now();
  v_today date := public.berlin_today(v_now);
  v_order_date date := public.driver_order_date(v_now);
  v_pending uuid := public.pending_rating_order(v_driver);
  v_result jsonb;
begin
  select jsonb_build_object(
    'now', v_now,
    'driver', jsonb_build_object('name', d.name),
    'push_subscribed', exists (select 1 from public.push_subscriptions p where p.driver_id = d.id and p.revoked_at is null),
    'pending_rating', (
      select jsonb_build_object('order_id', o.id, 'service_date', o.service_date, 'meal_name', m.name)
        from public.orders o join public.daily_meals m on m.id = o.meal_id where o.id = v_pending),
    'order_day', jsonb_build_object(
      'service_date', v_order_date,
      'order_deadline', public.order_deadline(v_order_date),
      'meal', (select jsonb_build_object('name', m.name, 'description', m.description, 'available', m.available)
                 from public.daily_meals m where m.service_date = v_order_date),
      'order', (select jsonb_build_object('id', o.id, 'status', o.status, 'note', o.note)
                  from public.orders o where o.driver_id = d.id and o.service_date = v_order_date),
      'can_order', v_pending is null and v_now < public.order_deadline(v_order_date)
                   and exists (select 1 from public.daily_meals m where m.service_date = v_order_date and m.available)),
    'today', (
      select jsonb_build_object(
        'service_date', o.service_date,
        'order_id', o.id,
        'meal_name', m.name,
        'status', public.effective_status(o.status, o.delivery_status, o.service_date),
        'location_deadline', public.location_deadline(o.service_date),
        'can_change_location', o.status = 'bestellt' and o.delivery_status = 'offen'
                               and v_now < public.location_deadline(o.service_date),
        'location', (select jsonb_build_object('lat', l.lat, 'lng', l.lng, 'address', l.address,
                                               'source', l.source, 'set_at', l.created_at)
                       from public.delivery_locations l where l.order_id = o.id and l.is_current),
        'delivery', (select jsonb_build_object('confirmed_at', c.confirmed_at, 'lat', c.lat, 'lng', c.lng,
                                               'place_note', c.place_note)
                       from public.delivery_confirmation_items i
                       join public.delivery_confirmations c on c.id = i.confirmation_id
                      where i.order_id = o.id))
        from public.orders o join public.daily_meals m on m.id = o.meal_id
       where o.driver_id = d.id and o.service_date = v_today and o.status = 'bestellt')
  ) into v_result
  from public.drivers d where d.id = v_driver;
  return v_result;
end;
$$;

create or replace function public.driver_rate(p_token text, p_order_id uuid, p_score integer)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_driver uuid := public.token_driver(p_token);
  v_order public.orders;
begin
  if p_score is null or p_score not between 1 and 5 then
    raise exception 'UNGUELTIGE_BEWERTUNG';
  end if;
  -- Bewertet werden kann nur das zuletzt tatsächlich erhaltene, noch offene Essen.
  if p_order_id is distinct from public.pending_rating_order(v_driver) then
    raise exception 'KEINE_BEWERTUNG_OFFEN';
  end if;
  select * into v_order from public.orders where id = p_order_id;
  insert into public.ratings (order_id, driver_id, meal_id, service_date, score)
  values (v_order.id, v_driver, v_order.meal_id, v_order.service_date, p_score);
  perform public.log_audit('fahrer', v_driver, 'bewertet', 'order', v_order.id, v_order.service_date,
                           jsonb_build_object('punkte', p_score));
end;
$$;

create or replace function public.driver_place_order(p_token text, p_service_date date, p_note text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_driver uuid := public.token_driver(p_token);
  v_now timestamptz := public.app_now();
  v_meal public.daily_meals;
  v_id uuid;
begin
  if p_service_date is null or p_service_date < public.berlin_today(v_now) then
    raise exception 'DATUM_UNGUELTIG';
  end if;
  if v_now >= public.order_deadline(p_service_date) then
    raise exception 'BESTELLSCHLUSS';
  end if;
  if public.pending_rating_order(v_driver) is not null then
    raise exception 'BEWERTUNG_AUSSTEHEND';
  end if;
  select * into v_meal from public.daily_meals where service_date = p_service_date;
  if v_meal.id is null then raise exception 'KEIN_TAGESGERICHT'; end if;
  if not v_meal.available then raise exception 'GERICHT_NICHT_VERFUEGBAR'; end if;

  insert into public.orders (driver_id, service_date, meal_id, note, updated_by_kind)
  values (v_driver, p_service_date, v_meal.id, nullif(btrim(p_note), ''), 'fahrer')
  on conflict on constraint orders_one_per_driver_day do update
    set status = 'bestellt', note = excluded.note, updated_at = v_now, updated_by_kind = 'fahrer'
  returning id into v_id;

  perform public.log_audit('fahrer', v_driver, 'bestellt', 'order', v_id, p_service_date,
                           jsonb_build_object('hinweis', nullif(btrim(p_note), '')));
  perform public.maybe_regroup(p_service_date);
  return v_id;
end;
$$;

create or replace function public.driver_cancel_order(p_token text, p_service_date date)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_driver uuid := public.token_driver(p_token);
  v_id uuid;
begin
  if public.app_now() >= public.order_deadline(p_service_date) then
    raise exception 'BESTELLSCHLUSS';
  end if;
  update public.orders set status = 'storniert', updated_at = public.app_now(), updated_by_kind = 'fahrer'
   where driver_id = v_driver and service_date = p_service_date and status = 'bestellt'
  returning id into v_id;
  if v_id is null then raise exception 'KEINE_BESTELLUNG'; end if;
  delete from public.group_assignments where order_id = v_id;
  perform public.cleanup_groups(p_service_date);
  perform public.log_audit('fahrer', v_driver, 'storniert', 'order', v_id, p_service_date);
  perform public.maybe_regroup(p_service_date);
end;
$$;

create or replace function public.driver_set_location(
  p_token text, p_service_date date, p_lat float8, p_lng float8,
  p_address text, p_source public.location_source, p_accuracy real default null)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_driver uuid := public.token_driver(p_token);
  v_order public.orders;
begin
  if p_source is null or p_source = 'buero' then raise exception 'UNGUELTIGE_QUELLE'; end if;
  if public.app_now() >= public.location_deadline(p_service_date) then
    raise exception 'STANDORTSCHLUSS';
  end if;
  select * into v_order from public.orders
   where driver_id = v_driver and service_date = p_service_date and status = 'bestellt';
  if v_order.id is null then raise exception 'KEINE_BESTELLUNG'; end if;
  if v_order.delivery_status <> 'offen' then raise exception 'BEREITS_UNTERWEGS'; end if;

  update public.delivery_locations set is_current = false where order_id = v_order.id and is_current;
  insert into public.delivery_locations (order_id, lat, lng, address, accuracy_m, source, created_by_kind)
  values (v_order.id, p_lat, p_lng, nullif(btrim(p_address), ''), p_accuracy, p_source, 'fahrer');
  update public.orders set updated_at = public.app_now() where id = v_order.id;

  perform public.log_audit('fahrer', v_driver, 'standort', 'order', v_order.id, p_service_date,
    jsonb_build_object('quelle', p_source, 'lat', p_lat, 'lng', p_lng, 'adresse', nullif(btrim(p_address), '')));
  perform public.maybe_regroup(p_service_date);
end;
$$;

create or replace function public.driver_save_push_subscription(
  p_token text, p_endpoint text, p_p256dh text, p_auth text)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_driver uuid := public.token_driver(p_token);
begin
  insert into public.push_subscriptions (driver_id, endpoint, p256dh, auth)
  values (v_driver, p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update
    set driver_id = excluded.driver_id, p256dh = excluded.p256dh, auth = excluded.auth,
        revoked_at = null, created_at = public.app_now();
end;
$$;

-- ===========================================================================
-- Büro
-- ===========================================================================
create or replace function public.office_save_driver(
  p_id uuid, p_name text, p_customer_hint text default null, p_phone text default null,
  p_active boolean default true)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  perform public.require_role(array['buero']::public.staff_role[]);
  if p_id is null then
    insert into public.drivers (name, customer_hint, phone, active)
    values (btrim(p_name), nullif(btrim(p_customer_hint), ''), nullif(btrim(p_phone), ''), coalesce(p_active, true))
    returning id into v_id;
  else
    update public.drivers
       set name = btrim(p_name), customer_hint = nullif(btrim(p_customer_hint), ''),
           phone = nullif(btrim(p_phone), ''), active = coalesce(p_active, true), updated_at = public.app_now()
     where id = p_id returning id into v_id;
    if v_id is null then raise exception 'NICHT_GEFUNDEN'; end if;
  end if;
  perform public.log_audit('buero', auth.uid(), case when p_id is null then 'fahrer_angelegt' else 'fahrer_geaendert' end,
                           'driver', v_id, null, jsonb_build_object('name', btrim(p_name), 'aktiv', coalesce(p_active, true)));
  return v_id;
end;
$$;

create or replace function public.office_save_courier(p_id uuid, p_name text, p_active boolean default true)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  perform public.require_role(array['buero']::public.staff_role[]);
  if p_id is null then
    insert into public.couriers (name, active) values (btrim(p_name), coalesce(p_active, true)) returning id into v_id;
  else
    update public.couriers set name = btrim(p_name), active = coalesce(p_active, true) where id = p_id returning id into v_id;
    if v_id is null then raise exception 'NICHT_GEFUNDEN'; end if;
  end if;
  perform public.log_audit('buero', auth.uid(), 'lieferfahrer_gespeichert', 'courier', v_id, null,
                           jsonb_build_object('name', btrim(p_name)));
  return v_id;
end;
$$;

-- Erzeugt einen neuen persönlichen Link. Ein vorhandener Link wird dabei gesperrt.
-- Das Token im Klartext wird nur hier ein einziges Mal zurückgegeben.
create or replace function public.office_issue_token(p_subject public.token_subject, p_id uuid)
returns text language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare v_token text;
begin
  perform public.require_role(array['buero']::public.staff_role[]);
  if p_subject = 'fahrer' and not exists (select 1 from public.drivers where id = p_id) then raise exception 'NICHT_GEFUNDEN'; end if;
  if p_subject = 'lieferfahrer' and not exists (select 1 from public.couriers where id = p_id) then raise exception 'NICHT_GEFUNDEN'; end if;

  update public.access_tokens set revoked_at = public.app_now()
   where revoked_at is null
     and ((p_subject = 'fahrer' and driver_id = p_id) or (p_subject = 'lieferfahrer' and courier_id = p_id));

  v_token := translate(rtrim(encode(extensions.gen_random_bytes(32), 'base64'), '='), '+/', '-_');
  insert into public.access_tokens (subject, driver_id, courier_id, token_hash, created_by)
  values (p_subject,
          case when p_subject = 'fahrer' then p_id end,
          case when p_subject = 'lieferfahrer' then p_id end,
          public.hash_token(v_token), auth.uid());
  perform public.log_audit('buero', auth.uid(), 'link_erzeugt', p_subject::text, p_id, null);
  return v_token;
end;
$$;

create or replace function public.office_revoke_token(p_subject public.token_subject, p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  perform public.require_role(array['buero']::public.staff_role[]);
  update public.access_tokens set revoked_at = public.app_now()
   where revoked_at is null
     and ((p_subject = 'fahrer' and driver_id = p_id) or (p_subject = 'lieferfahrer' and courier_id = p_id));
  perform public.log_audit('buero', auth.uid(), 'link_gesperrt', p_subject::text, p_id, null);
end;
$$;

-- Büro darf jederzeit bestellen oder ändern – ohne Fristen und ohne Bewertungspflicht.
create or replace function public.office_save_order(p_driver uuid, p_service_date date, p_note text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_meal uuid; v_id uuid;
begin
  perform public.require_role(array['buero']::public.staff_role[]);
  select id into v_meal from public.daily_meals where service_date = p_service_date;
  if v_meal is null then raise exception 'KEIN_TAGESGERICHT'; end if;
  insert into public.orders (driver_id, service_date, meal_id, note, updated_by_kind)
  values (p_driver, p_service_date, v_meal, nullif(btrim(p_note), ''), 'buero')
  on conflict on constraint orders_one_per_driver_day do update
    set status = 'bestellt', note = excluded.note, updated_at = public.app_now(), updated_by_kind = 'buero'
  returning id into v_id;
  perform public.log_audit('buero', auth.uid(), 'bestellung_gespeichert', 'order', v_id, p_service_date,
                           jsonb_build_object('hinweis', nullif(btrim(p_note), '')));
  perform public.maybe_regroup(p_service_date);
  return v_id;
end;
$$;

create or replace function public.office_cancel_order(p_order uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_order public.orders;
begin
  perform public.require_role(array['buero']::public.staff_role[]);
  select * into v_order from public.orders where id = p_order for update;
  if v_order.id is null then raise exception 'NICHT_GEFUNDEN'; end if;
  if v_order.delivery_status = 'zugestellt' then raise exception 'BEREITS_ZUGESTELLT'; end if;
  update public.orders set status = 'storniert', delivery_status = 'offen',
         updated_at = public.app_now(), updated_by_kind = 'buero' where id = p_order;
  delete from public.group_assignments where order_id = p_order;
  perform public.cleanup_groups(v_order.service_date);
  perform public.log_audit('buero', auth.uid(), 'storniert', 'order', p_order, v_order.service_date);
  perform public.maybe_regroup(v_order.service_date);
end;
$$;

create or replace function public.office_set_location(p_order uuid, p_lat float8, p_lng float8, p_address text default null)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_order public.orders;
begin
  perform public.require_role(array['buero']::public.staff_role[]);
  select * into v_order from public.orders where id = p_order;
  if v_order.id is null then raise exception 'NICHT_GEFUNDEN'; end if;
  update public.delivery_locations set is_current = false where order_id = p_order and is_current;
  insert into public.delivery_locations (order_id, lat, lng, address, source, created_by_kind, created_by_staff)
  values (p_order, p_lat, p_lng, nullif(btrim(p_address), ''), 'buero', 'buero', auth.uid());
  update public.orders set updated_at = public.app_now() where id = p_order;
  perform public.log_audit('buero', auth.uid(), 'standort', 'order', p_order, v_order.service_date,
                           jsonb_build_object('lat', p_lat, 'lng', p_lng, 'adresse', nullif(btrim(p_address), '')));
  perform public.maybe_regroup(v_order.service_date);
end;
$$;

-- Fahrer in eine Gruppe verschieben (p_group null = neue Gruppe). Wird manuell.
create or replace function public.office_move_order(p_order uuid, p_group uuid default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_order public.orders; v_group uuid := p_group;
begin
  perform public.require_role(array['buero']::public.staff_role[]);
  select * into v_order from public.orders where id = p_order;
  if v_order.id is null or v_order.status <> 'bestellt' then raise exception 'KEINE_BESTELLUNG'; end if;
  if v_order.delivery_status = 'zugestellt' then raise exception 'BEREITS_ZUGESTELLT'; end if;
  perform pg_advisory_xact_lock(hashtextextended('essen-gruppen-' || v_order.service_date::text, 0));
  if v_group is null then
    insert into public.delivery_groups (service_date, seq)
    values (v_order.service_date, public.next_group_seq(v_order.service_date)) returning id into v_group;
  elsif not exists (select 1 from public.delivery_groups where id = v_group and service_date = v_order.service_date) then
    raise exception 'GRUPPE_NICHT_GEFUNDEN';
  end if;
  insert into public.group_assignments (order_id, group_id, manual, assigned_by_kind, assigned_by_staff)
  values (p_order, v_group, true, 'buero', auth.uid())
  on conflict (order_id) do update
    set group_id = excluded.group_id, manual = true, assigned_at = public.app_now(),
        assigned_by_kind = 'buero', assigned_by_staff = auth.uid();
  perform public.cleanup_groups(v_order.service_date);
  perform public.log_audit('buero', auth.uid(), 'gruppe_verschoben', 'order', p_order, v_order.service_date,
                           jsonb_build_object('gruppe', v_group));
  return v_group;
end;
$$;

create or replace function public.office_merge_groups(p_target uuid, p_sources uuid[])
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_date date;
begin
  perform public.require_role(array['buero']::public.staff_role[]);
  select service_date into v_date from public.delivery_groups where id = p_target;
  if v_date is null then raise exception 'GRUPPE_NICHT_GEFUNDEN'; end if;
  if exists (select 1 from unnest(p_sources) s
              where not exists (select 1 from public.delivery_groups g where g.id = s and g.service_date = v_date)) then
    raise exception 'GRUPPE_NICHT_GEFUNDEN';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('essen-gruppen-' || v_date::text, 0));
  update public.group_assignments
     set group_id = p_target, manual = true, assigned_at = public.app_now(),
         assigned_by_kind = 'buero', assigned_by_staff = auth.uid()
   where group_id = any (p_sources) or group_id = p_target;
  perform public.cleanup_groups(v_date);
  perform public.log_audit('buero', auth.uid(), 'gruppen_zusammengelegt', 'group', p_target, v_date,
                           jsonb_build_object('quellen', to_jsonb(p_sources)));
end;
$$;

create or replace function public.office_split_group(p_group uuid, p_orders uuid[])
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_date date; v_new uuid;
begin
  perform public.require_role(array['buero']::public.staff_role[]);
  select service_date into v_date from public.delivery_groups where id = p_group;
  if v_date is null then raise exception 'GRUPPE_NICHT_GEFUNDEN'; end if;
  if coalesce(array_length(p_orders, 1), 0) = 0
     or exists (select 1 from unnest(p_orders) o
                 where not exists (select 1 from public.group_assignments a where a.order_id = o and a.group_id = p_group)) then
    raise exception 'UNGUELTIGE_AUSWAHL';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('essen-gruppen-' || v_date::text, 0));
  insert into public.delivery_groups (service_date, seq) values (v_date, public.next_group_seq(v_date)) returning id into v_new;
  update public.group_assignments
     set group_id = case when order_id = any (p_orders) then v_new else group_id end,
         manual = true, assigned_at = public.app_now(), assigned_by_kind = 'buero', assigned_by_staff = auth.uid()
   where group_id = p_group;
  perform public.cleanup_groups(v_date);
  perform public.log_audit('buero', auth.uid(), 'gruppe_getrennt', 'group', p_group, v_date,
                           jsonb_build_object('neue_gruppe', v_new, 'bestellungen', to_jsonb(p_orders)));
  return v_new;
end;
$$;

-- Manuelle Zuordnung aufheben, damit die Automatik wieder zuständig ist.
create or replace function public.office_unlock_orders(p_orders uuid[])
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_date date;
begin
  perform public.require_role(array['buero']::public.staff_role[]);
  for v_date in select distinct o.service_date from public.orders o where o.id = any (p_orders) loop
    update public.group_assignments a set manual = false
      from public.orders o where o.id = a.order_id and a.order_id = any (p_orders) and o.service_date = v_date;
    perform public.log_audit('buero', auth.uid(), 'automatik_freigegeben', 'day', null, v_date,
                             jsonb_build_object('bestellungen', to_jsonb(p_orders)));
    perform public.regroup_day(v_date);
  end loop;
end;
$$;

-- Gruppen neu berechnen (auch nach 10:30, nur auf ausdrücklichen Wunsch des Büros).
create or replace function public.office_regroup(p_date date)
returns integer language plpgsql security definer set search_path = public, pg_temp
as $$
declare v int;
begin
  perform public.require_role(array['buero']::public.staff_role[]);
  v := public.regroup_day(p_date);
  perform public.log_audit('buero', auth.uid(), 'gruppen_neu_berechnet', 'day', null, p_date);
  return v;
end;
$$;

create or replace function public.office_release_group(p_group uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_date date;
begin
  perform public.require_role(array['buero']::public.staff_role[]);
  update public.delivery_groups set released_at = coalesce(released_at, public.app_now())
   where id = p_group returning service_date into v_date;
  if v_date is null then raise exception 'GRUPPE_NICHT_GEFUNDEN'; end if;
  perform public.log_audit('buero', auth.uid(), 'gruppe_freigegeben', 'group', p_group, v_date);
end;
$$;

create or replace function public.office_dashboard(p_date date)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v jsonb;
begin
  perform public.require_role(array['buero']::public.staff_role[]);
  with o as (
    select o.*, public.effective_status(o.status, o.delivery_status, o.service_date) as eff,
           exists (select 1 from public.delivery_locations l where l.order_id = o.id and l.is_current and l.lat is not null) as has_coords
      from public.orders o where o.service_date = p_date
  )
  select jsonb_build_object(
    'service_date', p_date,
    'now', public.app_now(),
    'order_deadline', public.order_deadline(p_date),
    'location_deadline', public.location_deadline(p_date),
    'meal', (select jsonb_build_object('name', name, 'available', available, 'internal_price', internal_price)
               from public.daily_meals where service_date = p_date),
    'active_drivers', (select count(*) from public.drivers where active),
    'ordered', (select count(*) from o where status = 'bestellt'),
    'cancelled', (select count(*) from o where status = 'storniert'),
    'drivers_without_order', (select count(*) from public.drivers d where d.active
                                and not exists (select 1 from o where o.driver_id = d.id and o.status = 'bestellt')),
    'missing_locations', (select count(*) from o where status = 'bestellt' and not has_coords),
    'groups', (select count(*) from public.delivery_groups g where g.service_date = p_date
                 and exists (select 1 from public.group_assignments a where a.group_id = g.id)),
    'in_preparation', (select count(*) from o where eff = 'in_vorbereitung'),
    'open', (select count(*) from o where eff = 'offen'),
    'on_the_way', (select count(*) from o where eff = 'unterwegs'),
    'delivered', (select count(*) from o where eff = 'zugestellt'),
    'failed_notifications', (select count(*) from public.notifications n join o on o.id = n.order_id
                              where n.status = 'fehlgeschlagen'),
    'rating_avg_30d', (select round(avg(score)::numeric, 2) from public.ratings
                        where service_date > p_date - 30 and service_date <= p_date),
    'rating_count_30d', (select count(*) from public.ratings where service_date > p_date - 30 and service_date <= p_date),
    'next_day_meal_missing', not exists (select 1 from public.daily_meals where service_date = p_date + 1)
  ) into v;
  return v;
end;
$$;

-- Bewertungsauswertung je Gericht
create or replace function public.rating_stats(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v jsonb;
begin
  perform public.require_role(array['buero']::public.staff_role[]);
  select coalesce(jsonb_agg(x order by x->>'service_date' desc), '[]'::jsonb) into v
  from (
    select jsonb_build_object(
      'meal_id', m.id, 'service_date', m.service_date, 'meal_name', m.name,
      'count', count(r.id),
      'avg', round(avg(r.score)::numeric, 2),
      'distribution', jsonb_build_object(
        '1', count(*) filter (where r.score = 1), '2', count(*) filter (where r.score = 2),
        '3', count(*) filter (where r.score = 3), '4', count(*) filter (where r.score = 4),
        '5', count(*) filter (where r.score = 5)),
      'delivered', (select count(*) from public.orders o
                     join public.delivery_confirmation_items i on i.order_id = o.id where o.meal_id = m.id)
    ) as x
      from public.daily_meals m
      left join public.ratings r on r.meal_id = m.id
     where m.service_date between p_from and p_to
     group by m.id
  ) s;
  return v;
end;
$$;

-- ===========================================================================
-- Küche
-- ===========================================================================
create or replace function public.kitchen_save_meal(
  p_service_date date, p_name text, p_description text, p_price numeric, p_available boolean default true)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_role public.staff_role := public.require_role(array['kueche', 'buero']::public.staff_role[]); v_id uuid;
begin
  if p_service_date is null or p_service_date < public.berlin_today() then raise exception 'DATUM_UNGUELTIG'; end if;
  insert into public.daily_meals (service_date, name, description, internal_price, available, updated_by)
  values (p_service_date, btrim(p_name), nullif(btrim(p_description), ''), p_price, coalesce(p_available, true), auth.uid())
  on conflict (service_date) do update
    set name = excluded.name, description = excluded.description, internal_price = excluded.internal_price,
        available = excluded.available, updated_at = public.app_now(), updated_by = auth.uid()
  returning id into v_id;
  perform public.log_audit(public.actor_of(v_role), auth.uid(), 'tagesgericht_gespeichert', 'meal', v_id, p_service_date,
    jsonb_build_object('name', btrim(p_name), 'preis', p_price, 'verfuegbar', coalesce(p_available, true)));
  return v_id;
end;
$$;

-- Produktions- und Packübersicht. Änderungen nach 10:30 werden markiert.
create or replace function public.kitchen_overview(p_date date)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := public.app_now();
  v_final timestamptz := public.location_deadline(p_date);
  v jsonb;
begin
  perform public.require_role(array['kueche', 'buero']::public.staff_role[]);
  with o as (
    select o.id, o.status, o.note, o.updated_at, d.name as driver_name,
           public.effective_status(o.status, o.delivery_status, o.service_date) as eff,
           l.lat, l.lng, l.address, l.created_at as loc_at,
           a.group_id, a.assigned_at, g.seq
      from public.orders o
      join public.drivers d on d.id = o.driver_id
      left join public.delivery_locations l on l.order_id = o.id and l.is_current
      left join public.group_assignments a on a.order_id = o.id
      left join public.delivery_groups g on g.id = a.group_id
     where o.service_date = p_date
  ), oo as (
    select o.*, (v_now >= v_final and greatest(o.updated_at, coalesce(o.loc_at, o.updated_at),
                                                coalesce(o.assigned_at, o.updated_at)) > v_final) as changed_after_final
      from o
  )
  select jsonb_build_object(
    'service_date', p_date,
    'now', v_now,
    'phase', case
      when v_now >= v_final then 'endgueltig'
      when v_now >= public.order_deadline(p_date) then 'bestellschluss'
      when v_now >= (p_date + time '08:00') at time zone 'Europe/Berlin' then 'zwischenstand'
      else 'laufend' end,
    'meal', (select jsonb_build_object('name', name, 'description', description,
                                       'internal_price', internal_price, 'available', available)
               from public.daily_meals where service_date = p_date),
    'total', (select count(*) from oo where status = 'bestellt'),
    'cancelled_after_final', (select coalesce(jsonb_agg(jsonb_build_object('order_id', id, 'driver_name', driver_name)
                                order by driver_name), '[]'::jsonb)
                                from oo where status = 'storniert' and v_now >= v_final and updated_at > v_final),
    'groups', (select coalesce(jsonb_agg(grp order by (grp->>'seq')::int), '[]'::jsonb) from (
        select jsonb_build_object(
          'group_id', group_id, 'seq', seq, 'count', count(*),
          'changed_after_final', bool_or(changed_after_final),
          'orders', jsonb_agg(jsonb_build_object(
              'order_id', id, 'driver_name', driver_name, 'note', note, 'status', eff,
              'lat', lat, 'lng', lng, 'address', address, 'changed_after_final', changed_after_final)
            order by driver_name)) as grp
          from oo where status = 'bestellt' and group_id is not null
         group by group_id, seq) s),
    'ungrouped', (select coalesce(jsonb_agg(jsonb_build_object(
              'order_id', id, 'driver_name', driver_name, 'note', note, 'status', eff,
              'lat', lat, 'lng', lng, 'address', address, 'changed_after_final', changed_after_final)
            order by driver_name), '[]'::jsonb)
                    from oo where status = 'bestellt' and group_id is null)
  ) into v;
  return v;
end;
$$;

-- ===========================================================================
-- Essenslieferfahrer
-- ===========================================================================
create or replace function public.group_visible_to_courier(p_group uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (select 1 from public.delivery_groups g
                  where g.id = p_group
                    and g.service_date = public.berlin_today()
                    and (g.released_at is not null or public.app_now() >= public.location_deadline(g.service_date)));
$$;

create or replace function public.courier_state(p_token text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_courier uuid := public.token_courier(p_token);
  v_today date := public.berlin_today();
  v jsonb;
begin
  select jsonb_build_object(
    'now', public.app_now(),
    'service_date', v_today,
    'courier', (select jsonb_build_object('name', name) from public.couriers where id = v_courier),
    'meal_name', (select name from public.daily_meals where service_date = v_today),
    'final_at', public.location_deadline(v_today),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'group_id', g.id, 'seq', g.seq,
        'taken_by_me', exists (select 1 from public.delivery_run_groups rg join public.delivery_runs r on r.id = rg.run_id
                                where rg.group_id = g.id and r.courier_id = v_courier),
        'taken', exists (select 1 from public.delivery_run_groups rg where rg.group_id = g.id),
        'orders', (select coalesce(jsonb_agg(jsonb_build_object(
                      'order_id', o.id, 'driver_name', d.name, 'note', o.note,
                      'status', public.effective_status(o.status, o.delivery_status, o.service_date),
                      'lat', l.lat, 'lng', l.lng, 'address', l.address) order by d.name), '[]'::jsonb)
                     from public.group_assignments a
                     join public.orders o on o.id = a.order_id and o.status = 'bestellt'
                     join public.drivers d on d.id = o.driver_id
                     left join public.delivery_locations l on l.order_id = o.id and l.is_current
                    where a.group_id = g.id)
      ) order by g.seq)
        from public.delivery_groups g
       where public.group_visible_to_courier(g.id)
         and exists (select 1 from public.group_assignments a join public.orders o on o.id = a.order_id
                      where a.group_id = g.id and o.status = 'bestellt')), '[]'::jsonb)
  ) into v;
  return v;
end;
$$;

create or replace function public.courier_take_group(p_token text, p_group uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_courier uuid := public.token_courier(p_token);
  v_date date;
  v_run uuid;
begin
  if not public.group_visible_to_courier(p_group) then raise exception 'NICHT_FREIGEGEBEN'; end if;
  select service_date into v_date from public.delivery_groups where id = p_group;
  insert into public.delivery_runs (courier_id, service_date) values (v_courier, v_date)
  on conflict (courier_id, service_date) do update set courier_id = excluded.courier_id
  returning id into v_run;
  insert into public.delivery_run_groups (run_id, group_id) values (v_run, p_group)
  on conflict (group_id) do nothing;
  if not exists (select 1 from public.delivery_run_groups where group_id = p_group and run_id = v_run) then
    raise exception 'GRUPPE_VERGEBEN';
  end if;
  update public.orders o set delivery_status = 'unterwegs', updated_at = public.app_now(), updated_by_kind = 'lieferfahrer'
    from public.group_assignments a
   where a.order_id = o.id and a.group_id = p_group and o.status = 'bestellt' and o.delivery_status = 'offen';
  perform public.log_audit('lieferfahrer', v_courier, 'gruppe_uebernommen', 'group', p_group, v_date);
end;
$$;

-- Ablage bestätigen. Nur die ausgewählten Bestellungen werden zugestellt.
-- Wiederholte Bestätigungen sind unschädlich: bereits zugestellte Bestellungen werden
-- übersprungen, Benachrichtigungen entstehen je Bestellung genau einmal.
create or replace function public.courier_confirm(
  p_token text, p_group uuid, p_orders uuid[], p_lat float8, p_lng float8,
  p_accuracy real default null, p_place_note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_courier uuid := public.token_courier(p_token);
  v_date date;
  v_todo uuid[];
  v_conf uuid;
  v_notes uuid[];
begin
  if not public.group_visible_to_courier(p_group) then raise exception 'NICHT_FREIGEGEBEN'; end if;
  if coalesce(array_length(p_orders, 1), 0) = 0 then raise exception 'UNGUELTIGE_AUSWAHL'; end if;
  if p_lat is null and nullif(btrim(p_place_note), '') is null then raise exception 'ABLAGEORT_FEHLT'; end if;
  select service_date into v_date from public.delivery_groups where id = p_group;
  perform pg_advisory_xact_lock(hashtextextended('essen-ablage-' || p_group::text, 0));

  if exists (select 1 from unnest(p_orders) x
              where not exists (select 1 from public.group_assignments a join public.orders o on o.id = a.order_id
                                 where a.order_id = x and a.group_id = p_group and o.status = 'bestellt')) then
    raise exception 'UNGUELTIGE_AUSWAHL';
  end if;

  select array_agg(x) into v_todo from unnest(p_orders) x
   where not exists (select 1 from public.delivery_confirmation_items i where i.order_id = x);
  if v_todo is null then
    return jsonb_build_object('confirmation_id', null, 'already_confirmed', true, 'notification_ids', '[]'::jsonb);
  end if;

  perform public.courier_take_group(p_token, p_group)
    where not exists (select 1 from public.delivery_run_groups where group_id = p_group);

  insert into public.delivery_confirmations (group_id, courier_id, service_date, lat, lng, accuracy_m, place_note)
  values (p_group, v_courier, v_date, p_lat, p_lng, p_accuracy, nullif(btrim(p_place_note), ''))
  returning id into v_conf;
  insert into public.delivery_confirmation_items (order_id, confirmation_id) select x, v_conf from unnest(v_todo) x;
  update public.orders set delivery_status = 'zugestellt', updated_at = public.app_now(), updated_by_kind = 'lieferfahrer'
   where id = any (v_todo);

  with ins as (
    insert into public.notifications (order_id, driver_id, kind)
    select o.id, o.driver_id, 'zugestellt' from public.orders o where o.id = any (v_todo)
    on conflict (order_id, kind) do nothing
    returning id)
  select array_agg(id) into v_notes from ins;

  perform public.log_audit('lieferfahrer', v_courier, 'abgelegt', 'group', p_group, v_date,
    jsonb_build_object('bestellungen', to_jsonb(v_todo), 'lat', p_lat, 'lng', p_lng, 'ort', nullif(btrim(p_place_note), '')));
  return jsonb_build_object('confirmation_id', v_conf, 'already_confirmed', false,
                            'notification_ids', to_jsonb(coalesce(v_notes, '{}')));
end;
$$;
