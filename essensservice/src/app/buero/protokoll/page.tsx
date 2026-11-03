"use client";

import { PageHead, useServiceDate } from "@/components/staff/DateNav";
import { Card, Notice, Spinner } from "@/components/ui";
import { staffRpc, useLive } from "@/lib/client/staff";
import { fmtDateTime } from "@/lib/format";

type Entry = { id: number; at: string; actor_kind: string; actor_name: string | null; action: string; entity: string; details: Record<string, unknown>; driver_name: string | null };

const ACTION: Record<string, string> = {
  bestellt: "hat bestellt", storniert: "Bestellung storniert", standort: "Standort gesetzt", bewertet: "hat bewertet",
  bestellung_gespeichert: "Bestellung gespeichert", gruppe_verschoben: "in andere Gruppe verschoben",
  gruppen_zusammengelegt: "Gruppen zusammengelegt", gruppe_getrennt: "Gruppe getrennt", automatik_freigegeben: "Automatik wieder freigegeben",
  gruppen_neu_berechnet: "Gruppen neu berechnet", gruppe_freigegeben: "Gruppe für Lieferung freigegeben",
  gruppe_uebernommen: "Gruppe übernommen", abgelegt: "Essen abgelegt", tagesgericht_gespeichert: "Tagesgericht gespeichert",
  link_erzeugt: "Link erzeugt", link_gesperrt: "Link gesperrt", fahrer_angelegt: "Fahrer angelegt", fahrer_geaendert: "Fahrer geändert",
  lieferfahrer_gespeichert: "Lieferfahrer gespeichert",
};
const KIND: Record<string, string> = { fahrer: "Fahrer", buero: "Büro", kueche: "Küche", lieferfahrer: "Lieferfahrer", system: "System" };

export default function AuditPage() {
  const date = useServiceDate();
  const { data, error } = useLive(() => staffRpc<Entry[]>("office_audit", { p_date: date, p_limit: 500 }), [date], 30000);
  return (
    <>
      <PageHead title="Änderungsprotokoll" date={date} />
      {error && <Notice tone="error">{error}</Notice>}
      {!data ? (
        <Spinner />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-left text-stone-600">
              <tr><th className="px-3 py-2">Zeit</th><th className="px-3 py-2">Wer</th><th className="px-3 py-2">Was</th><th className="px-3 py-2">Betrifft</th><th className="px-3 py-2">Details</th></tr>
            </thead>
            <tbody>
              {data.map((e) => (
                <tr key={e.id} className="border-t border-stone-100 align-top">
                  <td className="px-3 py-1.5 whitespace-nowrap">{fmtDateTime(e.at)}</td>
                  <td className="px-3 py-1.5">{e.actor_name ?? "–"} <span className="text-stone-500">({KIND[e.actor_kind] ?? e.actor_kind})</span></td>
                  <td className="px-3 py-1.5">{ACTION[e.action] ?? e.action}</td>
                  <td className="px-3 py-1.5">{e.driver_name ?? "–"}</td>
                  <td className="px-3 py-1.5 font-mono text-xs text-stone-600">{Object.keys(e.details).length ? JSON.stringify(e.details) : ""}</td>
                </tr>
              ))}
              {data.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-stone-500">Keine Einträge.</td></tr>}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
