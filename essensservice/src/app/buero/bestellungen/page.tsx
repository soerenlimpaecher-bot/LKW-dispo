"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { PageHead, useServiceDate } from "@/components/staff/DateNav";
import { Dialog } from "@/components/Dialog";
import { Button, Card, Notice, Spinner, StatusBadge } from "@/components/ui";
import { staffRpc, useLive } from "@/lib/client/staff";
import { fmtDateTime, fmtTime } from "@/lib/format";
import { hasCoords, type DayOrder, type OfficeDay } from "@/lib/types";
import type { Point } from "@/components/map/MapPicker";

const MapPicker = dynamic(() => import("@/components/map/MapPicker"), { ssr: false });
const input = "rounded-lg px-3 py-2 ring-1 ring-stone-300 focus:ring-2 focus:ring-brand-600 focus:outline-none";

const SOURCE: Record<string, string> = { gps: "GPS", karte: "Karte", adresse: "Adresse", buero: "Büro" };
const BY: Record<string, string> = { fahrer: "Fahrer", buero: "Büro", lieferfahrer: "Lieferfahrer", system: "System", kueche: "Küche" };

type History = { lat: number | null; lng: number | null; address: string | null; source: string; accuracy_m: number | null; set_at: string; set_by: string; current: boolean; staff_name: string | null }[];

export default function OrdersPage() {
  const date = useServiceDate();
  const { data, error, refresh } = useLive(() => staffRpc<OfficeDay>("office_day", { p_date: date }), [date]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"alle" | "aktiv" | "ohne_standort" | "storniert">("aktiv");
  const [msg, setMsg] = useState<string | null>(null);
  const [locFor, setLocFor] = useState<DayOrder | null>(null);
  const [history, setHistory] = useState<{ order: DayOrder; rows: History } | null>(null);
  const [newDriver, setNewDriver] = useState("");

  const orders = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (data?.orders ?? []).filter((o) => {
      if (s && !`${o.driver_name} ${o.customer_hint ?? ""} ${o.note ?? ""}`.toLowerCase().includes(s)) return false;
      if (filter === "aktiv") return o.status !== "storniert";
      if (filter === "ohne_standort") return o.status !== "storniert" && !hasCoords(o);
      if (filter === "storniert") return o.status === "storniert";
      return true;
    });
  }, [data, search, filter]);

  const seqOf = (gid: string | null) => data?.groups.find((g) => g.group_id === gid)?.seq;

  async function run(fn: () => Promise<unknown>) {
    setMsg(null);
    try {
      await fn();
      await refresh();
      return true;
    } catch (e) {
      setMsg((e as Error).message);
      return false;
    }
  }

  return (
    <>
      <PageHead title="Bestellungen" date={date}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Fahrer oder Hinweis suchen …" className={input} />
        <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className={input}>
          <option value="aktiv">Aktive Bestellungen</option>
          <option value="ohne_standort">Ohne Kartenpunkt</option>
          <option value="storniert">Storniert</option>
          <option value="alle">Alle</option>
        </select>
      </PageHead>
      {error && <Notice tone="error">{error}</Notice>}
      {msg && <Notice tone="error">{msg}</Notice>}
      {!data ? (
        <Spinner />
      ) : (
        <div className="grid gap-4">
          <Card className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-sm">
              Bestellung für Fahrer hinzufügen (Büro: ohne Frist)
              <select value={newDriver} onChange={(e) => setNewDriver(e.target.value)} className={`${input} min-w-64`}>
                <option value="">– Fahrer wählen –</option>
                {data.drivers_without_order.map((d) => (
                  <option key={d.driver_id} value={d.driver_id}>{d.name}</option>
                ))}
              </select>
            </label>
            <Button
              size="md"
              disabled={!newDriver || !data.meal}
              onClick={async () => (await run(() => staffRpc("office_save_order", { p_driver: newDriver, p_service_date: date, p_note: null }))) && setNewDriver("")}
            >
              Bestellen
            </Button>
            {!data.meal && <span className="text-sm text-amber-800">Kein Tagesgericht für diesen Tag eingetragen.</span>}
            <span className="ml-auto text-sm text-stone-500">{orders.length} angezeigt · {data.orders.filter((o) => o.status !== "storniert").length} aktiv</span>
          </Card>

          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-left text-stone-600">
                <tr>
                  <th className="px-3 py-2">Fahrer</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Hinweis</th>
                  <th className="px-3 py-2">Standort</th>
                  <th className="px-3 py-2">Gruppe</th>
                  <th className="px-3 py-2">Geändert</th>
                  <th className="px-3 py-2 text-right">Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.order_id} className="border-t border-stone-100 align-top">
                    <td className="px-3 py-2">
                      <p className="font-medium">{o.driver_name}</p>
                      {o.customer_hint && <p className="text-stone-500">{o.customer_hint}</p>}
                    </td>
                    <td className="px-3 py-2"><StatusBadge status={o.status} />{o.delivered_at && <p className="mt-1 text-stone-500">{fmtTime(o.delivered_at)} Uhr</p>}</td>
                    <td className="px-3 py-2"><NoteCell order={o} onSave={(note) => run(() => staffRpc("office_save_order", { p_driver: o.driver_id, p_service_date: date, p_note: note }))} /></td>
                    <td className="px-3 py-2">
                      {o.location ? (
                        <>
                          <p className={hasCoords(o) ? "" : "text-amber-800"}>{hasCoords(o) ? "Punkt" : "nur Adresse"} · {SOURCE[o.location.source]}</p>
                          {o.location.address && <p className="text-stone-500">{o.location.address}</p>}
                          <p className="text-stone-500">{fmtTime(o.location.set_at)} Uhr ({BY[o.location.set_by]})</p>
                        </>
                      ) : (
                        <span className="text-amber-800">fehlt</span>
                      )}
                    </td>
                    <td className="px-3 py-2">{seqOf(o.group_id) ? `Gruppe ${seqOf(o.group_id)}${o.manual ? " (manuell)" : ""}` : "–"}</td>
                    <td className="px-3 py-2 text-stone-500">{fmtDateTime(o.updated_at)}<br />{BY[o.updated_by]}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap justify-end gap-1">
                        {o.status === "storniert" ? (
                          <Button size="md" variant="secondary" onClick={() => run(() => staffRpc("office_save_order", { p_driver: o.driver_id, p_service_date: date, p_note: o.note }))}>Wieder bestellen</Button>
                        ) : (
                          <>
                            <Button size="md" variant="secondary" disabled={o.status === "zugestellt"} onClick={() => setLocFor(o)}>Standort</Button>
                            <Button size="md" variant="ghost" onClick={async () => setHistory({ order: o, rows: await staffRpc<History>("office_location_history", { p_order: o.order_id }) })}>Verlauf</Button>
                            <Button size="md" variant="danger" disabled={o.status === "zugestellt"} onClick={() => confirm(`Bestellung von ${o.driver_name} stornieren?`) && run(() => staffRpc("office_cancel_order", { p_order: o.order_id }))}>Stornieren</Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {orders.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-stone-500">Keine Bestellungen.</td></tr>}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {locFor && (
        <LocationDialog
          order={locFor}
          onClose={() => setLocFor(null)}
          onSave={async (p, address) => (await run(() => staffRpc("office_set_location", { p_order: locFor.order_id, p_lat: p.lat, p_lng: p.lng, p_address: address || null }))) && setLocFor(null)}
        />
      )}
      {history && <HistoryDialog {...history} onClose={() => setHistory(null)} />}
    </>
  );
}

function NoteCell({ order, onSave }: { order: DayOrder; onSave: (note: string | null) => Promise<boolean> }) {
  const [edit, setEdit] = useState(false);
  const [note, setNote] = useState(order.note ?? "");
  if (!edit)
    return (
      <button className="text-left hover:underline disabled:no-underline" disabled={order.status === "storniert"} onClick={() => { setNote(order.note ?? ""); setEdit(true); }}>
        {order.note || <span className="text-stone-400">–</span>}
      </button>
    );
  return (
    <div className="flex gap-1">
      <input autoFocus maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} className={`${input} w-48`} />
      <Button size="md" onClick={async () => (await onSave(note || null)) && setEdit(false)}>OK</Button>
    </div>
  );
}

