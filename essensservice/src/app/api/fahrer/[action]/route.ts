import { z } from "zod";
import { AppError } from "@/lib/errors";
import { accessToken, body, handle, isoDate, lat, lng } from "@/lib/server/http";
import { rpc } from "@/lib/server/rpc";

// Fahrer-API. Das Token des persönlichen Links kommt im Header x-access-token.
// Alle Regeln (Fristen, Bewertungspflicht, eigene Daten) prüft die Datenbank.

export const dynamic = "force-dynamic";

const server = { as: "server" } as const;

export async function GET(req: Request, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  return handle(async () => {
    if (action !== "state") throw new AppError("NICHT_GEFUNDEN");
    return rpc("driver_state", { p_token: accessToken(req) }, server);
  });
}

const schemas = {
  order: z.object({ service_date: isoDate, note: z.string().max(500).nullish() }),
  cancel: z.object({ service_date: isoDate }),
  rating: z.object({ order_id: z.string().uuid(), score: z.number().int().min(1).max(5) }),
  location: z
    .object({
      service_date: isoDate,
      lat: lat.nullish(),
      lng: lng.nullish(),
      address: z.string().trim().max(300).nullish(),
      source: z.enum(["gps", "karte", "adresse"]),
      accuracy: z.number().min(0).max(100000).nullish(),
    })
    .refine((v) => (v.lat == null) === (v.lng == null), "Koordinaten unvollständig")
    .refine((v) => v.lat != null || (v.address ?? "").length > 0, "Standort fehlt"),
  push: z.object({
    endpoint: z.string().url().startsWith("https://").max(1000),
    keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(10).max(100) }),
  }),
};

export async function POST(req: Request, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  return handle(async () => {
    const token = accessToken(req);
    switch (action) {
      case "order": {
        const b = await body(req, schemas.order);
        return rpc("driver_place_order", { p_token: token, p_service_date: b.service_date, p_note: b.note ?? null }, server);
      }
      case "cancel": {
        const b = await body(req, schemas.cancel);
        return rpc("driver_cancel_order", { p_token: token, p_service_date: b.service_date }, server);
      }
      case "rating": {
        const b = await body(req, schemas.rating);
        return rpc("driver_rate", { p_token: token, p_order_id: b.order_id, p_score: b.score }, server);
      }
      case "location": {
        const b = await body(req, schemas.location);
        return rpc(
          "driver_set_location",
          {
            p_token: token, p_service_date: b.service_date, p_lat: b.lat ?? null, p_lng: b.lng ?? null,
            p_address: b.address ?? null, p_source: b.source, p_accuracy: b.accuracy ?? null,
          },
          server,
        );
      }
      case "push": {
        const b = await body(req, schemas.push);
        return rpc(
          "driver_save_push_subscription",
          { p_token: token, p_endpoint: b.endpoint, p_p256dh: b.keys.p256dh, p_auth: b.keys.auth },
          server,
        );
      }
      default:
        throw new AppError("NICHT_GEFUNDEN");
    }
  });
}
