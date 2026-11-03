import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/fahrer/[action]/route";
import { setRpcCallerForTests } from "@/lib/server/rpc";
import { closeDb, createDriver, createStaff, resetData, run, saveMeal, setNow } from "./helpers/db";

const D = "2026-11-04";

// Die API läuft gegen die Test-Datenbank – mit derselben Rolle wie in Produktion (service_role).
beforeAll(() => {
  setRpcCallerForTests(async (fn, args, ctx) => {
    const keys = Object.keys(args);
    const sql = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`;
    const role = ctx.as === "server" ? "service_role" : "authenticated";
    try {
      const [row] = await run(role, sql, keys.map((k) => args[k]), ctx.as === "staff" ? { uid: ctx.uid } : {});
      return row?.r ?? null;
    } catch (e) {
      const { toAppError } = await import("@/lib/errors");
      throw toAppError(e);
    }
  });
});
afterAll(async () => {
  setRpcCallerForTests(null);
  await closeDb();
});

let token: string;
beforeEach(async () => {
  await resetData();
  const office = await createStaff("buero");
  const kitchen = await createStaff("kueche");
  setNow("2026-11-03 14:00 Europe/Berlin");
  await saveMeal(kitchen, D);
  token = (await createDriver(office, "Anna")).token;
  setNow(`${D} 08:00 Europe/Berlin`);
});

const params = (action: string) => ({ params: Promise.resolve({ action }) });
const req = (action: string, body?: unknown, t: string | null = token) =>
  new Request(`http://localhost/api/fahrer/${action}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(t ? { "x-access-token": t } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe("Fahrer-API", () => {
  it("liefert den Zustand und führt Bestellung und Standort durch", async () => {
    let res = await GET(req("state"), params("state"));
    expect(res.status).toBe(200);
    expect((await res.json()).data.order_day.can_order).toBe(true);

    res = await POST(req("order", { service_date: D, note: "ohne Soße" }), params("order"));
    expect(res.status).toBe(200);
    res = await POST(req("location", { service_date: D, lat: 53.43, lng: 12.7, source: "gps", accuracy: 12 }), params("location"));
    expect(res.status).toBe(200);

    const s = (await (await GET(req("state"), params("state"))).json()).data;
    expect(s.today).toMatchObject({ status: "offen", location: { lat: 53.43, source: "gps" } });
    expect(s.order_day.order.note).toBe("ohne Soße");
  });

  it("meldet Fristverstöße verständlich mit Status 409", async () => {
    setNow(`${D} 09:00 Europe/Berlin`);
    const res = await POST(req("order", { service_date: D }), params("order"));
    expect(res.status).toBe(409);
    const j = await res.json();
    expect(j.error.code).toBe("BESTELLSCHLUSS");
    expect(j.error.message).toMatch(/9:00 Uhr/);
  });

  it("lehnt fehlende oder falsche Tokens mit 401 ab", async () => {
    expect((await GET(req("state", undefined, null), params("state"))).status).toBe(401);
    expect((await GET(req("state", undefined, "A".repeat(43)), params("state"))).status).toBe(401);
  });

  it("prüft Eingaben (Bewertung, Koordinaten, Quelle)", async () => {
    const bad = [
      ["rating", { order_id: "00000000-0000-0000-0000-000000000000", score: 6 }],
      ["location", { service_date: D, lat: 53.4, source: "gps" }],
      ["location", { service_date: D, lat: 53.4, lng: 12.7, source: "buero" }],
      ["location", { service_date: D, source: "adresse", address: "" }],
      ["order", { service_date: "4.11.2026" }],
    ] as const;
    for (const [action, body] of bad) {
      const res = await POST(req(action, body), params(action));
      expect(res.status, `${action} ${JSON.stringify(body)}`).toBe(400);
    }
  });

  it("speichert Push-Abos nur mit https-Endpunkt", async () => {
    const keys = { p256dh: "B".repeat(87), auth: "C".repeat(22) };
    let res = await POST(req("push", { endpoint: "http://unsicher.example/x", keys }), params("push"));
    expect(res.status).toBe(400);
    res = await POST(req("push", { endpoint: "https://push.example/abc", keys }), params("push"));
    expect(res.status).toBe(200);
    const [{ n }] = await run("postgres", "select count(*)::int as n from public.push_subscriptions");
    expect(n).toBe(1);
  });
});
