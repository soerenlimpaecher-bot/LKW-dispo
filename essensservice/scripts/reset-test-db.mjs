// Legt eine lokale Test- oder Entwicklungsdatenbank neu an und spielt Supabase-Nachbildung
// und Migrationen ein. Nur lokal. Niemals gegen eine produktive Datenbank ausführen.
// Aufruf: node scripts/reset-test-db.mjs [verbindungs-url]   (Datenbankname muss auf _test oder _dev enden)
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const url = new URL(process.argv[2] ?? process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/essen_test");
const dbName = url.pathname.slice(1);
if (!/_(test|dev)$/.test(dbName)) throw new Error(`Abbruch: '${dbName}' endet nicht auf _test oder _dev.`);

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const admin = new pg.Client({ connectionString: Object.assign(new URL(url), { pathname: "/postgres" }).toString() });
await admin.connect();
await admin.query(`drop database if exists ${dbName} with (force)`);
await admin.query(`create database ${dbName}`);
// Feste Testuhr nur in Test-Datenbanken
if (dbName.endsWith("_test")) await admin.query(`alter database ${dbName} set app.testmode = 'on'`);
await admin.end();

const db = new pg.Client({ connectionString: url.toString() });
await db.connect();
const files = [
  path.join(root, "supabase/tests/supabase_shim.sql"),
  ...fs.readdirSync(path.join(root, "supabase/migrations")).sort().map((f) => path.join(root, "supabase/migrations", f)),
];
for (const f of files) {
  try {
    await db.query(fs.readFileSync(f, "utf8"));
  } catch (e) {
    console.error(`Fehler in ${path.basename(f)}: ${e.message}`);
    process.exit(1);
  }
}
await db.end();
console.log(`Test-Datenbank ${dbName} bereit (${files.length} Dateien).`);
