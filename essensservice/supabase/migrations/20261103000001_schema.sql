-- Agrarlohn Essensservice – Datenmodell
-- Alle Zeitgrenzen gelten in Europe/Berlin und werden ausschließlich in der Datenbank geprüft
-- (siehe 20261103000002_functions.sql).

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- Zentrale Uhr. In Produktion immer now(). Nur in einer Test-Datenbank mit
-- app.testmode = 'on' (ALTER DATABASE … SET) darf app.fake_now die Zeit vorgeben.
create or replace function public.app_now()
returns timestamptz
language sql stable
as $$
  select case
    when current_setting('app.testmode', true) = 'on'
     and nullif(current_setting('app.fake_now', true), '') is not null
    then current_setting('app.fake_now', true)::timestamptz
    else now()
  end;
$$;

-- ---------------------------------------------------------------------------
-- Aufzählungstypen
-- ---------------------------------------------------------------------------
create type public.staff_role as enum ('buero', 'kueche');
create type public.token_subject as enum ('fahrer', 'lieferfahrer');
create type public.order_status as enum ('bestellt', 'storniert');
-- „in Vorbereitung“ wird nicht gespeichert, sondern aus Bestellschluss + Status abgeleitet.
create type public.delivery_status as enum ('offen', 'unterwegs', 'zugestellt');
create type public.location_source as enum ('gps', 'karte', 'adresse', 'buero');
create type public.actor_kind as enum ('fahrer', 'lieferfahrer', 'buero', 'kueche', 'system');
create type public.notification_status as enum ('ausstehend', 'gesendet', 'fehlgeschlagen', 'kein_abo');

-- ---------------------------------------------------------------------------
-- Personen und Zugänge
-- ---------------------------------------------------------------------------

-- Büro- und Küchenmitarbeiter melden sich über Supabase Auth an.
create table public.staff (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  name       text not null check (length(btrim(name)) > 0),
  role       public.staff_role not null,
  active     boolean not null default true,
  created_at timestamptz not null default public.app_now()
);

-- Fahrer: bewusst nur die nötigsten Daten (Datenminimierung).
create table public.drivers (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(btrim(name)) between 1 and 120),
  customer_hint text check (length(customer_hint) <= 120),  -- optional: Kunde/Einsatz, nur zur Orientierung
  phone         text check (length(phone) <= 40),           -- optional: zum Weitergeben des Links
  active        boolean not null default true,
  created_at    timestamptz not null default public.app_now(),
  updated_at    timestamptz not null default public.app_now()
);

-- Essenslieferfahrer
create table public.couriers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) between 1 and 120),
  active     boolean not null default true,
  created_at timestamptz not null default public.app_now()
);

-- Persönliche Links. Gespeichert wird nur der SHA-256-Hash des Tokens.
create table public.access_tokens (
  id           uuid primary key default gen_random_uuid(),
  subject      public.token_subject not null,
  driver_id    uuid references public.drivers (id) on delete cascade,
  courier_id   uuid references public.couriers (id) on delete cascade,
  token_hash   bytea not null unique,
  created_at   timestamptz not null default public.app_now(),
  created_by   uuid references auth.users (id) on delete set null,
  revoked_at   timestamptz,
  last_used_at timestamptz,
  constraint access_tokens_subject_chk check (
    (subject = 'fahrer' and driver_id is not null and courier_id is null)
    or (subject = 'lieferfahrer' and courier_id is not null and driver_id is null)
  )
);
-- Höchstens ein gültiger Link je Person.
create unique index access_tokens_one_active_driver
  on public.access_tokens (driver_id) where revoked_at is null and driver_id is not null;
create unique index access_tokens_one_active_courier
  on public.access_tokens (courier_id) where revoked_at is null and courier_id is not null;

-- ---------------------------------------------------------------------------
-- Tagesgericht und Bestellungen
-- ---------------------------------------------------------------------------
create table public.daily_meals (
  id             uuid primary key default gen_random_uuid(),
  service_date   date not null unique,
  name           text not null check (length(btrim(name)) between 1 and 160),
  description    text check (length(description) <= 1000),
  internal_price numeric(8, 2) check (internal_price >= 0),  -- nur Büro und Küche
  available      boolean not null default true,
  created_at     timestamptz not null default public.app_now(),
  updated_at     timestamptz not null default public.app_now(),
  updated_by     uuid references auth.users (id) on delete set null,
  unique (id, service_date)
);

