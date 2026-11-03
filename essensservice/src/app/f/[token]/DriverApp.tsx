"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Notice, Spinner, StatusBadge } from "@/components/ui";
import { ApiError, api } from "@/lib/client/api";
import { pushSupport, registerServiceWorker, subscribeToPush } from "@/lib/client/push";
import { fmtDay, fmtTime, navigationUrl, type EffectiveStatus } from "@/lib/format";
import type { Point } from "@/components/map/MapPicker";

const MapPicker = dynamic(() => import("@/components/map/MapPicker"), {
  ssr: false,
  loading: () => <div className="h-80 animate-pulse rounded-xl bg-stone-200" />,
});

type Location = { lat: number | null; lng: number | null; address: string | null; source: string; set_at: string };
type DriverState = {
  now: string;
  driver: { name: string };
  push_subscribed: boolean;
  pending_rating: { order_id: string; service_date: string; meal_name: string } | null;
  order_day: {
    service_date: string;
    order_deadline: string;
    meal: { name: string; description: string | null; available: boolean } | null;
    order: { id: string; status: "bestellt" | "storniert"; note: string | null } | null;
    can_order: boolean;
  };
  today: {
    service_date: string;
    order_id: string;
    meal_name: string;
    status: EffectiveStatus;
    location_deadline: string;
    can_change_location: boolean;
    location: Location | null;
    delivery: { confirmed_at: string; lat: number | null; lng: number | null; place_note: string | null } | null;
  } | null;
};

export default function DriverApp({ token }: { token: string }) {
  const [state, setState] = useState<DriverState | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setState(await api<DriverState>("/api/fahrer/state", { token }));
      setFatal(null);
    } catch (e) {
      if (e instanceof ApiError && e.code === "UNGUELTIGER_LINK") setFatal(e.message);
      else setError((e as Error).message);
    }
  }, [token]);

  useEffect(() => {
    load();
    registerServiceWorker().catch(() => {});
    const t = setInterval(load, 60_000);
    const onVis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load]);

  async function act(name: string, path: string, body: unknown) {
    setBusy(name);
    setError(null);
    try {
      await api(path, { token, body });
      await load();
      return true;
    } catch (e) {
      setError((e as Error).message);
      await load();
      return false;
    } finally {
      setBusy(null);
    }
  }

  if (fatal) {
    return (
      <Shell>
        <Card>
          <p className="text-lg font-semibold">Link nicht gültig</p>
          <p className="mt-2 text-stone-600">{fatal}</p>
        </Card>
      </Shell>
    );
  }
  if (!state) return <Shell>{error ? <Notice tone="error">{error}</Notice> : <Spinner />}</Shell>;

  const od = state.order_day;
  const today = state.today;
  const orderDayIsToday = today?.service_date === od.service_date;

  return (
    <Shell name={state.driver.name}>
      {error && <Notice tone="error">{error}</Notice>}

      {/* Nach 09:00 steht das heutige Essen oben, die Bestellung für morgen darunter. */}
      {today && !orderDayIsToday && (
        <TodayCard
          today={today}
          heading="Dein Essen heute"
          busy={busy === "location"}
          onLocation={(loc) => act("location", "/api/fahrer/location", { service_date: today.service_date, ...loc })}
        />
      )}

      {state.pending_rating ? (
        <RatingCard
          rating={state.pending_rating}
          busy={busy === "rating"}
          onRate={(score) => act("rating", "/api/fahrer/rating", { order_id: state.pending_rating!.order_id, score })}
        />
      ) : (
        <OrderCard
          od={od}
          now={state.now}
          busy={busy}
          onOrder={(note) => act("order", "/api/fahrer/order", { service_date: od.service_date, note })}
          onCancel={() => act("cancel", "/api/fahrer/cancel", { service_date: od.service_date })}
        />
      )}

      {today && orderDayIsToday && (
        <TodayCard
          today={today}
          heading="Lieferung heute"
          busy={busy === "location"}
          onLocation={(loc) => act("location", "/api/fahrer/location", { service_date: today.service_date, ...loc })}
        />
      )}

      <PushCard token={token} subscribed={state.push_subscribed} onDone={load} />
    </Shell>
  );
}

