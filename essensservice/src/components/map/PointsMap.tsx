"use client";

import L from "leaflet";
import { useEffect } from "react";
import { MapContainer, Marker, Tooltip, useMap, useMapEvents } from "react-leaflet";
import { DEFAULT_CENTER, DEFAULT_ZOOM, OsmTiles, dotIcon, labelIcon } from "./leaflet-base";

export type MapPoint = { id: string; lat: number; lng: number; label: string; color: string; title: string };

function Fit({ points }: { points: { lat: number; lng: number }[] }) {
  const map = useMap();
  const key = points.map((p) => `${p.lat},${p.lng}`).join("|");
  useEffect(() => {
    if (points.length === 0) return;
    map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number])).pad(0.3), { maxZoom: 17 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map]);
  return null;
}

function Click({ onClick }: { onClick?: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onClick?.(e.latlng.lat, e.latlng.lng) });
  return null;
}

/** Mehrere beschriftete Punkte, optional mit verschiebbarem Ablagepunkt. */
export default function PointsMap({
  points,
  drop,
  onDrop,
  height = 280,
}: {
  points: MapPoint[];
  drop?: { lat: number; lng: number } | null;
  onDrop?: (lat: number, lng: number) => void;
  height?: number;
}) {
  const all = [...points, ...(drop ? [drop] : [])];
  return (
    <div style={{ height }} className="overflow-hidden rounded-xl ring-1 ring-stone-300">
      <MapContainer center={DEFAULT_CENTER} zoom={DEFAULT_ZOOM} style={{ height: "100%", width: "100%" }}>
        <OsmTiles />
        <Fit points={all} />
        <Click onClick={onDrop} />
        {points.map((p) => (
          <Marker key={p.id} position={[p.lat, p.lng]} icon={labelIcon(p.label, p.color)}>
            <Tooltip direction="top" offset={[0, -12]}>{p.title}</Tooltip>
          </Marker>
        ))}
        {drop && (
          <Marker
            position={[drop.lat, drop.lng]}
            icon={dotIcon("#111827")}
            draggable={!!onDrop}
            zIndexOffset={1000}
            eventHandlers={{ dragend: (e) => { const ll = (e.target as L.Marker).getLatLng(); onDrop?.(ll.lat, ll.lng); } }}
          >
            <Tooltip direction="top" offset={[0, -12]} permanent>Ablageort</Tooltip>
          </Marker>
        )}
      </MapContainer>
    </div>
  );
}
