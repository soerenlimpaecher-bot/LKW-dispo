"use client";

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { TileLayer } from "react-leaflet";

// Startansicht, wenn noch kein Standort bekannt ist: Raum Müritz.
export const DEFAULT_CENTER: [number, number] = [53.52, 12.68];
export const DEFAULT_ZOOM = 10;

export function OsmTiles() {
  return (
    <TileLayer
      url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende'
      maxZoom={19}
    />
  );
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Runder Punkt-Marker ohne Bilddateien. */
export function dotIcon(color: string) {
  return L.divIcon({
    className: "",
    html: `<div class="marker-dot" style="background:${color}"></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

/** Marker mit kurzer Beschriftung (z. B. Gruppennummer). */
export function labelIcon(label: string, color: string) {
  return L.divIcon({
    className: "",
    html: `<div class="marker-label" style="background:${color}">${esc(label)}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

// Gut unterscheidbare Gruppenfarben
const PALETTE = ["#2563eb", "#dc2626", "#16a34a", "#9333ea", "#ea580c", "#0891b2", "#be185d", "#4d7c0f", "#7c3aed", "#b45309"];
export const groupColor = (seq: number) => PALETTE[(seq - 1) % PALETTE.length];
