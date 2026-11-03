"use client";

import { useEffect, useState } from "react";
import { Button, Card, Notice } from "@/components/ui";
import { api } from "@/lib/client/api";
import { staffRpc, supabaseBrowser } from "@/lib/client/staff";

type Me = { role: "buero" | "kueche" };
type DevStaff = { user_id: string; name: string; role: string };

async function goHome() {
  const me = await staffRpc<Me | null>("staff_me");
  if (!me) throw new Error("Für dieses Konto ist keine Rolle (Büro/Küche) hinterlegt.");
  window.location.href = me.role === "kueche" ? "/kueche" : "/buero";
}

export default function LoginPage() {
  const [dev, setDev] = useState<DevStaff[] | null | undefined>(undefined);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/dev-login")
      .then(async (r) => setDev(r.ok ? (await r.json()).data : null))
      .catch(() => setDev(null));
  }, []);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { error } = await supabaseBrowser().auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw new Error("Anmeldung fehlgeschlagen. Bitte E-Mail und Passwort prüfen.");
      await goHome();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function devLogin(uid: string) {
    setError(null);
    try {
      await api("/api/dev-login", { body: { uid } });
      await goHome();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 px-4">
      <div>
        <p className="text-xs font-semibold tracking-wide text-brand-700 uppercase">Agrarlohn Essensservice</p>
        <h1 className="text-2xl font-bold">Anmeldung Büro / Küche</h1>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {dev === undefined ? null : dev ? (
        <Card>
          <Notice tone="warn">Lokale Entwicklungsumgebung ohne Supabase – Mitarbeiter auswählen.</Notice>
          <div className="mt-3 grid gap-2">
            {dev.map((s) => (
              <Button key={s.user_id} variant="secondary" onClick={() => devLogin(s.user_id)}>
                {s.name} ({s.role === "buero" ? "Büro" : "Küche"})
              </Button>
            ))}
          </div>
        </Card>
      ) : (
        <Card>
          <form onSubmit={login} className="grid gap-3">
            <label className="grid gap-1 text-sm">
              E-Mail
              <input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)}
                className="rounded-xl px-3 py-3 text-base ring-1 ring-stone-300 focus:ring-2 focus:ring-brand-600 focus:outline-none" />
            </label>
            <label className="grid gap-1 text-sm">
              Passwort
              <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)}
                className="rounded-xl px-3 py-3 text-base ring-1 ring-stone-300 focus:ring-2 focus:ring-brand-600 focus:outline-none" />
            </label>
            <Button type="submit" busy={busy}>Anmelden</Button>
          </form>
        </Card>
      )}
    </main>
  );
}
