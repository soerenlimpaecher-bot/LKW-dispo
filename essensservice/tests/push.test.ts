import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as courierPOST } from "@/app/api/liefer/[action]/route";
import { sendNotifications, setPushSenderForTests, type PushSender } from "@/lib/server/push";
import { setRpcCallerForTests } from "@/lib/server/rpc";
import {
  asServer, closeDb, createCourier, createDriver, createStaff, offset, placeOrder, resetData, run, saveMeal, setLocation, setNow,
} from "./helpers/db";
import { useTestDatabaseForRpc } from "./helpers/rpc";

const D = "2026-11-04";
type Sent = { endpoint: string; payload: { title: string; body: string; tag: string } };
let sent: Sent[] = [];
let behaviour: (endpoint: string) => number = () => 201; // HTTP-Status des Push-Dienstes

const fakeSender: PushSender = async (sub, payload) => {
  const status = behaviour(sub.endpoint);
  if (status >= 400) throw Object.assign(new Error(`Push-Dienst ${status}`), { statusCode: status });
  sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
};

beforeAll(() => {
  useTestDatabaseForRpc();
  setPushSenderForTests(fakeSender);
});
afterAll(async () => {
  setRpcCallerForTests(null);
  setPushSenderForTests(null);
  await closeDb();
});

let anna: { id: string; token: string };
let bert: { id: string; token: string };
let carl: { id: string; token: string };
let courier: { id: string; token: string };

beforeEach(async () => {
  await resetData();
  sent = [];
  behaviour = () => 201;
  const office = await createStaff("buero");
  const kitchen = await createStaff("kueche");
  setNow("2026-11-03 14:00 Europe/Berlin");
  await saveMeal(kitchen, D);
  setNow(`${D} 08:00 Europe/Berlin`);
  anna = await createDriver(office, "Anna");
  bert = await createDriver(office, "Bert");
  carl = await createDriver(office, "Carl"); // gleiche Gruppe, aber nicht abgelegt
  for (const [f, n] of [[anna, 0], [bert, 40], [carl, 80]] as const) {
    await placeOrder(f.token, D);
    const p = offset(53.43, 12.7, n, 0);
    await setLocation(f.token, D, p.lat, p.lng);
  }
  for (const [f, ep] of [[anna, "https://push.example/anna"], [carl, "https://push.example/carl"]] as const) {
    await asServer("select public.driver_save_push_subscription($1, $2, 'BKEY', 'AUTH')", [f.token, ep]);
  }
  courier = await createCourier(office, "Lena");
  setNow(`${D} 12:08 Europe/Berlin`);
});

async function confirmViaApi(names: string[]) {
  const [{ s }] = await asServer("select public.courier_state($1) as s", [courier.token]);
  const g = s.groups[0];
  const ids = g.orders.filter((o: { driver_name: string }) => names.includes(o.driver_name)).map((o: { order_id: string }) => o.order_id);
  const res = await courierPOST(
    new Request("http://localhost/api/liefer/confirm", {
      method: "POST",
      headers: { "content-type": "application/json", "x-access-token": courier.token },
      body: JSON.stringify({ group_id: g.group_id, order_ids: ids, lat: 53.4301, lng: 12.7001, accuracy: 6, place_note: "Kiste am Tor" }),
    }),
    { params: Promise.resolve({ action: "confirm" }) },
  );
  return { status: res.status, body: await res.json() };
}

const statuses = async () =>
  run("postgres", `select d.name, n.status, n.attempts from public.notifications n join public.drivers d on d.id = n.driver_id order by d.name`);

