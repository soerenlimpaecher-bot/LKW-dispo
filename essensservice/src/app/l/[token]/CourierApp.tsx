"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Notice, Spinner, StatusBadge } from "@/components/ui";
import { groupColor } from "@/components/map/leaflet-base";
import { ApiError, api } from "@/lib/client/api";
import { registerServiceWorker } from "@/lib/client/push";
import { fmtDay, fmtTime, navigationUrl, type EffectiveStatus } from "@/lib/format";

const PointsMap = dynamic(() => import("@/components/map/PointsMap"), {
  ssr: false,
  loading: () => <div className="h-72 animate-pulse rounded-xl bg-stone-200" />,
});

type COrder = { order_id: string; driver_name: string; note: string | null; status: EffectiveStatus; lat: number | null; lng: number | null; address: string | null };
type CGroup = { group_id: string; seq: number; taken: boolean; taken_by_me: boolean; orders: COrder[] };
type CState = { now: string; service_date: string; courier: { name: string }; meal_name: string | null; final_at: string; groups: CGroup[] };
type ConfirmResult = { already_confirmed: boolean; notification_ids: string[]; push: { sent: number; failed: number; no_subscription: number } | null };

export default function CourierApp({ token }: { token: string }) {
  const [state, setState] = useState<CState | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setState(await api<CState>("/api/liefer/state", { token }));
    } catch (e) {
      if (e instanceof ApiError && e.code === "UNGUELTIGER_LINK") setFatal(e.message);
      else setError((e as Error).message);
    }
  }, [token]);

  useEffect(() => {
    load();
    registerServiceWorker().catch(() => {});
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  if (fatal) return <Shell><Card><p className="text-lg font-semibold">Link nicht gültig</p><p className="mt-2 text-stone-600">{fatal}</p></Card></Shell>;
  if (!state) return <Shell>{error ? <Notice tone="error">{error}</Notice> : <Spinner />}</Shell>;

  const total = state.groups.reduce((s, g) => s + g.orders.length, 0);
  const done = state.groups.reduce((s, g) => s + g.orders.filter((o) => o.status === "zugestellt").length, 0);

  return (
    <Shell name={state.courier.name}>
      <Card className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm text-stone-500">{fmtDay(state.service_date)}</p>
          <p className="text-lg font-bold">{state.meal_name ?? "Kein Tagesgericht"}</p>
        </div>
        <div className="text-right">
          <p className="text-3xl font-bold tabular-nums">{done}/{total}</p>
          <p className="text-sm text-stone-500">zugestellt</p>
        </div>
      </Card>
      {error && <Notice tone="error">{error}</Notice>}

      {state.groups.length === 0 ? (
        <Card>
          <p className="font-semibold">Noch keine freigegebenen Liefergruppen.</p>
          <p className="mt-1 text-stone-600">Die Gruppen erscheinen hier automatisch ab {fmtTime(state.final_at)} Uhr oder sobald das Büro sie freigibt.</p>
        </Card>
      ) : (
        state.groups.map((g) => (
          <GroupCard key={g.group_id} g={g} token={token} open={open === g.group_id} onToggle={() => setOpen(open === g.group_id ? null : g.group_id)} onChanged={load} onError={setError} />
        ))
      )}
    </Shell>
  );
}

function Shell({ name, children }: { name?: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col gap-3 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-10">
      <header className="pt-1">
        <p className="text-xs font-semibold tracking-wide text-brand-700 uppercase">Essensauslieferung</p>
        {name && <h1 className="text-2xl font-bold">{name}</h1>}
      </header>
      {children}
    </div>
  );
}

function GroupCard({
  g, token, open, onToggle, onChanged, onError,
}: { g: CGroup; token: string; open: boolean; onToggle: () => void; onChanged: () => Promise<void>; onError: (m: string | null) => void }) {
  const pending = g.orders.filter((o) => o.status !== "zugestellt");
  const [busy, setBusy] = useState(false);
  const color = groupColor(g.seq);
  const first = pending.find((o) => o.lat != null);

  async function take() {
    setBusy(true);
    onError(null);
    try {
      await api("/api/liefer/take", { token, body: { group_id: g.group_id } });
      await onChanged();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className={pending.length === 0 ? "opacity-70" : ""}>
      <button className="flex w-full items-center gap-3 text-left" onClick={onToggle} aria-expanded={open}>
        <span className="flex size-10 items-center justify-center rounded-full text-lg font-bold text-white" style={{ background: color }}>{g.seq}</span>
        <span className="flex-1">
          <span className="block text-lg font-bold">Gruppe {g.seq} · {g.orders.length} Essen</span>
          <span className="block text-sm text-stone-600">
            {pending.length === 0 ? "alles zugestellt" : `${pending.length} offen`}
            {g.taken && !g.taken_by_me ? " · fährt ein anderer Lieferfahrer" : g.taken_by_me ? " · von dir übernommen" : ""}
          </span>
        </span>
        <span className="text-2xl text-stone-400">{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div className="mt-3 grid gap-3">
          <PointsMap
            points={g.orders.filter((o) => o.lat != null).map((o) => ({
              id: o.order_id, lat: o.lat!, lng: o.lng!, label: o.status === "zugestellt" ? "✓" : String(g.seq), color: o.status === "zugestellt" ? "#78716c" : color, title: o.driver_name,
            }))}
          />
          <ul className="grid gap-2">
            {g.orders.map((o) => (
              <li key={o.order_id} className="flex items-center gap-2 rounded-xl bg-stone-50 px-3 py-2">
                <div className="flex-1">
                  <p className="font-semibold">{o.driver_name}</p>
                  {o.address && <p className="text-sm text-stone-600">{o.address}</p>}
                  {o.note && <p className="text-sm text-stone-600">Hinweis: {o.note}</p>}
                </div>
                <StatusBadge status={o.status} />
                {o.lat != null && o.status !== "zugestellt" && (
                  <a href={navigationUrl(o.lat, o.lng!)} target="_blank" rel="noreferrer" className="rounded-lg px-2 py-2 text-sm font-semibold text-brand-700 ring-1 ring-brand-500/40">Navi</a>
                )}
              </li>
            ))}
          </ul>
          {pending.length > 0 && (
            <>
              {!g.taken && (
                <Button size="xl" busy={busy} onClick={take}>Gruppe übernehmen – Essen ist unterwegs</Button>
              )}
              {first && (
                <a href={navigationUrl(first.lat!, first.lng!)} target="_blank" rel="noreferrer">
                  <Button size="lg" variant="secondary" className="w-full">Navigation zur Gruppe starten</Button>
                </a>
              )}
              {(!g.taken || g.taken_by_me) && <ConfirmPanel g={g} token={token} onDone={onChanged} onError={onError} />}
            </>
          )}
        </div>
      )}
    </Card>
  );
}

function ConfirmPanel({ g, token, onDone, onError }: { g: CGroup; token: string; onDone: () => Promise<void>; onError: (m: string | null) => void }) {
  const pending = g.orders.filter((o) => o.status !== "zugestellt");
  const [checked, setChecked] = useState<string[]>(pending.map((o) => o.order_id));
  const [drop, setDrop] = useState<{ lat: number; lng: number; accuracy?: number } | null>(null);
  const [note, setNote] = useState("");
  const [locating, setLocating] = useState(false);
  const [gpsMsg, setGpsMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  // Nur noch offene Essen zählen (nach einer Teilablage sind andere bereits zugestellt).
  const selected = checked.filter((id) => pending.some((o) => o.order_id === id));

  function locate() {
    if (!("geolocation" in navigator)) return setGpsMsg("Standort nicht verfügbar – bitte Ablageort beschreiben oder auf der Karte tippen.");
    setLocating(true);
    setGpsMsg(null);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        setDrop({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy });
      },
      () => {
        setLocating(false);
        setGpsMsg("Standort konnte nicht bestimmt werden – bitte auf der Karte tippen oder beschreiben.");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 },
    );
  }

  async function confirmDrop() {
    setBusy(true);
    onError(null);
    try {
      const r = await api<ConfirmResult>("/api/liefer/confirm", {
        token,
        body: { group_id: g.group_id, order_ids: selected, lat: drop?.lat ?? null, lng: drop?.lng ?? null, accuracy: drop?.accuracy ?? null, place_note: note.trim() || null },
      });
      setResult(
        r.already_confirmed
          ? "Diese Essen waren bereits bestätigt."
          : `Ablage gespeichert.${r.push ? ` Benachrichtigt: ${r.push.sent}${r.push.failed ? `, fehlgeschlagen: ${r.push.failed}` : ""}${r.push.no_subscription ? `, ohne Benachrichtigung: ${r.push.no_subscription}` : ""}.` : ""}`,
      );
      await onDone();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3 rounded-xl bg-brand-50 p-3 ring-1 ring-brand-100">
      <p className="text-lg font-bold">Ablage bestätigen</p>
      <div className="grid gap-1">
        <p className="text-sm text-stone-600">Nur die Essen anhaken, die du hier tatsächlich abgelegt hast:</p>
        {pending.map((o) => (
          <label key={o.order_id} className="flex items-center gap-3 rounded-lg bg-white px-3 py-3 text-base">
            <input type="checkbox" className="size-6" checked={checked.includes(o.order_id)}
              onChange={(e) => setChecked((c) => (e.target.checked ? [...c, o.order_id] : c.filter((x) => x !== o.order_id)))} />
            {o.driver_name}
          </label>
        ))}
      </div>
      <Button size="lg" variant="secondary" busy={locating} onClick={locate}>{drop ? "Standort neu bestimmen" : "Ablageort per GPS übernehmen"}</Button>
      {gpsMsg && <Notice tone="warn">{gpsMsg}</Notice>}
      {drop && (
        <>
          <PointsMap points={[]} drop={drop} onDrop={(lat, lng) => setDrop({ lat, lng })} height={220} />
          <p className="text-xs text-stone-600">Punkt bei Bedarf verschieben oder auf die Karte tippen.{drop.accuracy ? ` GPS-Genauigkeit ±${Math.round(drop.accuracy)} m.` : ""}</p>
        </>
      )}
      <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Ablageort beschreiben, z. B. Kiste am Tor"
        className="rounded-xl px-3 py-3 text-base ring-1 ring-stone-300 focus:ring-2 focus:ring-brand-600 focus:outline-none" />
      <Button size="xl" busy={busy} disabled={selected.length === 0 || (!drop && note.trim().length === 0)} onClick={confirmDrop}>
        {selected.length} Essen als abgelegt bestätigen
      </Button>
      {result && <Notice tone="ok">{result}</Notice>}
    </div>
  );
}