create table public.orders (
  id              uuid primary key default gen_random_uuid(),
  driver_id       uuid not null references public.drivers (id),
  service_date    date not null,
  meal_id         uuid not null,
  status          public.order_status not null default 'bestellt',
  delivery_status public.delivery_status not null default 'offen',
  note            text check (length(note) <= 500),
  created_at      timestamptz not null default public.app_now(),
  updated_at      timestamptz not null default public.app_now(),
  updated_by_kind public.actor_kind not null,
  -- verhindert doppelte Bestellungen je Fahrer und Tag
  constraint orders_one_per_driver_day unique (driver_id, service_date),
  -- das Gericht muss zum Liefertag gehören
  constraint orders_meal_fk foreign key (meal_id, service_date)
    references public.daily_meals (id, service_date)
);
create index orders_service_date_idx on public.orders (service_date);

-- Lieferstandorte mit vollständigem Änderungsverlauf; genau einer ist aktuell.
create table public.delivery_locations (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references public.orders (id) on delete cascade,
  lat              double precision check (lat between -90 and 90),
  lng              double precision check (lng between -180 and 180),
  address          text check (length(address) <= 300),
  accuracy_m       real check (accuracy_m >= 0),
  source           public.location_source not null,
  is_current       boolean not null default true,
  created_at       timestamptz not null default public.app_now(),
  created_by_kind  public.actor_kind not null,
  created_by_staff uuid references auth.users (id) on delete set null,
  constraint delivery_locations_coords_chk check ((lat is null) = (lng is null)),
  constraint delivery_locations_content_chk check (lat is not null or length(btrim(address)) > 0)
);
create unique index delivery_locations_one_current
  on public.delivery_locations (order_id) where is_current;

-- ---------------------------------------------------------------------------
-- Liefergruppen
-- ---------------------------------------------------------------------------
create table public.delivery_groups (
  id           uuid primary key default gen_random_uuid(),
  service_date date not null,
  seq          integer not null check (seq > 0),
  released_at  timestamptz,  -- vorzeitige Freigabe für Lieferfahrer (sonst automatisch ab 10:30)
  created_at   timestamptz not null default public.app_now(),
  unique (service_date, seq)
);

-- Primärschlüssel order_id: eine Bestellung gehört höchstens zu einer Gruppe.
create table public.group_assignments (
  order_id          uuid primary key references public.orders (id) on delete cascade,
  group_id          uuid not null references public.delivery_groups (id) on delete cascade,
  manual            boolean not null default false,  -- Büro-Zuordnung, Automatik fasst sie nicht an
  assigned_at       timestamptz not null default public.app_now(),
  assigned_by_kind  public.actor_kind not null,
  assigned_by_staff uuid references auth.users (id) on delete set null
);
create index group_assignments_group_idx on public.group_assignments (group_id);

-- ---------------------------------------------------------------------------
-- Auslieferung
-- ---------------------------------------------------------------------------
create table public.delivery_runs (
  id           uuid primary key default gen_random_uuid(),
  courier_id   uuid not null references public.couriers (id),
  service_date date not null,
  started_at   timestamptz not null default public.app_now(),
  unique (courier_id, service_date)
);

create table public.delivery_run_groups (
  run_id   uuid not null references public.delivery_runs (id) on delete cascade,
  group_id uuid primary key references public.delivery_groups (id) on delete cascade,
  taken_at timestamptz not null default public.app_now()
);

create table public.delivery_confirmations (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid references public.delivery_groups (id) on delete set null,
  courier_id   uuid not null references public.couriers (id),
  service_date date not null,
  confirmed_at timestamptz not null default public.app_now(),
  lat          double precision check (lat between -90 and 90),
  lng          double precision check (lng between -180 and 180),
  accuracy_m   real check (accuracy_m >= 0),
  place_note   text check (length(place_note) <= 300),
  constraint delivery_confirmations_place_chk
    check ((lat is not null and lng is not null) or length(btrim(place_note)) > 0)
);

