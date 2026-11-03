"use client";

import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { useServiceDate, DateNav } from "@/components/staff/DateNav";
import { Button, Notice, Spinner, StatusBadge } from "@/components/ui";
import { groupColor } from "@/components/map/leaflet-base";
import { staffRpc, useLive } from "@/lib/client/staff";
import { fmtTime } from "@/lib/format";
import { maxPairwiseM } from "@/lib/geo";
import { hasCoords, type DayGroup, type DayOrder, type OfficeDay } from "@/lib/types";

const DispoMap = dynamic(() => import("@/components/map/DispoMap"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-stone-200" />,
});

const NEW_GROUP = "__neu__";

export default function MapPage() {
  const date = useServiceDate();
  const { data, error, refresh } = useLive(() => staffRpc<OfficeDay>("office_day", { p_date: date }), [date], 10000);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [placing, setPlacing] = useState<DayOrder | null>(null);
  const [focus, setFocus] = useState<[number, number] | null>(null);
  const [checkedGroups, setCheckedGroups] = useState<string[]>([]);
  const [checkedOrders, setCheckedOrders] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const active = useMemo(() => (data?.orders ?? []).filter((o) => o.status !== "storniert"), [data]);
  const noCoords = active.filter((o) => !hasCoords(o));
  const ungrouped = active.filter((o) => hasCoords(o) && !o.group_id);
  const groups = (data?.groups ?? []).filter((g) => active.some((o) => o.group_id === g.group_id));
  const final = data ? new Date(data.now) >= new Date(data.location_deadline) : false;

  async function run(text: string, fn: () => Promise<unknown>) {
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: "ok", text });
      await refresh();
    } catch (e) {
      setMsg({ tone: "error", text: (e as Error).message });
      await refresh();
    }
  }

  function select(o: DayOrder) {
    setSelected(o.order_id);
    if (hasCoords(o)) setFocus([o.location!.lat!, o.location!.lng!]);
  }

  async function onDragEnd(e: DragEndEvent) {
    const orderId = String(e.active.id);
    const target = e.over?.id ? String(e.over.id) : null;
    const order = active.find((o) => o.order_id === orderId);
    if (!order || !target || target === order.group_id) return;
    await run(
      target === NEW_GROUP ? `${order.driver_name} in neue Gruppe verschoben.` : `${order.driver_name} verschoben.`,
      () => staffRpc("office_move_order", { p_order: orderId, p_group: target === NEW_GROUP ? null : target }),
    );
  }

  const filtered = (list: DayOrder[]) =>
    search.trim() ? list.filter((o) => o.driver_name.toLowerCase().includes(search.trim().toLowerCase())) : list;

  return (
    <div className="-mx-4 -my-4 flex h-[calc(100dvh-49px)] flex-col lg:flex-row">
      <div className="relative h-[55vh] flex-1 lg:h-auto">
        {data && (
          <DispoMap
            orders={data.orders}
            groups={data.groups}
            selected={selected}
            focus={focus}
            placing={!!placing}
            onSelect={(id) => {
              setSelected(id);
              document.getElementById(`o-${id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
            }}
            onMove={(o, lat, lng) => {
              if (!confirm(`Standort von ${o.driver_name} hierher verschieben?`)) return void refresh();
              run(`Standort von ${o.driver_name} geändert.`, () => staffRpc("office_set_location", { p_order: o.order_id, p_lat: lat, p_lng: lng, p_address: o.location?.address ?? null }));
            }}
            onMapClick={(lat, lng) => {
              if (!placing) return;
              const o = placing;
              setPlacing(null);
              run(`Standort für ${o.driver_name} gesetzt.`, () => staffRpc("office_set_location", { p_order: o.order_id, p_lat: lat, p_lng: lng, p_address: o.location?.address ?? null }));
            }}
          />
        )}
        {placing && (
          <div className="absolute top-3 left-1/2 z-[1000] -translate-x-1/2 rounded-xl bg-brand-900 px-4 py-2 text-white shadow-lg">
            Auf die Karte klicken, um den Standort für <b>{placing.driver_name}</b> zu setzen.
            <button className="ml-3 underline" onClick={() => setPlacing(null)}>Abbrechen</button>
          </div>
        )}
      </div>

      <aside className="flex w-full flex-col border-l border-stone-200 bg-stone-50 lg:w-[440px]">
        <div className="grid gap-2 border-b border-stone-200 bg-white p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-xl font-bold">Karte & Liefergruppen</h1>
            <DateNav date={date} />
          </div>
          {data && (
            <p className="text-sm text-stone-600">
              {active.length} Essen · {groups.length} Gruppen · {noCoords.length} ohne Kartenpunkt ·{" "}
              {final ? "Gruppen endgültig (ab 10:30) – nur noch manuelle Änderungen" : `automatische Gruppierung bis ${fmtTime(data.location_deadline)} Uhr`}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Fahrer suchen …" className="min-w-0 flex-1 rounded-lg px-3 py-1.5 text-sm ring-1 ring-stone-300" />
            <Button size="md" variant="secondary"
              onClick={() => confirm(final ? "Nach 10:30: automatische Gruppen wirklich neu berechnen? Manuelle Zuordnungen bleiben erhalten." : "Gruppen neu berechnen? Manuelle Zuordnungen bleiben erhalten.")
                && run("Gruppen neu berechnet.", () => staffRpc("office_regroup", { p_date: date }))}>
              Neu berechnen
            </Button>
          </div>
          {checkedGroups.length >= 2 && (
            <Button size="md"
              onClick={() => {
                const sorted = groups.filter((g) => checkedGroups.includes(g.group_id)).sort((a, b) => a.seq - b.seq);
                run(`Gruppen zusammengelegt in Gruppe ${sorted[0].seq}.`, () =>
                  staffRpc("office_merge_groups", { p_target: sorted[0].group_id, p_sources: sorted.slice(1).map((g) => g.group_id) })).then(() => setCheckedGroups([]));
              }}>
              {checkedGroups.length} Gruppen zusammenlegen
            </Button>
          )}
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
          {error && <Notice tone="error">{error}</Notice>}
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {!data ? (
            <Spinner />
          ) : (
            <DndContext sensors={sensors} onDragEnd={onDragEnd}>
              <div className="grid gap-3">
                {noCoords.length > 0 && (
                  <section className="rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200">
                    <h2 className="font-semibold text-amber-900">Ohne Kartenpunkt ({noCoords.length})</h2>
                    <ul className="mt-2 grid gap-1">
                      {filtered(noCoords).map((o) => (
                        <li key={o.order_id} id={`o-${o.order_id}`} className="flex items-center justify-between gap-2 rounded-lg bg-white px-2 py-1.5 text-sm">
                          <span>
                            <b>{o.driver_name}</b>
                            {o.location?.address && <span className="block text-stone-600">{o.location.address}</span>}
                          </span>
                          <Button size="md" variant="secondary" onClick={() => setPlacing(o)}>Punkt setzen</Button>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {groups.map((g) => (
                  <GroupCard
                    key={g.group_id}
                    group={g}
                    orders={filtered(active.filter((o) => o.group_id === g.group_id))}
                    allOrders={active.filter((o) => o.group_id === g.group_id)}
                    selected={selected}
                    checked={checkedGroups.includes(g.group_id)}
                    onCheck={(v) => setCheckedGroups((c) => (v ? [...c, g.group_id] : c.filter((x) => x !== g.group_id)))}
                    checkedOrders={checkedOrders}
                    onCheckOrder={(id, v) => setCheckedOrders((c) => (v ? [...c, id] : c.filter((x) => x !== id)))}
                    onSelect={select}
                    onSplit={(ids) => run(`Gruppe ${g.seq} getrennt.`, () => staffRpc("office_split_group", { p_group: g.group_id, p_orders: ids })).then(() => setCheckedOrders([]))}
                    onUnlock={(ids) => run("Automatik wieder freigegeben.", () => staffRpc("office_unlock_orders", { p_orders: ids }))}
                    onRelease={() => run(`Gruppe ${g.seq} für die Lieferung freigegeben.`, () => staffRpc("office_release_group", { p_group: g.group_id }))}
                    final={final}
                  />
                ))}

                {ungrouped.length > 0 && (
                  <section className="rounded-xl bg-white p-3 ring-1 ring-stone-200">
                    <h2 className="font-semibold">Mit Standort, ohne Gruppe ({ungrouped.length})</h2>
                    <p className="text-xs text-stone-500">Nach 10:30 gesetzte Standorte – bitte in eine Gruppe ziehen.</p>
                    <ul className="mt-2 grid gap-1">
                      {filtered(ungrouped).map((o) => (
                        <OrderRow key={o.order_id} order={o} selected={selected === o.order_id} onSelect={select} />
                      ))}
                    </ul>
                  </section>
                )}

                <NewGroupDrop />
                {active.length === 0 && <p className="py-6 text-center text-stone-500">Keine aktiven Bestellungen.</p>}
              </div>
            </DndContext>
          )}
        </div>
      </aside>
    </div>
  );
}

function NewGroupDrop() {
  const { setNodeRef, isOver } = useDroppable({ id: NEW_GROUP });
  return (
    <div ref={setNodeRef} className={`rounded-xl border-2 border-dashed p-4 text-center text-sm ${isOver ? "border-brand-600 bg-brand-50 text-brand-900" : "border-stone-300 text-stone-500"}`}>
      Fahrer hierher ziehen = neue Gruppe
    </div>
  );
}

function GroupCard({
  group, orders, allOrders, selected, checked, onCheck, checkedOrders, onCheckOrder, onSelect, onSplit, onUnlock, onRelease, final,
}: {
  group: DayGroup; orders: DayOrder[]; allOrders: DayOrder[]; selected: string | null; checked: boolean;
  onCheck: (v: boolean) => void; checkedOrders: string[]; onCheckOrder: (id: string, v: boolean) => void;
  onSelect: (o: DayOrder) => void; onSplit: (ids: string[]) => void; onUnlock: (ids: string[]) => void; onRelease: () => void; final: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: group.group_id });
  const pts = allOrders.filter(hasCoords).map((o) => ({ lat: o.location!.lat!, lng: o.location!.lng! }));
  const spread = Math.round(maxPairwiseM(pts));
  const delivered = allOrders.filter((o) => o.status === "zugestellt").length;
  const onWay = allOrders.filter((o) => o.status === "unterwegs").length;
  const mine = checkedOrders.filter((id) => allOrders.some((o) => o.order_id === id));
  const manualIds = allOrders.filter((o) => o.manual).map((o) => o.order_id);

  return (
    <section ref={setNodeRef} className={`rounded-xl bg-white p-3 ring-1 ${isOver ? "ring-2 ring-brand-600" : "ring-stone-200"}`} style={{ borderLeft: `6px solid ${groupColor(group.seq)}` }}>
      <div className="flex flex-wrap items-center gap-2">
        <input type="checkbox" checked={checked} onChange={(e) => onCheck(e.target.checked)} aria-label={`Gruppe ${group.seq} auswählen`} className="size-4" />
        <h2 className="font-semibold">Gruppe {group.seq}</h2>
        <span className="rounded-full bg-stone-100 px-2 py-0.5 text-sm font-semibold">{allOrders.length} Essen</span>
        {group.manual && <span className="rounded bg-sky-100 px-1.5 py-0.5 text-xs text-sky-900" title="Enthält manuelle Zuordnungen – die Automatik verändert diese Gruppe nicht">manuell</span>}
        <span className={`text-xs ${spread > 500 ? "font-semibold text-red-700" : "text-stone-500"}`} title="Größter Abstand zweier Standorte in der Gruppe">
          max. {spread} m{spread > 500 ? " (über 500 m)" : ""}
        </span>
      </div>
      <p className="mt-1 text-xs text-stone-500">
        {group.courier ? `Lieferfahrer: ${group.courier}` : group.released_at || final ? "Für Lieferung freigegeben" : "Noch nicht freigegeben"}
        {onWay ? ` · ${onWay} unterwegs` : ""}{delivered ? ` · ${delivered} zugestellt` : ""}
      </p>
      <ul className="mt-2 grid gap-1">
        {orders.map((o) => (
          <OrderRow key={o.order_id} order={o} selected={selected === o.order_id} onSelect={onSelect}
            checked={checkedOrders.includes(o.order_id)} onCheck={(v) => onCheckOrder(o.order_id, v)} />
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap gap-1">
        {mine.length > 0 && mine.length < allOrders.length && (
          <Button size="md" variant="secondary" onClick={() => onSplit(mine)}>{mine.length} abtrennen</Button>
        )}
        {manualIds.length > 0 && !final && (
          <Button size="md" variant="ghost" onClick={() => onUnlock(manualIds)} title="Manuelle Zuordnung aufheben – die Automatik gruppiert diese Fahrer wieder">Automatik zulassen</Button>
        )}
        {!group.released_at && !final && <Button size="md" variant="ghost" onClick={onRelease}>Vorzeitig freigeben</Button>}
      </div>
    </section>
  );
}

function OrderRow({
  order, selected, onSelect, checked, onCheck,
}: { order: DayOrder; selected: boolean; onSelect: (o: DayOrder) => void; checked?: boolean; onCheck?: (v: boolean) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: order.order_id, disabled: order.status === "zugestellt" });
  return (
    <li
      id={`o-${order.order_id}`}
      ref={setNodeRef}
      style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 50, position: "relative" } : undefined}
      className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${selected ? "bg-brand-50 ring-1 ring-brand-500" : "bg-stone-50"} ${isDragging ? "shadow-lg" : ""}`}
    >
      {onCheck && <input type="checkbox" checked={checked} onChange={(e) => onCheck(e.target.checked)} aria-label={`${order.driver_name} auswählen`} className="size-4" />}
      <span {...listeners} {...attributes} className="cursor-grab touch-none px-1 text-stone-400 select-none" title="Ziehen zum Verschieben" aria-label="Verschieben">⠿</span>
      <button className="flex-1 text-left" onClick={() => onSelect(order)}>
        <b>{order.driver_name}</b>
        {order.manual && <span className="ml-1 text-xs text-sky-800">(manuell)</span>}
        {order.note && <span className="block text-xs text-stone-600">Hinweis: {order.note}</span>}
      </button>
      <StatusBadge status={order.status} />
    </li>
  );
}