function LocationDialog({ order, onClose, onSave }: { order: DayOrder; onClose: () => void; onSave: (p: Point, address: string) => void }) {
  const [point, setPoint] = useState<Point | null>(hasCoords(order) ? { lat: order.location!.lat!, lng: order.location!.lng! } : null);
  const [address, setAddress] = useState(order.location?.address ?? "");
  return (
    <Dialog title={`Standort für ${order.driver_name}`} onClose={onClose}>
      <p className="mb-2 text-sm text-stone-600">Auf die Karte tippen oder den Punkt verschieben. Das Büro darf jederzeit ändern; die Änderung wird protokolliert.</p>
      <MapPicker value={point} onChange={setPoint} height={380} />
      <input value={address} maxLength={300} onChange={(e) => setAddress(e.target.value)} placeholder="Adresse / Beschreibung (optional)" className={`${input} mt-3 w-full`} />
      <div className="mt-3 flex justify-end gap-2">
        <Button size="md" variant="ghost" onClick={onClose}>Abbrechen</Button>
        <Button size="md" disabled={!point} onClick={() => point && onSave(point, address)}>Speichern</Button>
      </div>
    </Dialog>
  );
}

function HistoryDialog({ order, rows, onClose }: { order: DayOrder; rows: History; onClose: () => void }) {
  return (
    <Dialog title={`Standortverlauf ${order.driver_name}`} onClose={onClose}>
      {rows.length === 0 ? (
        <p className="text-stone-500">Noch kein Standort.</p>
      ) : (
        <ul className="divide-y divide-stone-100 text-sm">
          {rows.map((r, i) => (
            <li key={i} className="py-2">
              <p className="font-medium">
                {fmtDateTime(r.set_at)} · {SOURCE[r.source]} · {r.staff_name ?? BY[r.set_by]} {r.current && <span className="text-brand-700">(aktuell)</span>}
              </p>
              <p className="text-stone-600">
                {r.lat != null ? `${r.lat.toFixed(5)}, ${r.lng!.toFixed(5)}` : "ohne Koordinaten"}
                {r.accuracy_m != null ? ` · Genauigkeit ±${Math.round(r.accuracy_m)} m` : ""}
                {r.address ? ` · ${r.address}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