function Shell({ name, children }: { name?: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col gap-4 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-10">
      <header className="flex items-center justify-between pt-1">
        <div>
          <p className="text-xs font-semibold tracking-wide text-brand-700 uppercase">Agrarlohn Essensservice</p>
          {name && <h1 className="text-2xl font-bold">Hallo {name}</h1>}
        </div>
      </header>
      {children}
    </div>
  );
}

const RATING_LABELS = ["Sehr schlecht", "Schlecht", "Mittelmäßig", "Gut", "Sehr gut"];

function RatingCard({
  rating,
  busy,
  onRate,
}: {
  rating: NonNullable<DriverState["pending_rating"]>;
  busy: boolean;
  onRate: (score: number) => void;
}) {
  return (
    <Card className="ring-2 ring-amber-300">
      <p className="text-sm font-semibold text-amber-800">Vor der nächsten Bestellung</p>
      <h2 className="mt-1 text-xl font-bold">Wie war dein Essen?</h2>
      <p className="mt-1 text-stone-600">
        {rating.meal_name} · {fmtDay(rating.service_date)}
      </p>
      <div className="mt-4 grid gap-2">
        {[5, 4, 3, 2, 1].map((score) => (
          <Button key={score} variant="secondary" size="xl" disabled={busy} onClick={() => onRate(score)} className="justify-between">
            <span>{RATING_LABELS[score - 1]}</span>
            <span aria-label={`${score} von 5 Punkten`} className="tracking-widest text-amber-500">
              {"★".repeat(score)}
              <span className="text-stone-300">{"★".repeat(5 - score)}</span>
            </span>
          </Button>
        ))}
      </div>
    </Card>
  );
}

function OrderCard({
  od,
  now,
  busy,
  onOrder,
  onCancel,
}: {
  od: DriverState["order_day"];
  now: string;
  busy: string | null;
  onOrder: (note: string | null) => Promise<boolean>;
  onCancel: () => Promise<boolean>;
}) {
  const [note, setNote] = useState(od.order?.note ?? "");
  const [editNote, setEditNote] = useState(false);
  const open = new Date(now) < new Date(od.order_deadline);
  const ordered = od.order?.status === "bestellt";

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-stone-500">{fmtDay(od.service_date)}</p>
          <h2 className="text-xl font-bold">{od.meal?.name ?? "Noch kein Gericht eingetragen"}</h2>
          {od.meal?.description && <p className="mt-1 text-stone-600">{od.meal.description}</p>}
        </div>
        {ordered && <StatusBadge status="offen" />}
      </div>

      {!od.meal && <p className="mt-3 text-stone-600">Die Küche trägt das Tagesgericht am Vortag ein. Schau später noch einmal vorbei.</p>}
      {od.meal && !od.meal.available && <Notice tone="warn">Das Gericht ist für diesen Tag nicht verfügbar.</Notice>}

      {od.meal && (
        <div className="mt-4 grid gap-3">
          {ordered ? (
            <>
              <Notice tone="ok">
                Du hast bestellt.{od.order?.note ? ` Hinweis: ${od.order.note}` : ""}
              </Notice>
              {open && (
                <>
                  {editNote ? (
                    <NoteField note={note} setNote={setNote} />
                  ) : null}
                  <div className="grid grid-cols-2 gap-2">
                    {editNote ? (
                      <Button busy={busy === "order"} onClick={async () => (await onOrder(note || null)) && setEditNote(false)}>
                        Speichern
                      </Button>
                    ) : (
                      <Button variant="secondary" onClick={() => setEditNote(true)}>
                        Hinweis ändern
                      </Button>
                    )}
                    <Button variant="danger" busy={busy === "cancel"} onClick={() => confirm("Bestellung wirklich stornieren?") && onCancel()}>
                      Stornieren
                    </Button>
                  </div>
                </>
              )}
            </>
          ) : od.can_order ? (
            <>
              <NoteField note={note} setNote={setNote} />
              <Button size="xl" busy={busy === "order"} onClick={() => onOrder(note || null)}>
                Essen bestellen
              </Button>
            </>
          ) : (
            open && <p className="text-stone-600">Bestellen ist gerade nicht möglich.</p>
          )}
          <p className="text-sm text-stone-500">
            {open
              ? `Bestellen, ändern oder stornieren bis ${fmtTime(od.order_deadline)} Uhr.`
              : "Bestellschluss erreicht. Änderungen nur noch über das Büro."}
          </p>
        </div>
      )}
    </Card>
  );
}

