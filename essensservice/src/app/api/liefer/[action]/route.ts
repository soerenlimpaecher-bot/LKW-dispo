import { z } from "zod";
import { AppError } from "@/lib/errors";
import { accessToken, body, handle, lat, lng } from "@/lib/server/http";
import { sendNotifications } from "@/lib/server/push";
import { rpc } from "@/lib/server/rpc";

// Lieferfahrer-API (Token im Header x-access-token). Regeln prüft die Datenbank.

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const server = { as: "server" } as const;

export async function GET(req: Request, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  return handle(async () => {
    if (action !== "state") throw new AppError("NICHT_GEFUNDEN");
    return rpc("courier_state", { p_token: accessToken(req) }, server);
  });
}

const take = z.object({ group_id: z.string().uuid() });
const confirm = z
  .object({
    group_id: z.string().uuid(),
    order_ids: z.array(z.string().uuid()).min(1).max(200),
    lat: lat.nullish(),
    lng: lng.nullish(),
    accuracy: z.number().min(0).max(100000).nullish(),
    place_note: z.string().trim().max(300).nullish(),
  })
  .refine((v) => (v.lat == null) === (v.lng == null), "Koordinaten unvollständig");

export async function POST(req: Request, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  return handle(async () => {
    const token = accessToken(req);
    if (action === "take") {
      const b = await body(req, take);
      return rpc("courier_take_group", { p_token: token, p_group: b.group_id }, server);
    }
    if (action === "confirm") {
      const b = await body(req, confirm);
      const r = await rpc<{ confirmation_id: string | null; already_confirmed: boolean; notification_ids: string[] }>(
        "courier_confirm",
        {
          p_token: token, p_group: b.group_id, p_orders: b.order_ids, p_lat: b.lat ?? null, p_lng: b.lng ?? null,
          p_accuracy: b.accuracy ?? null, p_place_note: b.place_note ?? null,
        },
        server,
      );
      // Die Zustellung ist gespeichert. Push-Fehler ändern daran nichts.
      let push = null;
      if (r.notification_ids.length) {
        push = await sendNotifications({ ids: r.notification_ids, immediateRetries: 2 }).catch((e) => {
          console.error("Push-Versand", e);
          return null;
        });
      }
      return { ...r, push };
    }
    throw new AppError("NICHT_GEFUNDEN");
  });
}
