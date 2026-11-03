import { afterAll, describe, expect, it } from "vitest";
import { closeDb, run } from "./helpers/db";

afterAll(closeDb);

// Was angemeldete Mitarbeiter (Rolle authenticated) aufrufen dürfen. Alles andere nur der Server.
const AUTHENTICATED = [
  "app_now", "staff_role_of_current_user", "staff_me",
  "office_save_driver", "office_save_courier", "office_issue_token", "office_revoke_token", "office_save_order",
  "office_cancel_order", "office_set_location", "office_move_order", "office_merge_groups", "office_split_group",
  "office_unlock_orders", "office_regroup", "office_release_group", "office_dashboard", "office_day", "office_drivers",
  "office_couriers", "office_location_history", "office_notifications", "office_audit", "office_failed_notification_ids",
  "rating_stats", "kitchen_save_meal", "kitchen_overview", "kitchen_meals",
].sort();

const executableBy = (role: string) =>
  run<{ proname: string }>(
    "postgres",
    `select distinct p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege($1, p.oid, 'execute') order by 1`,
    [role],
  ).then((r) => r.map((x) => x.proname));

describe("Ausführungsrechte der Datenbankfunktionen", () => {
  it("anonyme Aufrufer dürfen keine einzige Funktion ausführen", async () => {
    expect(await executableBy("anon")).toEqual([]);
  });

  it("angemeldete Nutzer dürfen nur die freigegebenen Büro-/Küchenfunktionen ausführen", async () => {
    expect(await executableBy("authenticated")).toEqual(AUTHENTICATED);
  });

  it("alle Büro-/Küchenfunktionen prüfen die Rolle selbst", async () => {
    const rows = await run<{ proname: string; src: string }>(
      "postgres",
      `select p.proname, p.prosrc as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and (p.proname like 'office\\_%' or p.proname like 'kitchen\\_%' or p.proname = 'rating_stats')`,
    );
    for (const r of rows) expect(r.src, r.proname).toContain("require_role");
  });

  it("alle Tabellen haben Row Level Security", async () => {
    const rows = await run<{ relname: string }>(
      "postgres",
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(rows).toEqual([]);
  });
});
