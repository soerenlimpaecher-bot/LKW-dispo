import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { toAppError } from "../errors";

// Einheitlicher Zugriff auf die Datenbankfunktionen.
// - Produktion: Supabase (PostgREST). Fahrer-/Lieferfahrer-Funktionen mit service_role,
//   Büro/Küche mit dem Zugriffstoken des angemeldeten Mitarbeiters (RLS + Rollenprüfung greifen).
// - Entwicklung/Test: direkte PostgreSQL-Verbindung (LOCAL_DATABASE_URL), Rollen wie in Supabase.

export type RpcContext = { as: "server" } | { as: "staff"; accessToken?: string; uid?: string };
export type RpcCaller = (fn: string, args: Record<string, unknown>, ctx: RpcContext) => Promise<unknown>;

const NAME = /^[a-z_]+$/;

const supabaseCaller: RpcCaller = async (fn, args, ctx) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const client =
    ctx.as === "server"
      ? createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
      : createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
          auth: { persistSession: false },
          global: { headers: { Authorization: `Bearer ${ctx.accessToken}` } },
        });
  const { data, error } = await client.rpc(fn, args);
  if (error) throw toAppError(error);
  return data;
};

let pool: pg.Pool | null = null;
export function localPool() {
  pool ??= new pg.Pool({ connectionString: process.env.LOCAL_DATABASE_URL, max: 5 });
  return pool;
}

const pgCaller: RpcCaller = async (fn, args, ctx) => {
  const keys = Object.keys(args);
  if (!NAME.test(fn) || !keys.every((k) => NAME.test(k))) throw new Error("Ungültiger Funktionsname");
  const sql = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`;
  const c = await localPool().connect();
  try {
    await c.query("begin");
    if (ctx.as === "staff") {
      await c.query("select set_config('request.jwt.claim.sub', $1, true)", [ctx.uid ?? ""]);
      await c.query("set local role authenticated");
    } else {
      await c.query("set local role service_role");
    }
    const res = await c.query(sql, keys.map((k) => args[k]));
    await c.query("commit");
    return res.rows[0]?.r ?? null;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw toAppError(e);
  } finally {
    c.release();
  }
};

/** Lokale Datenbank nur außerhalb der Produktion. */
export function usingLocalDatabase() {
  return Boolean(process.env.LOCAL_DATABASE_URL) && process.env.NODE_ENV !== "production";
}

let override: RpcCaller | null = null;
/** Nur für Tests: eigenen Aufrufer einsetzen. */
export function setRpcCallerForTests(c: RpcCaller | null) {
  override = c;
}

export function rpc<T = unknown>(fn: string, args: Record<string, unknown>, ctx: RpcContext): Promise<T> {
  const caller = override ?? (usingLocalDatabase() ? pgCaller : supabaseCaller);
  return caller(fn, args, ctx) as Promise<T>;
}
