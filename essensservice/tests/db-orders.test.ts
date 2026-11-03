import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  asServer, asStaff, closeDb, createCourier, createDriver, createStaff, expectError,
  placeOrder, resetData, run, saveMeal, setLocation, setNow,
} from "./helpers/db";

const D = "2026-11-04"; // Winterzeit (MEZ, UTC+1)

let office: string;
let kitchen: string;

beforeEach(async () => {
  await resetData();
  office = await createStaff("buero");
  kitchen = await createStaff("kueche");
  setNow("2026-11-03 14:00 Europe/Berlin");
  await saveMeal(kitchen, D);
});
afterAll(closeDb);

describe("Bestellschluss 09:00 Uhr", () => {
  it("erlaubt Bestellen, Ändern und Stornieren bis 08:59:59", async () => {
    const f = await createDriver(office, "Anna");
    setNow(`${D} 08:59:59 Europe/Berlin`);
    await placeOrder(f.token, D, "ohne Zwiebeln");
    await placeOrder(f.token, D, "doch mit Zwiebeln");
    await asServer("select public.driver_cancel_order($1, $2)", [f.token, D]);
    const [o] = await run("postgres", "select status, note from public.orders");
    expect(o).toEqual({ status: "storniert", note: "doch mit Zwiebeln" });
  });

  it("sperrt Bestellen und Stornieren ab 09:00:00 für Fahrer", async () => {
    const f = await createDriver(office, "Anna");
    setNow(`${D} 08:30 Europe/Berlin`);
    await placeOrder(f.token, D);
    setNow(`${D} 09:00:00 Europe/Berlin`);
    await expectError(placeOrder(f.token, D), "BESTELLSCHLUSS");
    await expectError(asServer("select public.driver_cancel_order($1, $2)", [f.token, D]), "BESTELLSCHLUSS");
  });

  it("bietet nach 09:00 automatisch den Folgetag an, nie den Vortag", async () => {
    const f = await createDriver(office, "Anna");
    setNow(`${D} 09:00 Europe/Berlin`);
    const [{ s }] = await asServer("select public.driver_state($1) as s", [f.token]);
    expect(s.order_day.service_date).toBe("2026-11-05");
    expect(s.order_day.can_order).toBe(false); // für den 5.11. ist noch kein Gericht eingetragen
    await expectError(placeOrder(f.token, "2026-11-03"), "DATUM_UNGUELTIG");
  });

  it("berücksichtigt Sommerzeit (MESZ, UTC+2)", async () => {
    setNow("2026-07-14 12:00 Europe/Berlin");
    await saveMeal(kitchen, "2026-07-15");
    const f = await createDriver(office, "Anna");
    setNow("2026-07-15 06:59:59+00"); // = 08:59:59 MESZ
    await placeOrder(f.token, "2026-07-15");
    setNow("2026-07-15 07:00:00+00"); // = 09:00:00 MESZ
    await expectError(placeOrder(f.token, "2026-07-15"), "BESTELLSCHLUSS");
  });

  it("berücksichtigt Winterzeit (MEZ, UTC+1)", async () => {
    const f = await createDriver(office, "Anna");
    setNow(`${D} 07:59:59+00`); // = 08:59:59 MEZ
    await placeOrder(f.token, D);
    setNow(`${D} 08:00:00+00`); // = 09:00:00 MEZ
    await expectError(placeOrder(f.token, D), "BESTELLSCHLUSS");
  });

  it("rechnet an den Umstellungstagen richtig (29.03. und 25.10.2026)", async () => {
    const [r] = await run(
      "postgres",
      `select public.order_deadline('2026-03-29') at time zone 'UTC' as spring,
              public.order_deadline('2026-10-25') at time zone 'UTC' as autumn,
              public.location_deadline('2026-03-29') at time zone 'UTC' as spring_loc`,
    );
    expect(r.spring.toISOString()).toBe("2026-03-29T07:00:00.000Z");
    expect(r.autumn.toISOString()).toBe("2026-10-25T08:00:00.000Z");
    expect(r.spring_loc.toISOString()).toBe("2026-03-29T08:30:00.000Z");
  });
});

