"use client";

import { useMemo, useState } from "react";
import { PageHead } from "@/components/staff/DateNav";
import { Button, Card, Notice, Spinner } from "@/components/ui";
import { staffRpc, useLive } from "@/lib/client/staff";
import { fmtDateTime, fmtShortDate } from "@/lib/format";
import { linkMessage, whatsappShareUrl } from "@/lib/whatsapp";

type Link = { created_at: string; last_used_at: string | null } | null;
type Driver = { id: string; name: string; customer_hint: string | null; phone: string | null; active: boolean; link: Link; push: boolean; last_order: string | null };
type Courier = { id: string; name: string; active: boolean; link: Link };
type Issued = { kind: "fahrer" | "lieferfahrer"; id: string; name: string; phone: string | null; url: string };

const input = "rounded-lg px-3 py-2 ring-1 ring-stone-300 focus:ring-2 focus:ring-brand-600 focus:outline-none";

export default function DriversPage() {
  const { data, error, refresh } = useLive(
    async () => ({
      drivers: await staffRpc<Driver[]>("office_drivers"),
      couriers: await staffRpc<Courier[]>("office_couriers"),
    }),
    [],
    60000,
  );
  const [search, setSearch] = useState("");
  const [issued, setIssued] = useState<Issued | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<Driver> | null>(null);

  const drivers = useMemo(
    () =>
      (data?.drivers ?? []).filter((d) =>
        `${d.name} ${d.customer_hint ?? ""} ${d.phone ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()),
      ),
    [data, search],
  );

  async function run(fn: () => Promise<unknown>) {
    setMsg(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  async function issue(kind: "fahrer" | "lieferfahrer", id: string, name: string, phone: string | null, hasLink: boolean) {
    if (hasLink && !confirm(`Neuen Link für ${name} erzeugen? Der bisherige Link wird sofort gesperrt.`)) return;
    await run(async () => {
      const token = await staffRpc<string>("office_issue_token", { p_subject: kind, p_id: id });
      setIssued({ kind, id, name, phone, url: `${window.location.origin}/${kind === "fahrer" ? "f" : "l"}/${token}` });
    });
  }

  async function revoke(kind: "fahrer" | "lieferfahrer", id: string, name: string) {
    if (!confirm(`Link von ${name} sperren? ${name} kann danach nicht mehr bestellen, bis ein neuer Link erzeugt wird.`)) return;
    await run(() => staffRpc("office_revoke_token", { p_subject: kind, p_id: id }));
    if (issued?.id === id) setIssued(null);
  }

  async function saveDriver(d: Partial<Driver>) {
    await run(() =>
      staffRpc("office_save_driver", {
        p_id: d.id ?? null, p_name: d.name ?? "", p_customer_hint: d.customer_hint ?? null,
        p_phone: d.phone ?? null, p_active: d.active ?? true,
      }),
    );
    setEditing(null);
  }

  return (
    <>
      <PageHead title="Fahrer & persönliche Links">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Suchen …" className={input} />
        <Button size="md" onClick={() => setEditing({ active: true })}>+ Fahrer anlegen</Button>
      </PageHead>
      {error && <Notice tone="error">{error}</Notice>}
      {msg && <Notice tone="error">{msg}</Notice>}

      {issued && (
        <Card className="mb-4 ring-2 ring-brand-500">
          <p className="font-semibold">Neuer Link für {issued.name}</p>
          <p className="mt-1 text-sm text-stone-600">
            Aus Sicherheitsgründen wird der Link nur jetzt angezeigt (gespeichert ist nur ein Hash). Bei Verlust einfach neu erzeugen – der alte wird dabei gesperrt.
          </p>
          <code className="mt-2 block rounded-lg bg-stone-100 p-2 text-sm break-all">{issued.url}</code>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="md" variant="secondary" onClick={() => navigator.clipboard.writeText(issued.url).then(() => setMsg(null))}>Kopieren</Button>
            <a href={whatsappShareUrl(issued.phone, linkMessage(issued.name, issued.url, issued.kind))} target="_blank" rel="noreferrer">
              <Button size="md">Per WhatsApp senden</Button>
            </a>
            <Button size="md" variant="ghost" onClick={() => setIssued(null)}>Schließen</Button>
          </div>
        </Card>
      )}

      {editing && <DriverForm value={editing} onCancel={() => setEditing(null)} onSave={saveDriver} />}

      {!data ? (
        <Spinner />
      ) : (
        <div className="grid gap-6">
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-left text-stone-600">
                <tr>
                  <th className="px-3 py-2">Fahrer</th>
                  <th className="px-3 py-2">Kunde/Hinweis</th>
                  <th className="px-3 py-2">Telefon</th>
                  <th className="px-3 py-2">Link</th>
                  <th className="px-3 py-2">Push</th>
                  <th className="px-3 py-2">Letzte Bestellung</th>
                  <th className="px-3 py-2 text-right">Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {drivers.map((d) => (
                  <tr key={d.id} className={`border-t border-stone-100 ${d.active ? "" : "text-stone-400"}`}>
                    <td className="px-3 py-2 font-medium">{d.name}{!d.active && " (inaktiv)"}</td>
                    <td className="px-3 py-2">{d.customer_hint ?? "–"}</td>
                    <td className="px-3 py-2">{d.phone ?? "–"}</td>
                    <td className="px-3 py-2">
                      {d.link ? (
                        <span title={`erzeugt ${fmtDateTime(d.link.created_at)}`}>
                          aktiv{d.link.last_used_at ? ` · zuletzt ${fmtDateTime(d.link.last_used_at)}` : " · noch nie geöffnet"}
                        </span>
                      ) : (
                        <span className="text-amber-700">kein Link</span>
                      )}
                    </td>
                    <td className="px-3 py-2">{d.push ? "✓" : "–"}</td>
                    <td className="px-3 py-2">{d.last_order ? fmtShortDate(d.last_order) : "–"}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <Button size="md" variant="ghost" onClick={() => setEditing(d)}>Bearbeiten</Button>
                        <Button size="md" variant="secondary" disabled={!d.active} onClick={() => issue("fahrer", d.id, d.name, d.phone, !!d.link)}>
                          {d.link ? "Neuer Link" : "Link erzeugen"}
                        </Button>
                        {d.link && <Button size="md" variant="danger" onClick={() => revoke("fahrer", d.id, d.name)}>Sperren</Button>}
                      </div>
                    </td>
                  </tr>
                ))}
                {drivers.length === 0 && (
                  <tr><td colSpan={7} className="px-3 py-6 text-center text-stone-500">Keine Fahrer gefunden.</td></tr>
                )}
              </tbody>
            </table>
          </Card>

          <CourierSection couriers={data.couriers} onIssue={issue} onRevoke={revoke} run={run} />
        </div>
      )}
    </>
  );
}

function DriverForm({ value, onSave, onCancel }: { value: Partial<Driver>; onSave: (d: Partial<Driver>) => void; onCancel: () => void }) {
  const [d, setD] = useState(value);
  return (
    <Card className="mb-4">
      <form
        className="grid gap-3 md:grid-cols-5 md:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(d);
        }}
      >
        <label className="grid gap-1 text-sm">Name<input required maxLength={120} value={d.name ?? ""} onChange={(e) => setD({ ...d, name: e.target.value })} className={input} /></label>
        <label className="grid gap-1 text-sm">Kunde/Hinweis (optional)<input maxLength={120} value={d.customer_hint ?? ""} onChange={(e) => setD({ ...d, customer_hint: e.target.value })} className={input} /></label>
        <label className="grid gap-1 text-sm">Telefon für WhatsApp (optional)<input maxLength={40} value={d.phone ?? ""} onChange={(e) => setD({ ...d, phone: e.target.value })} className={input} /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={d.active ?? true} onChange={(e) => setD({ ...d, active: e.target.checked })} className="size-5" />aktiv</label>
        <div className="flex gap-2">
          <Button size="md" type="submit">Speichern</Button>
          <Button size="md" variant="ghost" type="button" onClick={onCancel}>Abbrechen</Button>
        </div>
      </form>
    </Card>
  );
}

function CourierSection({
  couriers,
  onIssue,
  onRevoke,
  run,
}: {
  couriers: Courier[];
  onIssue: (k: "lieferfahrer", id: string, name: string, phone: null, has: boolean) => void;
  onRevoke: (k: "lieferfahrer", id: string, name: string) => void;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [name, setName] = useState("");
  return (
    <Card>
      <h2 className="text-lg font-semibold">Essenslieferfahrer</h2>
      <form
        className="mt-3 flex flex-wrap gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          await run(() => staffRpc("office_save_courier", { p_id: null, p_name: name, p_active: true }));
          setName("");
        }}
      >
        <input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className={input} />
        <Button size="md" type="submit">+ Lieferfahrer anlegen</Button>
      </form>
      <ul className="mt-3 divide-y divide-stone-100">
        {couriers.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-2 py-2">
            <span className={`mr-auto font-medium ${c.active ? "" : "text-stone-400"}`}>{c.name}{!c.active && " (inaktiv)"}</span>
            <span className="text-sm text-stone-500">{c.link ? `Link aktiv${c.link.last_used_at ? ` · zuletzt ${fmtDateTime(c.link.last_used_at)}` : ""}` : "kein Link"}</span>
            <Button size="md" variant="ghost" onClick={() => run(() => staffRpc("office_save_courier", { p_id: c.id, p_name: c.name, p_active: !c.active }))}>
              {c.active ? "Deaktivieren" : "Aktivieren"}
            </Button>
            <Button size="md" variant="secondary" disabled={!c.active} onClick={() => onIssue("lieferfahrer", c.id, c.name, null, !!c.link)}>
              {c.link ? "Neuer Link" : "Link erzeugen"}
            </Button>
            {c.link && <Button size="md" variant="danger" onClick={() => onRevoke("lieferfahrer", c.id, c.name)}>Sperren</Button>}
          </li>
        ))}
      </ul>
    </Card>
  );
}
