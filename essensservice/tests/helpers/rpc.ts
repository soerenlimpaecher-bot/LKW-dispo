import { toAppError } from "@/lib/errors";
import { setRpcCallerForTests } from "@/lib/server/rpc";
import { run } from "./db";

/** API-Routen in Tests gegen die Test-Datenbank laufen lassen (mit fester Testuhr). */
export function useTestDatabaseForRpc() {
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
}