describe("Standortschluss 10:30 Uhr", () => {
  it("erlaubt Standortänderungen bis 10:29:59 und sperrt ab 10:30", async () => {
    const f = await createDriver(office, "Anna");
    setNow(`${D} 08:00 Europe/Berlin`);
    await placeOrder(f.token, D);
    setNow(`${D} 10:29:59 Europe/Berlin`);
    await setLocation(f.token, D, 53.43, 12.7);
    setNow(`${D} 10:30 Europe/Berlin`);
    await expectError(setLocation(f.token, D, 53.44, 12.7), "STANDORTSCHLUSS");
  });

  it("speichert den Änderungsverlauf und genau einen aktuellen Standort", async () => {
    const f = await createDriver(office, "Anna");
    setNow(`${D} 08:00 Europe/Berlin`);
    await placeOrder(f.token, D);
    await setLocation(f.token, D, 53.43, 12.7);
    await setLocation(f.token, D, 53.431, 12.701);
    const rows = await run("postgres", "select lat, is_current, source from public.delivery_locations order by created_at, is_current");
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.is_current)).toEqual([{ lat: 53.431, is_current: true, source: "gps" }]);
  });

  it("erlaubt Bestellungen ohne Standort; das Büro sieht sie als fehlend", async () => {
    const f = await createDriver(office, "Anna");
    setNow(`${D} 08:00 Europe/Berlin`);
    await placeOrder(f.token, D);
    const [{ d }] = await asStaff(office, "select public.office_dashboard($1) as d", [D]);
    expect(d.ordered).toBe(1);
    expect(d.missing_locations).toBe(1);
  });
});

describe("Büro darf jederzeit ändern", () => {
  it("bestellt, ändert, setzt Standorte und storniert nach allen Fristen", async () => {
    const f = await createDriver(office, "Anna");
    setNow(`${D} 13:00 Europe/Berlin`);
    const [{ id }] = await asStaff(office, "select public.office_save_order($1, $2, 'nachgemeldet') as id", [f.id, D]);
    await asStaff(office, "select public.office_set_location($1, 53.43, 12.7, 'Hof Nord')", [id]);
    await asStaff(office, "select public.office_save_order($1, $2, 'geändert')", [f.id, D]);
    let [o] = await run("postgres", "select status, note, updated_by_kind from public.orders");
    expect(o).toEqual({ status: "bestellt", note: "geändert", updated_by_kind: "buero" });
    await asStaff(office, "select public.office_cancel_order($1)", [id]);
    [o] = await run("postgres", "select status from public.orders");
    expect(o.status).toBe("storniert");
    const log = await run("postgres", "select action from public.audit_log where actor_kind = 'buero' order by id");
    expect(log.map((l) => l.action)).toEqual(
      expect.arrayContaining(["bestellung_gespeichert", "standort", "storniert"]),
    );
  });

  it("darf auch bestellen, wenn beim Fahrer eine Bewertung aussteht", async () => {
    const f = await createDriver(office, "Anna");
    await deliverTo(f, D);
    setNow(`${D} 15:00 Europe/Berlin`);
    await saveMeal(kitchen, "2026-11-05");
    setNow("2026-11-05 10:00 Europe/Berlin");
    await asStaff(office, "select public.office_save_order($1, '2026-11-05')", [f.id]);
  });
});

describe("Doppelte Bestellungen", () => {
  it("führt je Fahrer und Tag genau eine Bestellung", async () => {
    const f = await createDriver(office, "Anna");
    setNow(`${D} 08:00 Europe/Berlin`);
    const a = await placeOrder(f.token, D);
    const b = await placeOrder(f.token, D);
    await asServer("select public.driver_cancel_order($1, $2)", [f.token, D]);
    const c = await placeOrder(f.token, D);
    await asStaff(office, "select public.office_save_order($1, $2)", [f.id, D]);
    expect(new Set([a, b, c]).size).toBe(1);
    const [{ n }] = await run("postgres", "select count(*)::int as n from public.orders");
    expect(n).toBe(1);
  });

  it("verhindert Doppelbestellungen auch bei direktem Einfügen (Constraint)", async () => {
    const f = await createDriver(office, "Anna");
    setNow(`${D} 08:00 Europe/Berlin`);
    await placeOrder(f.token, D);
    await expectError(
      run("postgres", `insert into public.orders (driver_id, service_date, meal_id, updated_by_kind)
                       select driver_id, service_date, meal_id, 'system' from public.orders`),
      "orders_one_per_driver_day",
    );
  });
});