describe("Push-Benachrichtigungen", () => {
  it("benachrichtigt nach der Ablage nur die betroffenen Fahrer, mit Uhrzeit", async () => {
    const r = await confirmViaApi(["Anna", "Bert"]);
    expect(r.status).toBe(200);
    expect(r.body.data.push).toEqual({ sent: 1, failed: 0, no_subscription: 1 });
    expect(sent.map((s) => s.endpoint)).toEqual(["https://push.example/anna"]); // Carl wurde nicht abgelegt
    expect(sent[0].payload.title).toBe("Dein Essen ist da!");
    expect(sent[0].payload.body).toContain("um 12:08 Uhr abgelegt");
    expect(await statuses()).toEqual([
      { name: "Anna", status: "gesendet", attempts: 1 },
      { name: "Bert", status: "kein_abo", attempts: 1 },
    ]);
  });

  it("schickt bei wiederholter Bestätigung keine zweite Nachricht", async () => {
    await confirmViaApi(["Anna"]);
    const again = await confirmViaApi(["Anna"]);
    expect(again.body.data.already_confirmed).toBe(true);
    await sendNotifications({ force: true });
    expect(sent).toHaveLength(1);
  });

  it("wiederholt vorübergehende Fehler und plant weitere Versuche", async () => {
    behaviour = () => 503;
    const r = await confirmViaApi(["Anna"]);
    expect(r.status).toBe(200); // Zustellung bleibt gespeichert
    expect(r.body.data.push.failed).toBe(1);
    let [n] = await run("postgres", "select status, attempts, next_attempt_at is not null as planned, last_error from public.notifications");
    expect(n).toMatchObject({ status: "fehlgeschlagen", attempts: 3, planned: true });
    expect(n.last_error).toContain("503");
    const [{ ds }] = await run("postgres", "select delivery_status::text as ds from public.orders o join public.drivers d on d.id = o.driver_id where d.name = 'Anna'");
    expect(ds).toBe("zugestellt");

    // vor der geplanten Zeit passiert nichts, danach klappt es
    behaviour = () => 201;
    expect(await sendNotifications()).toEqual({ sent: 0, failed: 0, no_subscription: 0 });
    setNow(`${D} 12:30 Europe/Berlin`);
    expect(await sendNotifications()).toEqual({ sent: 1, failed: 0, no_subscription: 0 });
    [n] = await run("postgres", "select status, attempts from public.notifications");
    expect(n).toEqual({ status: "gesendet", attempts: 4 });
  });

  it("gibt nach fünf Versuchen auf", async () => {
    behaviour = () => 500;
    await confirmViaApi(["Anna"]);
    for (let i = 0; i < 5; i++) await sendNotifications({ force: true });
    const [n] = await run("postgres", "select status, attempts from public.notifications");
    expect(n).toEqual({ status: "fehlgeschlagen", attempts: 5 });
  });

  it("sperrt abgelaufene Abos (410) und meldet „kein Abo“", async () => {
    behaviour = () => 410;
    await confirmViaApi(["Anna"]);
    const [n] = await run("postgres", "select status from public.notifications");
    expect(n.status).toBe("kein_abo");
    const [p] = await run("postgres", "select revoked_at is not null as revoked from public.push_subscriptions where endpoint like '%anna'");
    expect(p.revoked).toBe(true);
  });

  it("reserviert Nachrichten, damit parallele Versandläufe nicht doppelt senden", async () => {
    const [{ s }] = await asServer("select public.courier_state($1) as s", [courier.token]);
    const g = s.groups[0];
    const annaOrder = g.orders.find((o: { driver_name: string }) => o.driver_name === "Anna").order_id;
    await asServer("select public.courier_confirm($1, $2, $3, 53.43, 12.7)", [courier.token, g.group_id, [annaOrder]]);
    const [{ first }] = await asServer("select public.push_claim(null, false, 100) as first");
    const [{ second }] = await asServer("select public.push_claim(null, true, 100) as second");
    expect(first).toHaveLength(1);
    expect(second).toEqual([]); // noch reserviert (2 Minuten)
    setNow(`${D} 12:11 Europe/Berlin`); // Reservierung abgelaufen, z. B. nach Absturz eines Laufs
    expect(await sendNotifications({ force: true })).toEqual({ sent: 1, failed: 0, no_subscription: 0 });
    void bert;
  });
});
