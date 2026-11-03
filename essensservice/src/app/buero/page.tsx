"use client";

import Link from "next/link";
import { useState } from "react";
import { PageHead, useServiceDate } from "@/components/staff/DateNav";
import { Button, Card, Notice, Spinner } from "@/components/ui";
import { api } from "@/lib/client/api";
import { staffRpc, useLive } from "@/lib/client/staff";
import { addDays, fmtDateTime, fmtTime } from "@/lib/format";
import { hasCoords, type Dashboard, type Notification, type OfficeDay } from "@/lib/types";

export default function OfficeDashboard() {
  const date = useServiceDate();
  const { data, error, updatedAt, refresh } = useLive(
    async () => {
      const [d, day, notes] = await Promise.all([
        staffRpc<Dashboard>("office_dashboard", { p_date: date }),
        staffRpc<OfficeDay>("office_day", { p_date: date }),
        staffRpc<Notification[]>("office_notifications", { p_date: date }),
      ]);
      return { d, day, notes };
    },
    [date],
  );

  return (
    <>
      <PageHead title="Übersicht" date={date}>
        {updatedAt && <span className="text-xs text-stone-500">Stand {fmtTime(updatedAt.toISOString())} · aktualisiert sich selbst</span>}
      </PageHead>
      {error && <Notice tone="error">{error}</Notice>}
      {!data ? <Spinner /> : <Content {...data} date={date} refresh={refresh} />}
    </>
  );
}

function Tile({ label, value, tone = "plain", href }: { label: string; value: React.ReactNode; tone?: "plain" | "warn" | "ok" | "bad"; href?: string }) {
  const t = {
    plain: "bg-white ring-stone-200",
    warn: "bg-amber-50 ring-amber-200",
    ok: "bg-brand-50 ring-brand-100",
    bad: "bg-red-50 ring-red-200",
  }[tone];
  const inner = (
    <div className={`h-full rounded-2xl p-4 ring-1 ${t}`}>
      <p className="text-sm text-stone-600">{label}</p>
      <p className="mt-1 text-3xl font-bold tabular-nums">{value}</p>
    </div>
  );
  return href ? <Link href={href} className="block hover:opacity-90">{inner}</Link> : inner;
}

