import { NextResponse } from "next/server";
import { sendNotifications } from "@/lib/server/push";

// Geplante Wiederholung fälliger Push-Nachrichten (z. B. Vercel Cron alle 5 Minuten).
// Vercel sendet automatisch „Authorization: Bearer <CRON_SECRET>“.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: { code: "KEINE_BERECHTIGUNG" } }, { status: 401 });
  }
  const summary = await sendNotifications();
  return NextResponse.json({ data: summary });
}
