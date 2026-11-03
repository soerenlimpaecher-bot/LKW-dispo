"use client";

import { useEffect, useState } from "react";
import { PageHead, useServiceDate } from "@/components/staff/DateNav";
import { Button, Card, Notice, Spinner } from "@/components/ui";
import { staffRpc, useLive } from "@/lib/client/staff";
import { addDays, berlinToday, fmtDateTime, fmtDay, fmtPrice, fmtShortDate, fmtTime } from "@/lib/format";

type PackOrder = {
  order_id: string; driver_name: string; note: string | null; status: string;
  lat: number | null; lng: number | null; address: string | null; changed_after_final: boolean;
};
type Overview = {
  service_date: string;
  now: string;
  phase: "laufend" | "zwischenstand" | "bestellschluss" | "endgueltig";
  meal: { name: string; description: string | null; internal_price: number | null; available: boolean } | null;
  total: number;
  cancelled_after_final: { order_id: string; driver_name: string }[];
  groups: { group_id: string; seq: number; count: number; changed_after_final: boolean; orders: PackOrder[] }[];
  ungrouped: PackOrder[];
};
type Meal = { id: string; service_date: string; name: string; description: string | null; internal_price: number | null; available: boolean; updated_at: string; orders: number };

const PHASE: Record<Overview["phase"], { title: string; text: string; tone: "info" | "warn" | "ok" }> = {
  laufend: { title: "Bestellungen laufen", text: "Zahlen können sich bis 9:00 Uhr noch ändern.", tone: "info" },
  zwischenstand: { title: "Produktionszwischenstand (ab 8:00 Uhr)", text: "Bestellschluss um 9:00 Uhr – bis dahin sind noch Änderungen möglich.", tone: "info" },
  bestellschluss: { title: "Bestellschluss erreicht (9:00 Uhr)", text: "Gesamtzahl steht. Liefergruppen und Packlisten werden um 10:30 Uhr endgültig.", tone: "warn" },
  endgueltig: { title: "Endgültige Liefergruppen und Packlisten (ab 10:30 Uhr)", text: "Spätere Änderungen des Büros sind gelb markiert.", tone: "ok" },
};

const input = "rounded-lg px-3 py-2 ring-1 ring-stone-300 focus:ring-2 focus:ring-brand-600 focus:outline-none";

export default function KitchenPage() {
  const date = useServiceDate();
  const { data, error, updatedAt } = useLive(() => staffRpc<Overview>("kitchen_overview", { p_date: date }), [date]);

  return (
    <>
      <PageHead title="Küche" date={date}>
        {updatedAt && <span className="no-print text-xs text-stone-500">Stand {fmtTime(updatedAt.toISOString())} · aktualisiert sich selbst</span>}
        <Button size="md" variant="secondary" className="no-print" onClick={() => window.print()} title="Im Druckdialog „Als PDF speichern“ wählen">
          Drucken / PDF
        </Button>
      </PageHead>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="grid content-start gap-4">{!data ? <Spinner /> : <Production o={data} />}</div>
        <div className="no-print grid content-start gap-4">
          <MealEditor />
        </div>
      </div>
    </>
  );
}

function Production({ o }: { o: Overview }) {
  const p = PHASE[o.phase];
  return (
    <>
      <Card className="grid gap-3 md:grid-cols-[auto_1fr] md:items-center">
        <div className="rounded-2xl bg-brand-50 px-6 py-4 text-center ring-1 ring-brand-100">
          <p className="text-sm text-brand-900">Essen gesamt</p>
          <p className="text-5xl font-bold text-brand-700 tabular-nums">{o.total}</p>
        </div>
        <div>
          <p className="text-sm text-stone-500">{fmtDay(o.service_date)}</p>
          <p className="text-xl font-bold">{o.meal?.name ?? "Kein Tagesgericht eingetragen"}</p>
          {o.meal && <p className="text-stone-600">Interner Preis: {fmtPrice(o.meal.internal_price)}</p>}
          <div className="mt-2"><Notice tone={p.tone}><b>{p.title}.</b> {p.text}</Notice></div>
        </div>
      </Card>

      {o.cancelled_after_final.length > 0 && (
        <Notice tone="warn">
          <b>Nach 10:30 Uhr storniert:</b> {o.cancelled_after_final.map((c) => c.driver_name).join(", ")}
        </Notice>
      )}

      <h2 className="text-lg font-semibold">Packlisten je Liefergruppe</h2>
      {o.groups.length === 0 && o.ungrouped.length === 0 && <p className="text-stone-500">Noch keine Bestellungen.</p>}
      {o.groups.map((g) => (
        <Card key={g.group_id} className={`break-inside-avoid ${g.changed_after_final ? "ring-2 ring-amber-400" : ""}`}>
          <PackTable title={`Gruppe ${g.seq}`} count={g.count} orders={g.orders} changed={g.changed_after_final} />
        </Card>
      ))}
      {o.ungrouped.length > 0 && (
        <Card className="break-inside-avoid ring-2 ring-amber-300">
          <PackTable title="Ohne Liefergruppe (Standort fehlt)" count={o.ungrouped.length} orders={o.ungrouped} changed={false} />
        </Card>
      )}
      <p className="hidden text-xs text-stone-500 print:block">Gedruckt {fmtDateTime(new Date().toISOString())}</p>
    </>
  );
}