function NoteField({ note, setNote }: { note: string; setNote: (s: string) => void }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-stone-600">Hinweis für Küche/Lieferung (optional)</span>
      <input
        value={note}
        maxLength={500}
        onChange={(e) => setNote(e.target.value)}
        placeholder="z. B. ohne Soße"
        className="rounded-xl px-3 py-3 text-base ring-1 ring-stone-300 focus:ring-2 focus:ring-brand-600 focus:outline-none"
      />
    </label>
  );
}

function TodayCard({
  today,
  heading,
  busy,
  onLocation,
}: {
  today: NonNullable<DriverState["today"]>;
  heading: string;
  busy: boolean;
  onLocation: (loc: { lat?: number; lng?: number; address?: string; source: "gps" | "karte" | "adresse"; accuracy?: number }) => Promise<boolean>;
}) {
  const d = today.delivery;
  return (
    <Card className={d ? "ring-2 ring-brand-500" : ""}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm text-stone-500">{heading}</p>
          <h2 className="text-xl font-bold">{today.meal_name}</h2>
        </div>
        <StatusBadge status={today.status} />
      </div>

      {d ? (
        <div className="mt-4 grid gap-3">
          <p className="text-2xl font-bold text-brand-700">Dein Essen ist da!</p>
          <p className="text-lg">Abgelegt um {fmtTime(d.confirmed_at)} Uhr.</p>
          {d.place_note && <p className="text-stone-700">Ablageort: {d.place_note}</p>}
          {d.lat != null && d.lng != null && (
            <>
              <MapPicker value={{ lat: d.lat, lng: d.lng }} readOnly height={240} />
              <a href={navigationUrl(d.lat, d.lng)} target="_blank" rel="noreferrer" className="block">
                <Button size="xl" className="w-full">
                  Ablageort in Karten-App öffnen
                </Button>
              </a>
            </>
          )}
        </div>
      ) : (
        <LocationEditor today={today} busy={busy} onLocation={onLocation} />
      )}
    </Card>
  );
}

