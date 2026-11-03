import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { AppError } from "../errors";
import { usingLocalDatabase } from "./rpc";

export type StaffContext = { as: "staff"; uid: string; accessToken?: string };

export const DEV_STAFF_COOKIE = "dev_staff";

/** Supabase-Client mit der Anmeldung aus den Cookies (Server). */
export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // In Server Components nicht setzbar – die Middleware erneuert die Sitzung.
        }
      },
    },
  });
}

/** Angemeldeter Mitarbeiter. Die Rolle prüft anschließend jede Datenbankfunktion selbst. */
export async function staffContext(): Promise<StaffContext> {
  if (usingLocalDatabase()) {
    // Lokale Entwicklung ohne Supabase: Auswahl eines Mitarbeiters auf /login.
    const uid = (await cookies()).get(DEV_STAFF_COOKIE)?.value;
    if (!uid || !/^[0-9a-f-]{36}$/.test(uid)) throw new AppError("NICHT_ANGEMELDET");
    return { as: "staff", uid };
  }
  const supabase = await supabaseServer();
  const { data: userData } = await supabase.auth.getUser(); // prüft das Token bei Supabase
  if (!userData.user) throw new AppError("NICHT_ANGEMELDET");
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new AppError("NICHT_ANGEMELDET");
  return { as: "staff", uid: userData.user.id, accessToken: data.session.access_token };
}