function PackTable({ title, count, orders, changed }: { title: string; count: number; orders: PackOrder[]; changed: boolean }) {
  return (
    <>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-lg font-bold">{title}</h3>
        <p className="text-lg font-semibold">{count} Essen{changed && <span className="ml-2 rounded bg-amber-200 px-1.5 py-0.5 text-xs text-amber-900">geändert nach 10:30</span>}</p>
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-stone-500">
          <tr><th className="py-1 pr-2">Fahrer</th><th className="py-1 pr-2">Lieferstandort</th><th className="py-1">Hinweis</th></tr>
        </thead>
        <tbody>
          {orders.map((r) => (
            <tr key={r.order_id} className={`border-t border-stone-100 ${r.changed_after_final ? "bg-amber-50" : ""}`}>
              <td className="py-1.5 pr-2 font-medium">
                {r.driver_name}
                {r.changed_after_final && <span className="ml-1 text-xs text-amber-800">(geändert)</span>}
              </td>
              <td className="py-1.5 pr-2">{r.address ?? (r.lat != null ? `${r.lat.toFixed(5)}, ${r.lng!.toFixed(5)}` : <span className="text-amber-800">fehlt</span>)}</td>
              <td className="py-1.5">{r.note ?? "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function MealEditor() {
  const today = berlinToday();
  const tomorrow = addDays(today, 1);
  const { data: meals, refresh } = useLive(() => staffRpc<Meal[]>("kitchen_meals", { p_from: today, p_to: addDays(today, 14) }), [today], 60000);
  const [form, setForm] = useState({ date: tomorrow, name: "", description: "", price: "", available: true });
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Vorhandenes Gericht nur beim Wechsel des Datums übernehmen – nicht bei jeder Live-Aktualisierung,
  // sonst würde eine laufende Eingabe überschrieben.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!meals || loadedFor === form.date) return;
    setLoadedFor(form.date);
    const m = meals.find((x) => x.service_date === form.date);
    setForm((f) => ({
      ...f,
      name: m?.name ?? "",
      description: m?.description ?? "",
      price: m?.internal_price != null ? Number(m.internal_price).toFixed(2).replace(".", ",") : "",
      available: m?.available ?? true,
    }));
  }, [form.date, meals, loadedFor]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const price = form.price.trim() === "" ? null : Number(form.price.replace(",", "."));
    if (price != null && (Number.isNaN(price) || price < 0)) return setMsg({ tone: "error", text: "Bitte einen gültigen Preis eingeben." });
    setBusy(true);
    setMsg(null);
    try {
      await staffRpc("kitchen_save_meal", {
        p_service_date: form.date, p_name: form.name, p_description: form.description || null, p_price: price, p_available: form.available,
      });
      setMsg({ tone: "ok", text: `Gespeichert für ${fmtShortDate(form.date)}.` });
      refresh();
    } catch (err) {
      setMsg({ tone: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card>
        <h2 className="text-lg font-semibold">Tagesgericht eintragen</h2>
        <p className="text-sm text-stone-500">Genau ein Gericht pro Tag. Der Preis ist nur für Küche und Büro sichtbar.</p>
        <form onSubmit={save} className="mt-3 grid gap-3">
          <label className="grid gap-1 text-sm">Liefertag
            <input type="date" min={today} required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={input} />
          </label>
          <label className="grid gap-1 text-sm">Gericht
            <input required maxLength={160} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={input} />
          </label>
          <label className="grid gap-1 text-sm">Beschreibung
            <textarea maxLength={1000} rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={input} />
          </label>
          <label className="grid gap-1 text-sm">Interner Preis (€)
            <input inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="z. B. 6,50" className={input} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.available} onChange={(e) => setForm({ ...form, available: e.target.checked })} className="size-5" />
            verfügbar (Fahrer können bestellen)
          </label>
          <Button type="submit" busy={busy}>Speichern</Button>
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        </form>
      </Card>
      <Card>
        <h2 className="text-lg font-semibold">Nächste Tage</h2>
        <ul className="mt-2 divide-y divide-stone-100 text-sm">
          {(meals ?? []).map((m) => (
            <li key={m.id}>
              <button className="flex w-full justify-between gap-2 py-2 text-left hover:bg-stone-50" onClick={() => setForm((f) => ({ ...f, date: m.service_date }))}>
                <span><b>{fmtShortDate(m.service_date)}</b> {m.name}{!m.available && <span className="text-amber-700"> (nicht verfügbar)</span>}</span>
                <span className="text-stone-500">{m.orders} best. · {fmtPrice(m.internal_price)}</span>
              </button>
            </li>
          ))}
          {meals?.length === 0 && <li className="py-2 text-stone-500">Noch nichts eingetragen.</li>}
        </ul>
      </Card>
    </>
  );
}
