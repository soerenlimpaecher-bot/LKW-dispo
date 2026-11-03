// Anzeige immer in Europe/Berlin, unabhängig von der Zeitzone des Geräts.
const TZ = "Europe/Berlin";

const timeFmt = new Intl.DateTimeFormat("de-DE", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const dateFmt = new Intl.DateTimeFormat("de-DE", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" });
const shortDateFmt = new Intl.DateTimeFormat("de-DE", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("de-DE", {
  timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
});
const ymdFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

export const fmtTime = (iso: string) => timeFmt.format(new Date(iso));
export const fmtDateTime = (iso: string) => dateTimeFmt.format(new Date(iso));
/** "2026-11-04" → "Mittwoch, 4. November" (12:00 UTC liegt sicher im richtigen Kalendertag) */
export const fmtDay = (ymd: string) => dateFmt.format(new Date(`${ymd}T12:00:00Z`));
export const fmtShortDate = (ymd: string) => shortDateFmt.format(new Date(`${ymd}T12:00:00Z`));
/** Heutiges Datum in Berlin als YYYY-MM-DD */
export const berlinToday = (now = new Date()) => ymdFmt.format(now);
export const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const fmtPrice = (v: number | null | undefined) =>
  v == null ? "–" : new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(v);

export type EffectiveStatus = "offen" | "in_vorbereitung" | "unterwegs" | "zugestellt" | "storniert";

export const STATUS_LABEL: Record<EffectiveStatus, string> = {
  offen: "Bestellt",
  in_vorbereitung: "In Vorbereitung",
  unterwegs: "Unterwegs",
  zugestellt: "Zugestellt",
  storniert: "Storniert",
};

export const STATUS_COLOR: Record<EffectiveStatus, string> = {
  offen: "bg-sky-100 text-sky-800 ring-sky-200",
  in_vorbereitung: "bg-amber-100 text-amber-900 ring-amber-200",
  unterwegs: "bg-violet-100 text-violet-800 ring-violet-200",
  zugestellt: "bg-brand-100 text-brand-700 ring-brand-500/30",
  storniert: "bg-stone-200 text-stone-600 ring-stone-300",
};

/** Link in die Karten-App des Geräts (öffnet Navigation). */
export const navigationUrl = (lat: number, lng: number) =>
  `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lng.toFixed(6)}`;
