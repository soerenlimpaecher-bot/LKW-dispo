import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  asServer, asStaff, closeDb, createDriver, createStaff, groupsOf, offset, placeOrder, resetData, run,
  saveMeal, setLocation, setNow,
} from "./helpers/db";

const D = "2026-11-04";
const BASE = { lat: 53.43, lng: 12.7 };
let office: string;

beforeEach(async () => {
  await resetData();
  office = await createStaff("buero");
  const kitchen = await createStaff("kueche");
  setNow("2026-11-03 14:00 Europe/Berlin");
  await saveMeal(kitchen, D);
  setNow(`${D} 07:00 Europe/Berlin`);
});
afterAll(closeDb);

async function driverAt(name: string, northM: number, eastM: number) {
  const f = await createDriver(office, name);
  await placeOrder(f.token, D);
  const p = offset(BASE.lat, BASE.lng, northM, eastM);
  await setLocation(f.token, D, p.lat, p.lng);
  return f;
}

async function maxPairwiseDistance(date: string) {
  const [{ m }] = await run(
    "postgres",
    `select coalesce(max(public.distance_m(l1.lat, l1.lng, l2.lat, l2.lng)), 0) as m
       from public.group_assignments a1
       join public.group_assignments a2 on a2.group_id = a1.group_id and a2.order_id > a1.order_id
       join public.delivery_locations l1 on l1.order_id = a1.order_id and l1.is_current
       join public.delivery_locations l2 on l2.order_id = a2.order_id and l2.is_current
       join public.delivery_groups g on g.id = a1.group_id
      where g.service_date = $1`,
    [date],
  );
  return Number(m);
}

describe("Automatische Gruppenbildung (max. 500 m)", () => {
  it("fasst nahe Standorte zusammen und trennt entfernte", async () => {
    await driverAt("Anna", 0, 0);
    await driverAt("Bert", 120, 80);
    await driverAt("Carl", 3000, 0);
    const g = await groupsOf(D);
    expect(g.map((x) => x.names)).toEqual([["Anna", "Bert"], ["Carl"]]);
  });

  it("hält 500 m paarweise ein – auch bei Ketten (A–B 400 m, B–C 400 m, A–C 800 m)", async () => {
    await driverAt("Anna", 0, 0);
    await driverAt("Bert", 0, 400);
    await driverAt("Carl", 0, 800);
    const g = await groupsOf(D);
    expect(g).toHaveLength(2);
    expect(g.flatMap((x) => x.names).sort()).toEqual(["Anna", "Bert", "Carl"]);
    expect(await maxPairwiseDistance(D)).toBeLessThanOrEqual(500);
  });

  it("lässt genau 500 m zu und trennt bei 501 m", async () => {
    await driverAt("Anna", 0, 0);
    await driverAt("Bert", 0, 499.9);
    await driverAt("Carl", 5000, 0);
    await driverAt("Dora", 5000, 501);
    const g = await groupsOf(D);
    expect(g.map((x) => x.names)).toEqual([["Anna", "Bert"], ["Carl"], ["Dora"]]);
  });

  it("hält die Grenze bei vielen zufälligen Standorten ein und ordnet jeden genau einmal zu", async () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 40; i++) await driverAt(`F${String(i).padStart(2, "0")}`, rnd() * 2500, rnd() * 2500);
    expect(await maxPairwiseDistance(D)).toBeLessThanOrEqual(500);
    const [{ n, u }] = await run(
      "postgres",
      "select count(*)::int as n, count(distinct order_id)::int as u from public.group_assignments",
    );
    expect(n).toBe(40);
    expect(u).toBe(40);
  });

  it("mischt Fahrer unterschiedlicher Kunden in einer Gruppe", async () => {
    const [{ id: a }] = await asStaff(office, "select public.office_save_driver(null, 'Anna', 'Kunde A') as id");
    const [{ id: b }] = await asStaff(office, "select public.office_save_driver(null, 'Bert', 'Kunde B') as id");
    for (const id of [a, b]) {
      const [{ id: o }] = await asStaff(office, "select public.office_save_order($1, $2) as id", [id, D]);
      await asStaff(office, "select public.office_set_location($1, 53.43, 12.7)", [o]);
    }
    expect((await groupsOf(D)).map((x) => x.names)).toEqual([["Anna", "Bert"]]);
  });

  it("zeigt Fahrer ohne Standort separat und gruppiert neu, wenn sich ein Standort ändert", async () => {
    const anna = await driverAt("Anna", 0, 0);
    const bert = await createDriver(office, "Bert");
    await placeOrder(bert.token, D);
    let [{ k }] = await asStaff(office, "select public.kitchen_overview($1) as k", [D]);
    expect(k.ungrouped.map((o: any) => o.driver_name)).toEqual(["Bert"]);

    const near = offset(BASE.lat, BASE.lng, 50, 0);
    await setLocation(bert.token, D, near.lat, near.lng);
    expect((await groupsOf(D)).map((x) => x.names)).toEqual([["Anna", "Bert"]]);

    const far = offset(BASE.lat, BASE.lng, 2000, 0);
    await setLocation(anna.token, D, far.lat, far.lng);
    expect((await groupsOf(D)).map((x) => x.names).sort()).toEqual([["Anna"], ["Bert"]]);
  });

  it("entfernt stornierte Bestellungen aus den Gruppen", async () => {
    const anna = await driverAt("Anna", 0, 0);
    await driverAt("Bert", 50, 0);
    await asServer("select public.driver_cancel_order($1, $2)", [anna.token, D]);
    expect((await groupsOf(D)).map((x) => x.names)).toEqual([["Bert"]]);
  });

  it("legt keinen gemeinsamen Ablageort fest – individuelle Standorte bleiben", async () => {
    await driverAt("Anna", 0, 0);
    await driverAt("Bert", 100, 0);
    const cols = await run(
      "postgres",
      "select column_name from information_schema.columns where table_name = 'delivery_groups'",
    );
    expect(cols.map((c) => c.column_name)).not.toEqual(expect.arrayContaining(["lat", "lng"]));
    const [{ n }] = await run("postgres", "select count(*)::int as n from public.delivery_locations where is_current");
    expect(n).toBe(2);
  });
});

