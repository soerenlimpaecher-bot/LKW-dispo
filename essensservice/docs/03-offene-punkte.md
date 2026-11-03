# Offene Punkte und fehlende Voraussetzungen

## Zugänge (werden für den Testbetrieb benötigt)

1. **Supabase-Projekt** (Region EU, z. B. Frankfurt): Projekt-URL, `anon`-Key und `service_role`-Key.
   In dieser Entwicklungsumgebung gibt es keinen Supabase-Zugang; entwickelt und getestet wird gegen ein lokales
   PostgreSQL 16 mit nachgebildeten Supabase-Rollen.
2. **Vercel-Projekt** mit Verbindung zum GitHub-Repository und den Umgebungsvariablen aus `.env.example`.
3. **Domain** für die Links (z. B. `essen.agrarlohn-mueritz.de`), sonst die Vercel-Adresse.
4. **VAPID-Schlüssel** für Web Push (lassen sich mit `npx web-push generate-vapid-keys` erzeugen) und eine
   Kontaktadresse des Betriebs für `VAPID_SUBJECT`.

## Fachlich festzulegen

- Löschfrist für Standortdaten und Protokolle (Vorschlag: Standorte nach 90 Tagen, Protokoll nach 1 Jahr).
- Freitext-Hinweis zur Bestellung (z. B. Allergien) – vorgesehen, max. 500 Zeichen. Bestätigen, ob gewünscht.
- Adresse ohne Kartenpunkt: wird als „Standort unvollständig“ geführt, bis das Büro den Punkt setzt. Eine automatische
  Adresssuche (Geocoding) ist nicht eingebaut, weil dafür ein externer Dienst nötig wäre.

## Abweichungen vom ersten Vorschlag (durch den Master-Prompt)

- Kein Gruppenoberhaupt und kein gemeinsamer WhatsApp-Link mehr, stattdessen persönliche Links je Fahrer.
- Keine Agrarmonitor- und keine n8n-Anbindung in Version 1.

## Technische Hinweise

- iPhones erhalten Web Push nur, wenn die Seite als App zum Home-Bildschirm hinzugefügt wurde (ab iOS 16.4).
- Push-Wiederholungen laufen über `/api/cron/push` (Vercel Cron, abgesichert mit `CRON_SECRET`) und über einen
  Knopf im Büro-Dashboard.
