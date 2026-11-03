"use client";

import { useEffect, useMemo, useRef } from "react";
import { Circle, MapContainer, Marker, Polygon, Tooltip, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { convexHull } from "@/lib/geo";
import { STATUS_LABEL } from "@/lib/format";
import { hasCoords, type DayGroup, type DayOrder } from "@/lib/types";
import { DEFAULT_CENTER, DEFAULT_ZOOM, OsmTiles, groupColor, labelIcon } from "./leaflet-base";

const NO_GROUP = "#78716c";

function FitOnce({ orders }: { orders: DayOrder[] }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    const pts = orders.filter(hasCoords).map((o) => [o.location!.lat!, o.location!.lng!] as [number, number]);
    if (done.current || pts.length === 0) return;
    done.current = true;
    map.fitBounds(L.latLngBounds(pts).pad(0.2), { maxZoom: 16 });
  }, [orders, map]);
  return null;
}

function Focus({ point }: { point: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (point) map.setView(point, Math.max(map.getZoom(), 16), { animate: true });
  }, [point, map]);
  return null;
}

function ClickHandler({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onClick(e.latlng.lat, e.latlng.lng) });
  return null;
}

export default function DispoMap({
  orders,
  groups,
  selected,
  onSelect,
  onMove,
  onMapClick,
  placing,
  focus,
}: {
  orders: DayOrder[];
  groups: DayGroup[];
  selected: string | null;
  onSelect: (orderId: string) => void;
  onMove: (order: DayOrder, lat: number, lng: number) => void;
  onMapClick: (lat: number, lng: number) => void;
  placing: boolean;
  focus: [number, number] | null;
}) {
  const seqOf = useMemo(() => new Map(groups.map((g) => [g.group_id, g.seq])), [groups]);
  const active = orders.filter((o) => o.status !== "storniert" && hasCoords(o));

  const hulls = groups
    .map((g) => {
      const pts = active.filter((o) => o.group_id === g.group_id).map((o) => ({ lat: o.location!.lat!, lng: o.location!.lng! }));
      return { g, pts, hull: convexHull(pts) };
    })
    .filter((h) => h.pts.length > 0);

  return (
    <div className={`h-full w-full ${placing ? "[&_.leaflet-container]:cursor-crosshair" : ""}`}>
      <MapContainer center={DEFAULT_CENTER} zoom={DEFAULT_ZOOM} style={{ height: "100%", width: "100%" }}>
        <OsmTiles />
        <FitOnce orders={orders} />
        <Focus point={focus} />
        <ClickHandler onClick={onMapClick} />
        {hulls.map(({ g, pts, hull }) =>
          hull.length >= 3 ? (
            <Polygon key={g.group_id} positions={hull.map((p) => [p.lat, p.lng])}
              pathOptions={{ color: groupColor(g.seq), weight: 2, fillOpacity: 0.12, dashArray: g.manual ? "6 4" : undefined }} />
          ) : (
            pts.map((p, i) => (
              <Circle key={`${g.group_id}-${i}`} center={[p.lat, p.lng]} radius={40}
                pathOptions={{ color: groupColor(g.seq), weight: 2, fillOpacity: 0.12, dashArray: g.manual ? "6 4" : undefined }} />
            ))
          ),
        )}
        {active.map((o) => {
          const seq = o.group_id ? seqOf.get(o.group_id) : undefined;
          const color = seq ? groupColor(seq) : NO_GROUP;
          return (
            <Marker
              key={o.order_id}
              position={[o.location!.lat!, o.location!.lng!]}
              icon={labelIcon(seq ? String(seq) : "–", color)}
              draggable={o.status !== "zugestellt"}
              zIndexOffset={selected === o.order_id ? 1000 : 0}
              opacity={selected && selected !== o.order_id ? 0.75 : 1}
              eventHandlers={{
                click: () => onSelect(o.order_id),
                dragend: (e) => {
                  const ll = (e.target as L.Marker).getLatLng();
                  onMove(o, ll.lat, ll.lng);
                },
              }}
            >
              <Tooltip direction="top" offset={[0, -12]}>
                <b>{o.driver_name}</b>
                <br />
                {seq ? `Gruppe ${seq}` : "ohne Gruppe"} · {STATUS_LABEL[o.status]}
                {o.note ? <><br />Hinweis: {o.note}</> : null}
              </Tooltip>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}
