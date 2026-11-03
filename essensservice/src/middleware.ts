import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Erneuert die Supabase-Sitzung für Büro und Küche und leitet Nicht-Angemeldete zur Anmeldung.
// In der lokalen Entwicklung ohne Supabase übernimmt das Cookie aus /login diese Aufgabe.

export async function middleware(req: NextRequest) {
  const local = Boolean(process.env.LOCAL_DATABASE_URL) && process.env.NODE_ENV !== "production";
  const isPage = !req.nextUrl.pathname.startsWith("/api/");

  if (local) {
    if (isPage && !req.cookies.get("dev_staff")) return NextResponse.redirect(new URL("/login", req.url));
    return NextResponse.next();
  }

  let res = NextResponse.next({ request: req });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });
  const { data } = await supabase.auth.getUser();
  if (!data.user && isPage) return NextResponse.redirect(new URL("/login", req.url));
  return res;
}

export const config = { matcher: ["/buero/:path*", "/kueche/:path*", "/api/staff/:path*", "/api/push/:path*"] };