function LocationEditor({
  today,
  busy,
  onLocation,
}: {
  today: NonNullable<DriverState["today"]>;
  busy: boolean;
  onLocation: (loc: { lat?: number; lng?: number; address?: string; source: "gps" | "karte" | "adresse"; accuracy?: number }) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<null | "karte" | "adresse">(null);
  const [point, setPoint] = useState<Point | null>(null);
  const [address, setAddress] = useState("");
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const loc = today.location;
  const hasCoords = loc?.lat != null && loc?.lng != null;

  function useGps() {
    setGpsError(null);
    if (!("geolocation" in navigator)) return setGpsError("Dieses Gerät kann den Standort nicht bestimmen.");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (p) => {
        setLocating(false);
        await onLocation({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, source: "gps" });
      },
      (err) => {
        setLocating(false);
        setGpsError(
          err.code === err.PERMISSION_DENIED
            ? "Standortfreigabe abgelehnt. Bitte in den Einstellungen erlauben oder auf der Karte wählen."
            : "Standort konnte nicht bestimmt werden. Bitte auf der Karte wählen.",
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  }

  return (
    <div className="mt-4 grid gap-3">
      <div>
        <p className="font-semibold">Lieferstandort</p>
        {loc ? (
          <p className="text-stone-600">
            {hasCoords ? "Punkt gesetzt" : "Nur Adresse – das Büro setzt den Punkt auf der Karte"}
            {loc.address ? ` · ${loc.address}` : ""} · {fmtTime(loc.set_at)} Uhr
          </p>
        ) : (
          <Notice tone="warn">Noch kein Standort. Bitte festlegen, damit dein Essen zu dir kommt.</Notice>
        )}
      </div>

      {hasCoords && mode === null && <MapPicker value={{ lat: loc!.lat!, lng: loc!.lng! }} readOnly height={200} />}

      {today.can_change_location ? (
        <>
          {mode === null && (
            <div className="grid gap-2">
              <Button size="xl" busy={locating || busy} onClick={useGps}>
                Aktuellen Standort übernehmen
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" onClick={() => { setPoint(hasCoords ? { lat: loc!.lat!, lng: loc!.lng! } : null); setMode("karte"); }}>
                  Auf Karte wählen
                </Button>
                <Button variant="secondary" onClick={() => { setAddress(loc?.address ?? ""); setMode("adresse"); }}>
                  Adresse eingeben
                </Button>
              </div>
            </div>
          )}
          {gpsError && <Notice tone="error">{gpsError}</Notice>}

          {mode === "karte" && (
            <div className="grid gap-2">
              <p className="text-sm text-stone-600">Tippe auf die Karte oder verschiebe den Punkt.</p>
              <MapPicker value={point} onChange={setPoint} />
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" onClick={() => setMode(null)}>Abbrechen</Button>
                <Button
                  disabled={!point}
                  busy={busy}
                  onClick={async () => point && (await onLocation({ ...point, source: "karte" })) && setMode(null)}
                >
                  Punkt speichern
                </Button>
              </div>
            </div>
          )}

          {mode === "adresse" && (
            <div className="grid gap-2">
              <input
                value={address}
                maxLength={300}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Straße und Ort oder Name des Feldes"
                className="rounded-xl px-3 py-3 text-base ring-1 ring-stone-300 focus:ring-2 focus:ring-brand-600 focus:outline-none"
              />
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" onClick={() => setMode(null)}>Abbrechen</Button>
                <Button
                  disabled={address.trim().length < 3}
                  busy={busy}
                  onClick={async () => (await onLocation({ address: address.trim(), source: "adresse" })) && setMode(null)}
                >
                  Speichern
                </Button>
              </div>
            </div>
          )}
          <p className="text-sm text-stone-500">Standort ändern bis {fmtTime(today.location_deadline)} Uhr.</p>
        </>
      ) : (
        <p className="text-sm text-stone-500">Standortänderungen sind jetzt nur noch über das Büro möglich.</p>
      )}
    </div>
  );
}

function PushCard({ token, subscribed, onDone }: { token: string; subscribed: boolean; onDone: () => void }) {
  const [support, setSupport] = useState<ReturnType<typeof pushSupport> | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => setSupport(pushSupport()), []);
  if (subscribed || support === null) return null;

  async function enable() {
    setBusy(true);
    setMsg(null);
    try {
      const sub = await subscribeToPush();
      if (!sub) {
        setMsg("Benachrichtigungen wurden nicht erlaubt.");
        return;
      }
      await api("/api/fahrer/push", { token, body: { endpoint: sub.endpoint, keys: sub.keys } });
      onDone();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <p className="font-semibold">Benachrichtigung bei Lieferung</p>
      {support === "ok" && (
        <>
          <p className="mt-1 text-stone-600">Wir sagen dir Bescheid, sobald dein Essen abgelegt wurde.</p>
          <Button className="mt-3 w-full" variant="secondary" busy={busy} onClick={enable}>
            Benachrichtigungen aktivieren
          </Button>
        </>
      )}
      {support === "ios-install" && (
        <p className="mt-1 text-stone-600">
          Auf dem iPhone: unten auf „Teilen“ tippen, dann „Zum Home-Bildschirm“. Danach die App vom Home-Bildschirm öffnen und
          Benachrichtigungen aktivieren.
        </p>
      )}
      {support === "denied" && <p className="mt-1 text-stone-600">Benachrichtigungen sind in den Browser-Einstellungen blockiert.</p>}
      {support === "unsupported" && <p className="mt-1 text-stone-600">Dieser Browser unterstützt keine Benachrichtigungen.</p>}
      {msg && <p className="mt-2 text-sm text-red-700">{msg}</p>}
    </Card>
  );
}
