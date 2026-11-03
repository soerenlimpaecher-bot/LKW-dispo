import { NextResponse } from "next/server";
import { z } from "zod";
import { body, handle } from "@/lib/server/http";
import { localPool, usingLocalDatabase } from "@/lib/server/rpc";
import { DEV_STAFF_COOKIE } from "@/lib/server/staff";

// Nur lokale Entwicklung ohne Supabase: Mitarbeiter auswählen statt Passwort.
// In Produktion (NODE_ENV=production) immer 404.

export const dynamic = "force-dynamic";

export async function GET() {
  if (!usingLocalDatabase()) return new NextResponse(null, { status: 404 });
  return handle(async () => {
    const r = await localPool().query("select user_id, name, role from public.staff where active order by role, name");
    return r.rows;
  });
}

export async function POST(req: Request) {
  if (!usingLocalDatabase()) return new NextResponse(null, { status: 404 });
  const { uid } = await body(req, z.object({ uid: z.string().uuid() }));
  const res = NextResponse.json({ data: true });
  res.cookies.set(DEV_STAFF_COOKIE, uid, { httpOnly: true, sameSite: "lax", path: "/" });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ data: true });
  res.cookies.delete(DEV_STAFF_COOKIE);
  return res;
}