-- Primärschlüssel order_id: jede Bestellung wird genau einmal als zugestellt bestätigt.
create table public.delivery_confirmation_items (
  order_id        uuid primary key references public.orders (id) on delete cascade,
  confirmation_id uuid not null references public.delivery_confirmations (id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Bewertungen
-- ---------------------------------------------------------------------------
create table public.ratings (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null unique references public.orders (id) on delete cascade,
  driver_id    uuid not null references public.drivers (id),
  meal_id      uuid not null references public.daily_meals (id),
  service_date date not null,
  score        smallint not null check (score between 1 and 5),
  created_at   timestamptz not null default public.app_now()
);

-- ---------------------------------------------------------------------------
-- Push
-- ---------------------------------------------------------------------------
create table public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  driver_id  uuid not null references public.drivers (id) on delete cascade,
  endpoint   text not null unique check (endpoint like 'https://%'),
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default public.app_now(),
  revoked_at timestamptz
);

create table public.notifications (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders (id) on delete cascade,
  driver_id       uuid not null references public.drivers (id) on delete cascade,
  kind            text not null default 'zugestellt',
  status          public.notification_status not null default 'ausstehend',
  attempts        integer not null default 0,
  last_error      text,
  next_attempt_at timestamptz,
  created_at      timestamptz not null default public.app_now(),
  sent_at         timestamptz,
  -- keine doppelten Nachrichten bei wiederholter Bestätigung
  unique (order_id, kind)
);

-- ---------------------------------------------------------------------------
-- Änderungsprotokoll
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id           bigint generated always as identity primary key,
  at           timestamptz not null default public.app_now(),
  actor_kind   public.actor_kind not null,
  actor_id     uuid,
  action       text not null,
  entity       text not null,
  entity_id    uuid,
  service_date date,
  details      jsonb not null default '{}'::jsonb
);
create index audit_log_date_idx on public.audit_log (service_date, at);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- Fahrer und Lieferfahrer greifen nie direkt auf Tabellen zu, sondern nur über
-- serverseitige Funktionen mit ihrem Token. Büro und Küche lesen über RLS und
-- schreiben ausschließlich über geprüfte Funktionen.
-- ---------------------------------------------------------------------------
create or replace function public.staff_role_of_current_user()
returns public.staff_role
language sql stable security definer set search_path = public, pg_temp
as $$
  select role from public.staff where user_id = auth.uid() and active;
$$;

alter table public.staff                       enable row level security;
alter table public.drivers                     enable row level security;
alter table public.couriers                    enable row level security;
alter table public.access_tokens               enable row level security;
alter table public.daily_meals                 enable row level security;
alter table public.orders                      enable row level security;
alter table public.delivery_locations          enable row level security;
alter table public.delivery_groups             enable row level security;
alter table public.group_assignments           enable row level security;
alter table public.delivery_runs               enable row level security;
alter table public.delivery_run_groups         enable row level security;
alter table public.delivery_confirmations      enable row level security;
alter table public.delivery_confirmation_items enable row level security;
alter table public.ratings                     enable row level security;
alter table public.push_subscriptions          enable row level security;
alter table public.notifications               enable row level security;
alter table public.audit_log                   enable row level security;

create policy staff_self_or_office on public.staff for select to authenticated
  using (user_id = auth.uid() or public.staff_role_of_current_user() = 'buero');

-- Lesen für Büro und Küche
create policy read_staff on public.drivers                     for select to authenticated using (public.staff_role_of_current_user() is not null);
create policy read_staff on public.couriers                    for select to authenticated using (public.staff_role_of_current_user() is not null);
create policy read_staff on public.daily_meals                 for select to authenticated using (public.staff_role_of_current_user() is not null);
create policy read_staff on public.orders                      for select to authenticated using (public.staff_role_of_current_user() is not null);
create policy read_staff on public.delivery_locations          for select to authenticated using (public.staff_role_of_current_user() is not null);
create policy read_staff on public.delivery_groups             for select to authenticated using (public.staff_role_of_current_user() is not null);
create policy read_staff on public.group_assignments           for select to authenticated using (public.staff_role_of_current_user() is not null);
create policy read_staff on public.delivery_runs               for select to authenticated using (public.staff_role_of_current_user() is not null);
create policy read_staff on public.delivery_run_groups         for select to authenticated using (public.staff_role_of_current_user() is not null);
create policy read_staff on public.delivery_confirmations      for select to authenticated using (public.staff_role_of_current_user() is not null);
create policy read_staff on public.delivery_confirmation_items for select to authenticated using (public.staff_role_of_current_user() is not null);

-- Nur Büro
create policy read_office on public.ratings       for select to authenticated using (public.staff_role_of_current_user() = 'buero');
create policy read_office on public.notifications for select to authenticated using (public.staff_role_of_current_user() = 'buero');
create policy read_office on public.audit_log     for select to authenticated using (public.staff_role_of_current_user() = 'buero');
-- access_tokens und push_subscriptions: keine Policies → nur über Funktionen erreichbar.

-- Kein direkter Schreibzugriff für Clients.
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
revoke all on all tables in schema public from anon;