function Content({
  d,
  day,
  notes,
  date,
  refresh,
}: {
  d: Dashboard;
  day: OfficeDay;
  notes: Notification[];
  date: string;
  refresh: () => void;
}) {
  const [retrying, setRetrying] = useState(false);
  const [retryMsg, setRetryMsg] = useState<string | null>(null);
  const q = `?datum=${date}`;
  const missing = day.orders.filter((o) => o.status !== "storniert" && !hasCoords(o));
  const failed = notes.filter((n) => n.status === "fehlgeschlagen");
  const now = new Date(d.now);

  async function retry() {
    setRetrying(true);
    setRetryMsg(null);
    try {
      const r = await api<{ sent: number; failed: number; no_subscription: number }>("/api/push/retry", { body: { date } });
      setRetryMsg(`Erneut versucht: ${r.sent} gesendet, ${r.failed} fehlgeschlagen, ${r.no_subscription} ohne Abo.`);
      refresh();
    } catch (e) {
      setRetryMsg((e as Error).message);
    } finally {
      setRetrying(false);
    }
  }

  const steps = [
    { at: new Date(d.order_deadline).getTime() - 3600_000, label: "08:00 Zwischenstand" },
    { at: new Date(d.order_deadline).getTime(), label: "09:00 Bestellschluss" },
    { at: new Date(d.location_deadline).getTime(), label: "10:30 Gruppen endgültig" },
  ];

  return (
    <div className="grid gap-4">
      <Card className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div>
          <p className="text-sm text-stone-500">Tagesgericht</p>
          <p className="text-lg font-semibold">{d.meal?.name ?? "– noch nicht eingetragen –"}</p>
        </div>
        <ol className="flex flex-wrap gap-2 text-sm">
          {steps.map((s) => (
            <li key={s.label} className={`rounded-full px-3 py-1 ring-1 ${now.getTime() >= s.at ? "bg-brand-100 text-brand-900 ring-brand-500/30" : "bg-stone-50 text-stone-500 ring-stone-200"}`}>
              {now.getTime() >= s.at ? "✓ " : ""}{s.label}
            </li>
          ))}
        </ol>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Tile label="Aktive Fahrer" value={d.active_drivers} href="/buero/fahrer" />
        <Tile label="Bestellte Essen" value={d.ordered} tone="ok" href={`/buero/bestellungen${q}`} />
        <Tile label="Fahrer ohne Bestellung" value={d.drivers_without_order} href={`/buero/bestellungen${q}`} />
        <Tile label="Fehlende Standorte" value={d.missing_locations} tone={d.missing_locations ? "warn" : "plain"} href={`/buero/karte${q}`} />
        <Tile label="Liefergruppen" value={d.groups} href={`/buero/karte${q}`} />
        <Tile label="Bestellt (vor 9 Uhr)" value={d.open} />
        <Tile label="In Vorbereitung" value={d.in_preparation} />
        <Tile label="Unterwegs" value={d.on_the_way} />
        <Tile label="Zugestellt" value={d.delivered} tone={d.delivered ? "ok" : "plain"} />
        <Tile label="Benachrichtigung fehlgeschlagen" value={d.failed_notifications} tone={d.failed_notifications ? "bad" : "plain"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="text-lg font-semibold">Offene Aufgaben</h2>
          <ul className="mt-3 grid gap-2">
            {d.next_day_meal_missing && (
              <Task tone="warn">
                Für morgen ({addDays(date, 1).split("-").reverse().join(".")}) ist noch kein Tagesgericht eingetragen. <Link className="underline" href="/kueche">Zur Küche</Link>
              </Task>
            )}
            {!d.meal && <Task tone="warn">Für diesen Tag ist kein Tagesgericht eingetragen – Bestellungen sind nicht möglich.</Task>}
            {missing.length > 0 && (
              <Task tone="warn">
                {missing.length} Bestellung(en) ohne Kartenpunkt: {missing.map((o) => o.driver_name).join(", ")}.{" "}
                <Link className="underline" href={`/buero/karte${q}`}>Auf der Karte setzen</Link>
              </Task>
            )}
            {failed.length > 0 && (
              <Task tone="bad">
                {failed.length} Benachrichtigung(en) fehlgeschlagen: {failed.map((n) => n.driver_name).join(", ")}.
                <Button size="md" variant="secondary" className="ml-2" busy={retrying} onClick={retry}>Erneut senden</Button>
              </Task>
            )}
            {day.drivers_without_order.length > 0 && (
              <Task>
                Ohne Bestellung: {day.drivers_without_order.map((x) => x.name).join(", ")}
              </Task>
            )}
            {!d.next_day_meal_missing && d.meal && missing.length === 0 && failed.length === 0 && (
              <Task tone="ok">Keine offenen Punkte.</Task>
            )}
          </ul>
          {retryMsg && <p className="mt-2 text-sm text-stone-600">{retryMsg}</p>}
        </Card>

        <Card>
          <h2 className="text-lg font-semibold">Bewertungen (30 Tage)</h2>
          <p className="mt-2 text-4xl font-bold tabular-nums">{d.rating_avg_30d != null ? d.rating_avg_30d.toFixed(2).replace(".", ",") : "–"}</p>
          <p className="text-sm text-stone-500">Durchschnitt aus {d.rating_count_30d} Bewertungen (1–5 Punkte)</p>
          <Link href="/buero/bewertungen" className="mt-3 inline-block text-sm text-brand-700 underline">Auswertung je Gericht</Link>
          {notes.length > 0 && (
            <>
              <h3 className="mt-5 font-semibold">Benachrichtigungen</h3>
              <ul className="mt-1 max-h-60 overflow-auto text-sm">
                {notes.map((n) => (
                  <li key={n.id} className="flex justify-between gap-2 border-b border-stone-100 py-1">
                    <span>{n.driver_name}</span>
                    <span className={n.status === "fehlgeschlagen" ? "text-red-700" : n.status === "gesendet" ? "text-brand-700" : "text-stone-500"}>
                      {{ gesendet: "gesendet", fehlgeschlagen: "fehlgeschlagen", kein_abo: "kein Abo", ausstehend: "ausstehend" }[n.status]}
                      {n.sent_at ? ` ${fmtDateTime(n.sent_at)}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

function Task({ tone = "info", children }: { tone?: "info" | "warn" | "bad" | "ok"; children: React.ReactNode }) {
  const t = { info: "bg-stone-50", warn: "bg-amber-50", bad: "bg-red-50", ok: "bg-brand-50" }[tone];
  return <li className={`rounded-xl px-3 py-2 text-sm ${t}`}>{children}</li>;
}
