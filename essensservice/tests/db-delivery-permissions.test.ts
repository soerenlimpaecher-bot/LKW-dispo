import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  asServer, asStaff, closeDb, createCourier, createDriver, createStaff, expectError, offset,
  placeOrder, resetData, run, saveMeal, setLocation, setNow,
} from "./helpers/db";

const D = "2026-11-04";
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

async function twoInOneGroup() {
  setNow(`${D} 08:00 Europe/Berlin`);
  const anna = await createDriver(office, "Anna");
  const bert = await createDriver(office, "Bert");
  for (const [f, n] of [[anna, 0], [bert, 60]] as const) {
    await placeOrder(f.token, D);
    const p = offset(53.43, 12.7, n, 0);
    await setLocation(f.token, D, p.lat, p.lng);
  }
  const courier = await createCourier(office, "Lena");
  return { anna, bert, courier };
}

describe("Lieferbestätigung", () => {
  it("zeigt Gruppen erst ab 10:30 oder nach Freigabe durch das Büro", async () => {
    const { courier } = await twoInOneGroup();
    setNow(`${D} 10:00 Europe/Berlin`);
    let [{ s }] = await asServer("select public.courier_state($1) as s", [courier.token]);
    expect(s.groups).toEqual([]);
    const [{ id }] = await run("postgres", "select id from public.delivery_groups");
    await asStaff(office, "select public.office_release_group($1)", [id]);
    [{ s }] = await asServer("select public.courier_state($1) as s", [courier.token]);
    expect(s.groups).toHaveLength(1);
    expect(JSON.stringify(s)).not.toContain("internal_price");
  });

  it("markiert nur die tatsächlich abgelegten Bestellungen und speichert Zeit, Ort und Lieferfahrer", async () => {
    const { courier } = await twoInOneGroup();
    setNow(`${D} 12:08 Europe/Berlin`);
    const [{ s }] = await asServer("select public.courier_state($1) as s", [courier.token]);
    const g = s.groups[0];
    const anna = g.orders.find((o: any) => o.driver_name === "Anna");
    await asServer("select public.courier_take_group($1, $2)", [courier.token, g.group_id]);
    const [{ r }] = await asServer("select public.courier_confirm($1, $2, $3, 53.4301, 12.7001, 8, 'Am Feldrand, rote Kiste') as r", [
      courier.token, g.group_id, [anna.order_id],
    ]);
    expect(r.notification_ids).toHaveLength(1);

    const rows = await run("postgres", `select d.name, o.delivery_status from public.orders o
      join public.drivers d on d.id = o.driver_id order by d.name`);
    expect(rows).toEqual([{ name: "Anna", delivery_status: "zugestellt" }, { name: "Bert", delivery_status: "unterwegs" }]);
    const [c] = await run("postgres", `select c.lat, c.place_note, k.name, c.confirmed_at from public.delivery_confirmations c
      join public.couriers k on k.id = c.courier_id`);
    expect(c).toMatchObject({ lat: 53.4301, place_note: "Am Feldrand, rote Kiste", name: "Lena" });
    expect(c.confirmed_at.toISOString()).toBe("2026-11-04T11:08:00.000Z");
  });

  it("verschickt bei wiederholter Bestätigung keine zweite Benachrichtigung", async () => {
    const { courier } = await twoInOneGroup();
    setNow(`${D} 12:00 Europe/Berlin`);
    const [{ s }] = await asServer("select public.courier_state($1) as s", [courier.token]);
    const ids = s.groups[0].orders.map((o: any) => o.order_id);
    const [{ r: r1 }] = await asServer("select public.courier_confirm($1, $2, $3, 53.43, 12.7) as r", [courier.token, s.groups[0].group_id, ids]);
    const [{ r: r2 }] = await asServer("select public.courier_confirm($1, $2, $3, 53.43, 12.7) as r", [courier.token, s.groups[0].group_id, ids]);
    expect(r1.notification_ids).toHaveLength(2);
    expect(r2).toMatchObject({ already_confirmed: true, notification_ids: [] });
    const [{ n, c }] = await run("postgres", `select (select count(*)::int from public.notifications) as n,
                                                    (select count(*)::int from public.delivery_confirmations) as c`);
    expect({ n, c }).toEqual({ n: 2, c: 1 });
  });

  it("lehnt Bestellungen aus fremden Gruppen und Bestätigungen ohne Ablageort ab", async () => {
    const { courier } = await twoInOneGroup();
    setNow(`${D} 07:00 Europe/Berlin`);
    const carl = await createDriver(office, "Carl");
    await placeOrder(carl.token, D);
    await setLocation(carl.token, D, 53.5, 12.9);
    setNow(`${D} 12:00 Europe/Berlin`);
    const [{ s }] = await asServer("select public.courier_state($1) as s", [courier.token]);
    const near = s.groups.find((g: any) => g.orders.length === 2);
    const far = s.groups.find((g: any) => g.orders.length === 1);
    await expectError(asServer("select public.courier_confirm($1, $2, $3, 53.43, 12.7)", [
      courier.token, near.group_id, [far.orders[0].order_id],
    ]), "UNGUELTIGE_AUSWAHL");
    await expectError(asServer("select public.courier_confirm($1, $2, $3, null, null, null, null)", [
      courier.token, near.group_id, [near.orders[0].order_id],
    ]), "ABLAGEORT_FEHLT");
  });

  it("zeigt dem Fahrer Ablagezeit und Ablageort", async () => {
    const { anna, courier } = await twoInOneGroup();
    setNow(`${D} 12:08 Europe/Berlin`);
    const [{ s }] = await asServer("select public.courier_state($1) as s", [courier.token]);
    await asServer("select public.courier_confirm($1, $2, $3, 53.4302, 12.7003, 5, null)", [
      courier.token, s.groups[0].group_id, s.groups[0].orders.map((o: any) => o.order_id),
    ]);
    const [{ st }] = await asServer("select public.driver_state($1) as st", [anna.token]);
    expect(st.today.status).toBe("zugestellt");
    expect(st.today.delivery).toMatchObject({ lat: 53.4302, lng: 12.7003 });
    expect(new Date(st.today.delivery.confirmed_at).toISOString()).toBe("2026-11-04T11:08:00.000Z");
  });
});

