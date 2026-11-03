# Architektur (Master-Prompt „Essensservice 1.0“)

Diese Fassung ersetzt den ersten Architekturvorschlag (n8n mit Gruppenoberhaupt). Maßgeblich ist der Master-Prompt:
persönliche Links je Fahrer, Supabase und Next.js. WhatsApp- und Agrarmonitor-Anbindung sind ausdrücklich
**nicht** Teil von Version 1. Die Erkenntnisse aus der Bestandsaufnahme (`01-bestandsaufnahme.md`) bleiben für
spätere Integrationen gültig.

## Bausteine

| Schicht | Technik | Aufgabe |
|---|---|---|
| Oberfläche | Next.js 15 (App Router), TypeScript, Tailwind CSS 4, PWA | Fahrer, Lieferfahrer, Büro, Küche |
| Karten | Leaflet + OpenStreetMap | Standortwahl, Dispositionskarte, Navigation |
| Server | Next.js Route Handlers (Vercel) | Token-Links auflösen, Web Push versenden |
| Datenbank | Supabase PostgreSQL | Daten, **alle Regeln** als Funktionen, RLS |
| Anmeldung | Supabase Auth | Büro und Küche (E-Mail + Passwort) |
| Live | Supabase Realtime | Dashboard, Karte, Küche aktualisieren sich selbst |
| Push | Web Push (VAPID), Bibliothek `web-push` | „Dein Essen ist da!“ |

## Rollen und Zugang

| Rolle | Zugang | Wie geprüft |
|---|---|---|
| Fahrer | persönlicher Link `/f/<token>` | Server reicht das Token an DB-Funktionen weiter, die DB vergleicht den SHA-256-Hash |
| Essenslieferfahrer | persönlicher Link `/l/<token>` | wie Fahrer, eigener Token-Typ |
| Büro | Anmeldung, Rolle `buero` in `staff` | RLS + Rollenprüfung in jeder Funktion |
| Küche | Anmeldung, Rolle `kueche` in `staff` | RLS + Rollenprüfung in jeder Funktion |

- Tokens: 256 Bit Zufall, in der Datenbank **nur als Hash** gespeichert, jederzeit sperr- und neu erzeugbar,
  höchstens ein gültiger Link je Person. Ein Link zeigt nur die eigenen Daten.
- Fahrer- und Lieferfahrer-Funktionen dürfen nur vom Server (`service_role`) aufgerufen werden; Browser haben
  keinen direkten Datenbankzugriff.
- Clients schreiben nie direkt in Tabellen. Jede Änderung läuft über eine geprüfte Funktion und landet im `audit_log`.
- Der interne Preis ist nur für Büro und Küche lesbar und taucht in keiner Fahrer- oder Lieferfahrer-Antwort auf.

## Zeitregeln (serverseitig, Europe/Berlin)

| Regel | Umsetzung |
|---|---|
| Bestellschluss 09:00 | `order_deadline(datum)` = `(datum + 09:00) at time zone 'Europe/Berlin'` → Sommer-/Winterzeit automatisch |
| Standortschluss 10:30 | `location_deadline(datum)`; ab dann sind die Gruppen endgültig und werden nicht mehr automatisch verändert |
| Welcher Tag wird bestellt | bis 09:00 der heutige Tag, danach der Folgetag (sobald die Küche das Gericht eingetragen hat) |
| Büro | ohne Fristen; Änderungen nach 10:30 werden für die Küche markiert |
| 08:00 / 09:00 / 10:30 | Küchenansicht zeigt Phase „Zwischenstand“, „Bestellschluss“, „endgültig“ – live berechnet, kein Cronjob nötig |

## Liefergruppen

- Verfahren: agglomeratives Clustering mit vollständiger Verknüpfung (complete linkage) in der Datenbank
  (`regroup_day`). Zwei Gruppen werden nur zusammengelegt, wenn danach **alle** Standorte paarweise ≤ 500 m
  Luftlinie (Haversine) auseinanderliegen. Kunden spielen keine Rolle.
- Auslöser bis 10:30: Bestellung, Stornierung, Standortänderung (Fahrer oder Büro). Danach nur auf Knopfdruck des Büros.
- Manuelle Zuordnungen (verschieben, zusammenlegen, trennen) sind markiert und werden von der Automatik nie
  verändert; Gruppen mit manuellen Mitgliedern bleiben unangetastet. Das Büro kann sie wieder freigeben.
- Primärschlüssel `group_assignments.order_id` verhindert doppelte Zuordnungen.
- Es gibt keinen gemeinsamen Ablageort; jeder Fahrer behält seinen Standort.
- Fahrer ohne Koordinaten (kein Standort oder nur Adresse) erscheinen separat als „Standort fehlt“.

## Auslieferung und Push

1. Ab 10:30 (oder nach Freigabe durch das Büro) sieht der Lieferfahrer die Gruppen.
2. „Gruppe übernehmen“ setzt die Bestellungen auf *unterwegs*.
3. „Abgelegt“: Der Lieferfahrer wählt die tatsächlich abgelegten Bestellungen und den Ablageort (GPS und/oder Beschreibung).
   Gespeichert werden Zeit, Lieferfahrer, Bestellungen und Ort. Jede Bestellung kann nur einmal zugestellt werden.
4. Je zugestellter Bestellung entsteht genau eine Benachrichtigung (`unique(order_id, kind)`), danach Versand per
   Web Push. Ergebnis je Nachricht: gesendet, fehlgeschlagen (mit Wiederholung) oder kein Abo. Die Zustellung bleibt
   auch ohne Push gespeichert.

## Datenmodell (Supabase)

`staff`, `drivers`, `couriers`, `access_tokens`, `daily_meals`, `orders`, `delivery_locations` (mit Verlauf),
`delivery_groups`, `group_assignments`, `delivery_runs`, `delivery_run_groups`, `delivery_confirmations`,
`delivery_confirmation_items`, `ratings`, `push_subscriptions`, `notifications`, `audit_log`.
Details: `supabase/migrations/`.

## Datenschutz

Gespeichert werden nur Name, optional Kunde/Hinweis und Telefonnummer des Fahrers, Bestellungen, Standorte des
Liefertags und Bewertungen. Keine Arbeitszeiten, keine Daten aus Agrarmonitor. Eine Löschfrist für Standortdaten
ist noch festzulegen (siehe offene Punkte).

## Ordnerstruktur

```
essensservice/
  docs/                 Bestandsaufnahme, Architektur, offene Punkte, Betrieb
  supabase/migrations/  Datenbankschema, Funktionen, Rechte (für Supabase)
  supabase/tests/       Supabase-Nachbildung für lokale Tests
  src/app/              Seiten und API-Routen (Next.js)
  src/lib/              Server- und Hilfsmodule
  src/components/       Oberflächenbausteine
  tests/                automatisierte Tests (Vitest)
  scripts/              Hilfsskripte (Test-Datenbank)
```
