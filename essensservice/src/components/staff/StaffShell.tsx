"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { Spinner } from "@/components/ui";
import { staffRpc, supabaseBrowser, supabaseConfigured } from "@/lib/client/staff";

export type Me = { user_id: string; name: string; role: "buero" | "kueche" };
const MeContext = createContext<Me | null>(null);
export const useMe = () => useContext(MeContext)!;

const NAV = {
  buero: [
    ["/buero", "Übersicht"],
    ["/buero/karte", "Karte & Gruppen"],
    ["/buero/bestellungen", "Bestellungen"],
    ["/buero/fahrer", "Fahrer & Links"],
    ["/kueche", "Küche"],
    ["/buero/bewertungen", "Bewertungen"],
    ["/buero/protokoll", "Protokoll"],
  ],
  kueche: [["/kueche", "Küche"]],
} as const;

export async function logout() {
  if (supabaseConfigured()) await supabaseBrowser().auth.signOut();
  await fetch("/api/dev-login", { method: "DELETE" }).catch(() => {});
  window.location.href = "/login";
}

export default function StaffShell({ need, children }: { need: "buero" | "kueche"; children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const path = usePathname();

  useEffect(() => {
    staffRpc<Me | null>("staff_me")
      .then((m) => {
        if (!m) return setError("Für dieses Konto ist keine Rolle hinterlegt.");
        if (need === "buero" && m.role !== "buero") return void (window.location.href = "/kueche");
        setMe(m);
      })
      .catch((e) => (e.code === "NICHT_ANGEMELDET" ? (window.location.href = "/login") : setError(e.message)));
  }, [need]);

  if (error) return <p className="p-6 text-red-700">{error}</p>;
  if (!me) return <Spinner />;

  return (
    <MeContext.Provider value={me}>
      <div className="min-h-dvh">
        <header className="no-print sticky top-0 z-[1000] border-b border-stone-200 bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2">
            <Link href={me.role === "buero" ? "/buero" : "/kueche"} className="font-bold text-brand-700">
              Essensservice
            </Link>
            <nav className="flex flex-wrap gap-1 text-sm">
              {NAV[me.role].map(([href, label]) => (
                <Link
                  key={href}
                  href={href}
                  className={`rounded-lg px-3 py-1.5 font-medium ${path === href ? "bg-brand-100 text-brand-900" : "text-stone-600 hover:bg-stone-100"}`}
                >
                  {label}
                </Link>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-3 text-sm text-stone-600">
              <span>{me.name}</span>
              <button onClick={logout} className="rounded-lg px-2 py-1 hover:bg-stone-100">Abmelden</button>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-[1600px] px-4 py-4">{children}</main>
      </div>
    </MeContext.Provider>
  );
}
