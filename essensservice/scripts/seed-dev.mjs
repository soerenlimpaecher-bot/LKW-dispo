// Füllt eine lokale Entwicklungsdatenbank (…_dev) mit erfundenen Beispieldaten und gibt
// die persönlichen Links aus. Nur lokal verwenden.
import { randomUUID } from "node:crypto";
import pg from "pg";

const url = process.argv[2] ?? "postgres://postgres:postgres@localhost:5432/essen_dev";
if (!/_dev$/.test(new URL(url).pathname)) throw new Error("Nur für Datenbanken, deren Name auf _dev endet.");
const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
const db = new pg.Client({ connectionString: url });
await db.connect();

async function as(uid, sql, params = []) {
  await db.query("begin");
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]);
    await db.query("set local role authenticated");
    const r = await db.query(sql, params);
    await db.query("commit");
    return r.rows;
  } catch (e) {
    await db.query("rollback");
    throw e;
  }
}

async function staff(name, role) {
  const id = randomUUID();
  await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${role}@beispiel.local`]);
  await db.query("insert into public.staff (user_id, name, role) values ($1, $2, $3)", [id, name, role]);
  return id;
}

const office = await staff("Büro (Beispiel)", "buero");
const kitchen = await staff("Küche (Beispiel)", "kueche");
const { rows: [{ today }] } = await db.query("select public.berlin_today()::text as today");
const { rows: [{ tomorrow }] } = await db.query("select (public.berlin_today() + 1)::text as tomorrow");

await as(kitchen, "select public.kitchen_save_meal($1, 'Gulasch mit Klößen', 'Rindergulasch, Kartoffelklöße, Rotkohl', 6.50, true)", [today]);
await as(kitchen, "select public.kitchen_save_meal($1, 'Hähnchenschnitzel mit Bratkartoffeln', 'Dazu Gurkensalat', 6.90, true)", [tomorrow]);

// Erfundene Fahrer an erfundenen Punkten im Raum Müritz
const drivers = [
  ["Fahrer Anton", 53.5100, 12.6800], ["Fahrer Bernd", 53.5112, 12.6815], ["Fahrer Carla", 53.5095, 12.6830],
  ["Fahrer Dirk", 53.4700, 12.7300], ["Fahrer Emil", 53.4712, 12.7290],
  ["Fahrer Frieda", 53.5500, 12.6000], ["Fahrer Gerd", null, null], ["Fahrer Hanna", null, null],
];
const links = [];
for (const [name, lat, lng] of drivers) {
  const [{ id }] = await as(office, "select public.office_save_driver(null, $1, 'Beispielkunde') as id", [name]);
  const [{ token }] = await as(office, "select public.office_issue_token('fahrer', $1) as token", [id]);
  links.push([name, `${base}/f/${token}`]);
  if (name !== "Fahrer Hanna") {
    const [{ oid }] = await as(office, "select public.office_save_order($1, $2) as oid", [id, today]);
    if (lat) await as(office, "select public.office_set_location($1, $2, $3)", [oid, lat, lng]);
  }
}
await as(office, "select public.office_regroup($1)", [today]);
const [{ cid }] = await as(office, "select public.office_save_courier(null, 'Lieferfahrer (Beispiel)') as cid");
const [{ ctoken }] = await as(office, "select public.office_issue_token('lieferfahrer', $1) as ctoken", [cid]);
links.push(["Lieferfahrer", `${base}/l/${ctoken}`]);

console.log(JSON.stringify({ office, kitchen, today, tomorrow, links }, null, 2));
await db.end();
