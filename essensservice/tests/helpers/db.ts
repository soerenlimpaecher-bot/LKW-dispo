import pg from "pg";
import { randomUUID } from "node:crypto";

// Testhelfer: jeder Aufruf läuft in einer eigenen Transaktion mit der gewünschten
// Supabase-Rolle, optional angemeldetem Nutzer und fest vorgegebener Uhrzeit.
const url = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/essen_test";

let client: pg.Client | null = null;
let fakeNow: string | null = null;

export async function db(): Promise<pg.Client> {
  if (!client) {
    client = new pg.Client({ connectionString: url });
    await client.connect();
  }
  return client;
}

export async function closeDb() {
  await client?.end();
  client = null;
}

/** Uhrzeit für alle folgenden Aufrufe festlegen, z. B. "2026-11-03 08:59 Europe/Berlin". */
export function setNow(value: string | null) {
  fakeNow = value;
}

type Role = "anon" | "authenticated" | "service_role" | "postgres";

export async function run<T = any>(
  role: Role,
  sql: string,
  params: unknown[] = [],
  opts: { uid?: string } = {},
): Promise<T[]> {
  const c = await db();
  await c.query("begin");
  try {
    if (fakeNow) await c.query("select set_config('app.fake_now', $1, true)", [fakeNow]);
    if (opts.uid) await c.query("select set_config('request.jwt.claim.sub', $1, true)", [opts.uid]);
    if (role !== "postgres") await c.query(`set local role ${role}`);
    const res = await c.query(sql, params);
    await c.query("commit");
    return res.rows as T[];
  } catch (e) {
    await c.query("rollback");
    throw e;
  }
}

/** Erwartet, dass der Aufruf mit dem angegebenen Fehlercode fehlschlägt. */
export async function expectError(p: Promise<unknown>, code: string | RegExp) {
  try {
    await p;
  } catch (e: any) {
    const msg = String(e.message);
    if (typeof code === "string" ? msg.includes(code) : code.test(msg)) return;
    throw new Error(`Erwartet Fehler ${code}, erhalten: ${msg}`);
  }
  throw new Error(`Erwartet Fehler ${code}, aber Aufruf war erfolgreich`);
}

export async function resetData() {
  setNow(null);
  await run(
    "postgres",
    `truncate public.audit_log, public.notifications, public.push_subscriptions, public.ratings,
       public.delivery_confirmation_items, public.delivery_confirmations, public.delivery_run_groups,
       public.delivery_runs, public.group_assignments, public.delivery_groups, public.delivery_locations,
       public.orders, public.daily_meals, public.access_tokens, public.couriers, public.drivers,
       public.staff, auth.users cascade`,
  );
}

export async function createStaff(role: "buero" | "kueche", name = role) {
  const id = randomUUID();
  await run("postgres", "insert into auth.users (id, email) values ($1, $2)", [id, `${id}@test.local`]);
  await run("postgres", "insert into public.staff (user_id, name, role) values ($1, $2, $3)", [id, name, role]);
  return id;
}

/** Ruft eine Büro-/Küchenfunktion als angemeldeter Mitarbeiter auf. */
export async function asStaff<T = any>(uid: string, sql: string, params: unknown[] = []) {
  return run<T>("authenticated", sql, params, { uid });
}

/** Ruft eine Fahrer-/Lieferfahrerfunktion so auf, wie es der Server tut. */
export async function asServer<T = any>(sql: string, params: unknown[] = []) {
  return run<T>("service_role", sql, params);
}

export async function createDriver(office: string, name: string) {
  const [{ id }] = await asStaff(office, "select public.office_save_driver(null, $1) as id", [name]);
  const [{ token }] = await asStaff(office, "select public.office_issue_token('fahrer', $1) as token", [id]);
  return { id: id as string, token: token as string };
}

export async function createCourier(office: string, name: string) {
  const [{ id }] = await asStaff(office, "select public.office_save_courier(null, $1) as id", [name]);
  const [{ token }] = await asStaff(office, "select public.office_issue_token('lieferfahrer', $1) as token", [id]);
  return { id: id as string, token: token as string };
}

export async function saveMeal(kitchen: string, date: string, name = "Gulasch mit Klößen", price = 6.5) {
  const [{ id }] = await asStaff(kitchen, "select public.kitchen_save_meal($1, $2, 'Hausgemacht', $3, true) as id", [
    date, name, price,
  ]);
  return id as string;
}

export async function placeOrder(token: string, date: string, note: string | null = null) {
  const [{ id }] = await asServer("select public.driver_place_order($1, $2, $3) as id", [token, date, note]);
  return id as string;
}

export async function setLocation(token: string, date: string, lat: number, lng: number) {
  await asServer("select public.driver_set_location($1, $2, $3, $4, null, 'gps', 10)", [token, date, lat, lng]);
}

/** Gruppen eines Tages als Liste von Fahrernamen-Mengen, sortiert für stabile Vergleiche. */
export async function groupsOf(date: string) {
  const rows = await run<{ seq: number; names: string[]; manual: boolean[] }>(
    "postgres",
    `select g.seq, array_agg(d.name order by d.name) as names, array_agg(a.manual order by d.name) as manual
       from public.delivery_groups g
       join public.group_assignments a on a.group_id = g.id
       join public.orders o on o.id = a.order_id
       join public.drivers d on d.id = o.driver_id
      where g.service_date = $1
      group by g.seq order by g.seq`,
    [date],
  );
  return rows;
}

/** Punkt in Metern Abstand von einem Bezugspunkt (Nord/Ost), genügt für Tests im 500-m-Bereich. */
export function offset(lat: number, lng: number, northM: number, eastM: number) {
  const dLat = northM / 111_195;
  const dLng = eastM / (111_195 * Math.cos((lat * Math.PI) / 180));
  return { lat: lat + dLat, lng: lng + dLng };
}