// Hilfsfunktion: Bestellung am Tag `date` bis zur Zustellung durchspielen.
async function deliverTo(f: { token: string }, date: string) {
  setNow(`${date} 08:00 Europe/Berlin`);
  await placeOrder(f.token, date);
  await setLocation(f.token, date, 53.43, 12.7);
  const c = await createCourier(office, `Kurier ${Math.random()}`);
  setNow(`${date} 11:45 Europe/Berlin`);
  const [{ s }] = await asServer("select public.courier_state($1) as s", [c.token]);
  const g = s.groups.find((x: any) => x.orders.some((o: any) => o.status !== "zugestellt"));
  await asServer("select public.courier_confirm($1, $2, $3, 53.43, 12.7, 5, null)", [
    c.token, g.group_id, g.orders.map((o: any) => o.order_id),
  ]);
}

describe("Verpflichtende Bewertung", () => {
  it("verlangt keine Bewertung, wenn noch nie ein Essen geliefert wurde", async () => {
    const f = await createDriver(office, "Anna");
    setNow(`${D} 08:00 Europe/Berlin`);
    const [{ s }] = await asServer("select public.driver_state($1) as s", [f.token]);
    expect(s.pending_rating).toBeNull();
    expect(s.order_day.can_order).toBe(true);
    await placeOrder(f.token, D);
  });

  it("verlangt keine Bewertung für bestellte, aber nicht gelieferte Essen", async () => {
    const f = await createDriver(office, "Anna");
    setNow(`${D} 08:00 Europe/Berlin`);
    await placeOrder(f.token, D);
    setNow(`${D} 15:00 Europe/Berlin`);
    await saveMeal(kitchen, "2026-11-05");
    setNow("2026-11-05 07:00 Europe/Berlin");
    await placeOrder(f.token, "2026-11-05");
  });

  it("sperrt die neue Bestellung, bis das zuletzt erhaltene Essen bewertet ist", async () => {
    const f = await createDriver(office, "Anna");
    await deliverTo(f, D);
    setNow(`${D} 15:00 Europe/Berlin`);
    await saveMeal(kitchen, "2026-11-05", "Schnitzel");
    setNow("2026-11-05 07:00 Europe/Berlin");

    const [{ s }] = await asServer("select public.driver_state($1) as s", [f.token]);
    expect(s.pending_rating.meal_name).toBe("Gulasch mit Klößen");
    expect(s.pending_rating.service_date).toBe(D);
    expect(s.order_day.can_order).toBe(false);
    await expectError(placeOrder(f.token, "2026-11-05"), "BEWERTUNG_AUSSTEHEND");

    await expectError(asServer("select public.driver_rate($1, $2, 6)", [f.token, s.pending_rating.order_id]), "UNGUELTIGE_BEWERTUNG");
    await asServer("select public.driver_rate($1, $2, 4)", [f.token, s.pending_rating.order_id]);
    await expectError(asServer("select public.driver_rate($1, $2, 5)", [f.token, s.pending_rating.order_id]), "KEINE_BEWERTUNG_OFFEN");
    await placeOrder(f.token, "2026-11-05");

    const [r] = await run("postgres", "select score, service_date::text as d from public.ratings");
    expect(r).toEqual({ score: 4, d: D });
  });

  it("ordnet die Bewertung Fahrer, Gericht und Liefertag eindeutig zu", async () => {
    const anna = await createDriver(office, "Anna");
    const bert = await createDriver(office, "Bert");
    setNow(`${D} 08:00 Europe/Berlin`);
    await placeOrder(bert.token, D);
    await deliverTo(anna, D);
    const [{ s }] = await asServer("select public.driver_state($1) as s", [anna.token]);
    // Bert hat nichts erhalten und darf Annas Essen nicht bewerten
    await expectError(asServer("select public.driver_rate($1, $2, 1)", [bert.token, s.pending_rating.order_id]), "KEINE_BEWERTUNG_OFFEN");
    await asServer("select public.driver_rate($1, $2, 5)", [anna.token, s.pending_rating.order_id]);
    const [r] = await run(
      "postgres",
      `select d.name, m.name as meal, r.service_date::text as d from public.ratings r
         join public.drivers d on d.id = r.driver_id join public.daily_meals m on m.id = r.meal_id`,
    );
    expect(r).toEqual({ name: "Anna", meal: "Gulasch mit Klößen", d: D });
    const [{ st }] = await asStaff(office, "select public.rating_stats($1, $1) as st", [D]);
    expect(st[0]).toMatchObject({ count: 1, avg: 5, distribution: { "5": 1, "1": 0 } });
  });
});