describe("Schutz manueller Gruppenzuordnungen", () => {
  it("überschreibt eine manuelle Verschiebung nicht automatisch", async () => {
    await driverAt("Anna", 0, 0);
    const bert = await driverAt("Bert", 50, 0);
    const [{ id: bertOrder }] = await run("postgres", "select o.id from public.orders o join public.drivers d on d.id = o.driver_id where d.name = 'Bert'");
    await asStaff(office, "select public.office_move_order($1, null)", [bertOrder]);
    expect((await groupsOf(D)).map((x) => x.names)).toEqual([["Anna"], ["Bert"]]);

    // Standortänderung und neue Fahrer lösen Neugruppierung aus – Bert bleibt, wo das Büro ihn hingesetzt hat.
    const p = offset(BASE.lat, BASE.lng, 10, 0);
    await setLocation(bert.token, D, p.lat, p.lng);
    await driverAt("Carl", 20, 0);
    const g = await groupsOf(D);
    expect(g.find((x) => x.names.includes("Bert"))!.names).toEqual(["Bert"]);
    expect(g.find((x) => x.names.includes("Carl"))!.names).toEqual(["Anna", "Carl"]);
  });

  it("lässt zusammengelegte und getrennte Gruppen in Ruhe", async () => {
    await driverAt("Anna", 0, 0);
    await driverAt("Bert", 3000, 0);
    let g = await run("postgres", "select id, seq from public.delivery_groups order by seq");
    await asStaff(office, "select public.office_merge_groups($1, $2)", [g[0].id, [g[1].id]]);
    await driverAt("Carl", 3010, 0);
    let groups = await groupsOf(D);
    expect(groups.find((x) => x.names.includes("Anna"))!.names).toEqual(["Anna", "Bert"]);
    expect(groups.find((x) => x.names.includes("Carl"))!.names).toEqual(["Carl"]);

    const [{ gid }] = await run("postgres", "select group_id as gid from public.group_assignments a join public.orders o on o.id = a.order_id join public.drivers d on d.id = o.driver_id where d.name = 'Anna'");
    const [{ oid }] = await run("postgres", "select o.id as oid from public.orders o join public.drivers d on d.id = o.driver_id where d.name = 'Bert'");
    await asStaff(office, "select public.office_split_group($1, $2)", [gid, [oid]]);
    await driverAt("Dora", 5, 0);
    groups = await groupsOf(D);
    expect(groups.find((x) => x.names.includes("Anna"))!.names).toEqual(["Anna"]);
    expect(groups.find((x) => x.names.includes("Bert"))!.names).toEqual(["Bert"]);
    expect(groups.find((x) => x.names.includes("Dora"))!.names).toEqual(["Dora"]);
  });

  it("nach Freigabe für die Automatik wird wieder automatisch gruppiert", async () => {
    await driverAt("Anna", 0, 0);
    await driverAt("Bert", 50, 0);
    const [{ id }] = await run("postgres", "select o.id from public.orders o join public.drivers d on d.id = o.driver_id where d.name = 'Bert'");
    await asStaff(office, "select public.office_move_order($1, null)", [id]);
    await asStaff(office, "select public.office_unlock_orders($1)", [[id]]);
    expect((await groupsOf(D)).map((x) => x.names)).toEqual([["Anna", "Bert"]]);
  });

  it("friert die Gruppen ab 10:30 ein; nur das Büro ändert noch", async () => {
    await driverAt("Anna", 0, 0);
    const [{ id }] = await run("postgres", "select id from public.orders");
    setNow(`${D} 10:45 Europe/Berlin`);
    const p = offset(BASE.lat, BASE.lng, 50, 0);
    const bert = await createDriver(office, "Bert");
    const [{ id: bo }] = await asStaff(office, "select public.office_save_order($1, $2) as id", [bert.id, D]);
    await asStaff(office, "select public.office_set_location($1, $2, $3)", [bo, p.lat, p.lng]);
    expect((await groupsOf(D)).map((x) => x.names)).toEqual([["Anna"]]);
    const [{ k }] = await asStaff(office, "select public.kitchen_overview($1) as k", [D]);
    expect(k.phase).toBe("endgueltig");
    expect(k.ungrouped).toEqual([expect.objectContaining({ driver_name: "Bert", changed_after_final: true })]);
    await asStaff(office, "select public.office_move_order($1, (select group_id from public.group_assignments where order_id = $2))", [bo, id]);
    expect((await groupsOf(D)).map((x) => x.names)).toEqual([["Anna", "Bert"]]);
  });
});
