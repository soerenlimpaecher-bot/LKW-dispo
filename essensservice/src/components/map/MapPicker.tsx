"use client";

import { useEffect } from "react";
import { MapContainer, Marker, useMap, useMapEvents } from "react-leaflet";
import { DEFAULT_CENTER, DEFAULT_ZOOM, OsmTiles, dotIcon } from "./leaflet-base";

export type Point = { lat: number; lng: number };

function ClickToSet({ onChange }: { onChange: (p: Point) => void }) {
  useMapEvents({ click: (e) => onChange({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

function Recenter({ point }: { point: Point | null }) {
  const map = useMap();
  useEffect(() => {
    if (point) map.setView([point.lat, point.lng], Math.max(map.getZoom(), 15));
    // nur beim ersten Setzen zentrieren
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [point === null]);
  return null;
}

/** Karte zum Setzen eines Punktes: tippen oder Marker verschieben. */
export default function MapPicker({
  value,
  onChange,
  height = 320,
  readOnly = false,
}: {
  value: Point | null;
  onChange?: (p: Point) => void;
  height?: number;
  readOnly?: boolean;
}) {
  return (
    <div style={{ height }} className="overflow-hidden rounded-xl ring-1 ring-stone-300">
      <MapContainer
        center={value ? [value.lat, value.lng] : DEFAULT_CENTER}
        zoom={value ? 16 : DEFAULT_ZOOM}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom={!readOnly}
        dragging
      >
        <OsmTiles />
        {!readOnly && onChange && <ClickToSet onChange={onChange} />}
        <Recenter point={value} />
        {value && (
          <Marker
            position={[value.lat, value.lng]}
            icon={dotIcon("#2f7a33")}
            draggable={!readOnly}
            eventHandlers={{
              dragend: (e) => {
                const ll = e.target.getLatLng();
                onChange?.({ lat: ll.lat, lng: ll.lng });
              },
            }}
          />
        )}
      </MapContainer>
    </div>
  );
}
