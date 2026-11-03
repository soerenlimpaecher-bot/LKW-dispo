import { z } from "zod";
import { body, handle, isoDate } from "@/lib/server/http";
import { sendNotifications } from "@/lib/server/push";
import { rpc } from "@/lib/server/rpc";
import { staffContext } from "@/lib/server/staff";

// Büro: fehlgeschlagene Benachrichtigungen eines Tages sofort erneut senden.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request) {
  return handle(async () => {
    const { date } = await body(req, z.object({ date: isoDate }));
    // Rollenprüfung (nur Büro) in der Datenbankfunktion
    const ids = await rpc<string[]>("office_failed_notification_ids", { p_date: date }, await staffContext());
    if (!ids.length) return { sent: 0, failed: 0, no_subscription: 0 };
    return sendNotifications({ ids, force: true });
  });
}