describe("Rollen und Berechtigungen", () => {
  it("lässt anonyme Nutzer weder Tabellen lesen noch Funktionen aufrufen", async () => {
    await expectError(run("anon", "select * from public.orders"), "permission denied");
    await expectError(run("anon", "select public.driver_state('x')"), "permission denied");
    await expectError(run("anon", "select public.office_dashboard(current_date)"), "permission denied");
  });

  it("lässt angemeldete Nutzer ohne Mitarbeiterrolle nichts sehen und nichts aufrufen", async () => {
    const [{ id }] = await run("postgres", "insert into auth.users (id) values (gen_random_uuid()) returning id");
    await expectError(run("authenticated", "select public.driver_state('x')", [], { uid: id }), "permission denied");
    await expectError(run("authenticated", "select public.office_dashboard(current_date)", [], { uid: id }), "KEINE_BERECHTIGUNG");
    expect(await run("authenticated", "select * from public.daily_meals", [], { uid: id })).toEqual([]);
  });

  it("verbietet Clients direkte Schreibzugriffe", async () => {
    await expectError(
      run("authenticated", "update public.orders set status = 'storniert'", [], { uid: office }),
      "permission denied",
    );
    await expectError(
      run("authenticated", "insert into public.ratings (order_id, driver_id, meal_id, service_date, score) values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), current_date, 5)", [], { uid: office }),
      "permission denied",
    );
  });

  it("trennt Küche und Büro", async () => {
    setNow(`${D} 08:00 Europe/Berlin`);
    await expectError(asStaff(kitchen, "select public.office_dashboard($1)", [D]), "KEINE_BERECHTIGUNG");
    await expectError(asStaff(kitchen, "select public.office_save_driver(null, 'X')"), "KEINE_BERECHTIGUNG");
    expect(await asStaff(kitchen, "select * from public.ratings")).toEqual([]);
    const [{ k }] = await asStaff(kitchen, "select public.kitchen_overview($1) as k", [D]);
    expect(k.meal.internal_price).toBe(6.5);
    await asStaff(office, "select public.kitchen_save_meal($1, 'Eintopf', null, 5, true)", [D]);
  });

  it("zeigt Fahrern niemals den internen Preis", async () => {
    setNow(`${D} 08:00 Europe/Berlin`);
    const f = await createDriver(office, "Anna");
    const [{ s }] = await asServer("select public.driver_state($1) as s", [f.token]);
    expect(s.order_day.meal.name).toBe("Gulasch mit Klößen");
    expect(JSON.stringify(s)).not.toMatch(/price|6\.5/);
  });

  it("speichert Tokens nur als Hash, sperrt alte Links beim Neuerzeugen und lehnt gesperrte ab", async () => {
    setNow(`${D} 08:00 Europe/Berlin`);
    const f = await createDriver(office, "Anna");
    const [{ n }] = await run("postgres", "select count(*)::int as n from public.access_tokens where encode(token_hash, 'escape') like '%' || $1 || '%'", [f.token]);
    expect(n).toBe(0);
    const [{ t2 }] = await asStaff(office, "select public.office_issue_token('fahrer', $1) as t2", [f.id]);
    await expectError(asServer("select public.driver_state($1)", [f.token]), "UNGUELTIGER_LINK");
    await asServer("select public.driver_state($1)", [t2]);
    await asStaff(office, "select public.office_revoke_token('fahrer', $1)", [f.id]);
    await expectError(asServer("select public.driver_state($1)", [t2]), "UNGUELTIGER_LINK");
    await expectError(asServer("select public.driver_state($1)", ["erfunden"]), "UNGUELTIGER_LINK");
  });

  it("verhindert Zugriff auf fremde Bestellungen und Lieferfahrer-Funktionen mit Fahrerlink", async () => {
    setNow(`${D} 08:00 Europe/Berlin`);
    const anna = await createDriver(office, "Anna");
    const bert = await createDriver(office, "Bert");
    await placeOrder(anna.token, D, "geheim");
    const [{ s }] = await asServer("select public.driver_state($1) as s", [bert.token]);
    expect(JSON.stringify(s)).not.toContain("geheim");
    expect(s.order_day.order).toBeNull();
    await expectError(asServer("select public.driver_cancel_order($1, $2)", [bert.token, D]), "KEINE_BESTELLUNG");
    await expectError(asServer("select public.courier_state($1)", [anna.token]), "UNGUELTIGER_LINK");
  });

  it("sperrt deaktivierte Fahrer", async () => {
    setNow(`${D} 08:00 Europe/Berlin`);
    const f = await createDriver(office, "Anna");
    await asStaff(office, "select public.office_save_driver($1, 'Anna', null, null, false)", [f.id]);
    await expectError(placeOrder(f.token, D), "UNGUELTIGER_LINK");
  });
});
