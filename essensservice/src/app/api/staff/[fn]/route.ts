import { z } from "zod";
import { AppError } from "@/lib/errors";
import { body, handle } from "@/lib/server/http";
import { rpc } from "@/lib/server/rpc";
import { staffContext } from "@/lib/server/staff";

// Büro-/Küchen-API: nur freigegebene Funktionen mit genau diesen Parametern.
// Rolle und Fachregeln prüft die Datenbankfunktion (als angemeldeter Mitarbeiter).

export const dynamic = "force-dynamic";

const ALLOWED: Record<string, string[]> = {
  staff_me: [],
  office_dashboard: ["p_date"],
  office_day: ["p_date"],
  office_drivers: [],
  office_couriers: [],
  office_save_driver: ["p_id", "p_name", "p_customer_hint", "p_phone", "p_active"],
  office_save_courier: ["p_id", "p_name", "p_active"],
  office_issue_token: ["p_subject", "p_id"],
  office_revoke_token: ["p_subject", "p_id"],
  office_save_order: ["p_driver", "p_service_date", "p_note"],
  office_cancel_order: ["p_order"],
  office_set_location: ["p_order", "p_lat", "p_lng", "p_address"],
  office_location_history: ["p_order"],
  office_move_order: ["p_order", "p_group"],
  office_merge_groups: ["p_target", "p_sources"],
  office_split_group: ["p_group", "p_orders"],
  office_unlock_orders: ["p_orders"],
  office_regroup: ["p_date"],
  office_release_group: ["p_group"],
  office_notifications: ["p_date"],
  office_audit: ["p_date", "p_limit"],
  rating_stats: ["p_from", "p_to"],
  kitchen_save_meal: ["p_service_date", "p_name", "p_description", "p_price", "p_available"],
  kitchen_overview: ["p_date"],
  kitchen_meals: ["p_from", "p_to"],
};

const scalar = z.union([z.string().max(1000), z.number().finite(), z.boolean(), z.null()]);
const value = z.union([scalar, z.array(z.string().max(100)).max(500)]);

export async function POST(req: Request, ctx: { params: Promise<{ fn: string }> }) {
  const { fn } = await ctx.params;
  return handle(async () => {
    const allowed = ALLOWED[fn];
    if (!allowed) throw new AppError("NICHT_GEFUNDEN");
    const args = await body(req, z.record(z.string(), value));
    if (Object.keys(args).some((k) => !allowed.includes(k))) throw new AppError("EINGABE_UNGUELTIG");
    // Fehlende optionale Parameter als null übergeben, damit die Funktion eindeutig ist.
    const full = Object.fromEntries(allowed.map((k) => [k, args[k] ?? null]));
    return rpc(fn, full, await staffContext());
  });
}
