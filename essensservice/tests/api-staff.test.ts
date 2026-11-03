import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setRpcCallerForTests } from "@/lib/server/rpc";
import { toAppError } from "@/lib/errors";
import { closeDb, createDriver, createStaff, placeOrder, resetData, run, saveMeal, setNow } from "./helpers/db";

// Angemeldeter Mitarbeiter wird je Test gesetzt (statt Supabase-Cookie).
let currentUid = "";
vi.mock("@/lib/server/staff", () => ({ staffContext: async () => ({ as: "staff", uid: currentUid }) }));
const { POST } = await import("@/app/api/staff/[fn]/route");

const D = "2026-11-04";
let office: string;
let kitchen: string;

beforeAll(() => {
  setRpcCallerForTests(async (fn, args, ctx) => {
    const keys = Object.keys(args);
    const sql = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`;
    try {
      const [row] = await run(ctx.as === "server" ? "service_role" : "authenticated", sql, keys.map((k) => args[k]),
        ctx.as === "staff" ? { uid: ctx.uid } : {});
      return row?.r ?? null;
    } catch (e) {
      throw toAppError(e);
    }
  });
});
afterAll(async () => {
  setRpcCallerForTests(null);
  await closeDb();
});
beforeEach(async () => {
  await resetData();
  office = await createStaff("buero");
  kitchen = await createStaff("kueche");
  setNow("2026-11-03 14:00 Europe/Berlin");
  await saveMeal(kitchen, D);
});

const call = (fn: string, body: unknown) =>
  POST(new Request(`http://localhost/api/staff/${fn}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }), {
    params: Promise.resolve({ fn }),
  });

describe("Büro-/Küchen-API", () => {
  it("lässt nur freigegebene Funktionen zu", async () => {
    currentUid = office;
    expect((await call("regroup_day", { p_date: D })).status).toBe(404);
    expect((await call("driver_state", { p_token: "x" })).status).toBe(404);
    expect((await call("office_day", { p_date: D, p_hack: 1 })).status).toBe(400);
  });

  it("trennt die Rollen: Küche darf keine Büro-Funktionen nutzen", async () => {
    currentUid = kitchen;
    const res = await call("office_day", { p_date: D });
    expect(res.status).toBe(403);
    expect((await call("kitchen_overview", { p_date: D })).status).toBe(200);
  });

  it("liefert die Tagesansicht und setzt fehlende optionale Werte sinnvoll", async () => {
    currentUid = office;
    const f = await createDriver(office, "Anna");
    setNow(`${D} 08:00 Europe/Berlin`);
    await placeOrder(f.token, D);
    const day = (await (await call("office_day", { p_date: D })).json()).data;
    expect(day.orders).toHaveLength(1);
    const audit = (await (await call("office_audit", { p_date: D })).json()).data;
    expect(audit.length).toBeGreaterThan(1); // ohne p_limit nicht auf 1 begrenzt
    const res = await call("office_save_driver", { p_name: "Bert" });
    expect(res.status).toBe(200);
    const drivers = (await (await call("office_drivers", {})).json()).data;
    expect(drivers.find((d: { name: string }) => d.name === "Bert").active).toBe(true);
  });
});
