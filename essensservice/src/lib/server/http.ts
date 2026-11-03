import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError, toAppError } from "../errors";

/** Einheitliche JSON-Antworten; Fehler immer als { error: { code, message } }. */
export async function handle(fn: () => Promise<unknown>) {
  try {
    const data = await fn();
    return NextResponse.json({ data: data ?? null }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const err = e instanceof z.ZodError ? new AppError("EINGABE_UNGUELTIG") : toAppError(e);
    if (err.status >= 500) console.error(e);
    return NextResponse.json(
      { error: { code: err.code, message: err.message } },
      { status: err.status, headers: { "Cache-Control": "no-store" } },
    );
  }
}

/** Token aus dem Header – nicht aus der API-URL, damit es nicht in Server-Logs landet. */
export function accessToken(req: Request) {
  const t = req.headers.get("x-access-token") ?? "";
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(t)) throw new AppError("UNGUELTIGER_LINK");
  return t;
}

export async function body<T extends z.ZodTypeAny>(req: Request, schema: T): Promise<z.infer<T>> {
  const json = await req.json().catch(() => null);
  return schema.parse(json);
}

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const lat = z.number().min(-90).max(90);
export const lng = z.number().min(-180).max(180);
