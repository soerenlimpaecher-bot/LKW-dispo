# Offene Punkte und fehlende Voraussetzungen

## Zugänge für die Testumgebung (von euch bereitzustellen)

1. **Supabase-Projekt** (Region Frankfurt) – Project URL, anon key, service_role key.
2. **Vercel-Projekt** mit Zugriff auf dieses GitHub-Repository (Root Directory `essensservice`).
3. **Kontaktadresse** für Web Push (`VAPID_SUBJECT`) und optional eine **Domain** für die Links.
4. **E-Mail-Adressen** der ersten Büro- und Küchenkonten.

In dieser Entwicklungsumgebung gab es keinen Supabase- oder Vercel-Zugang. Alles ist gegen ein lokales
PostgreSQL 16 mit nachgebildeten Supabase-Rollen entwickelt und getestet. Ein Lauf gegen ein echtes Supabase-Projekt
steht noch aus (Schritte in `04-bereitstellung.md`).

## Fachlich zu bestätigen

- **Löschfristen** für Standortdaten und Protokolle (Vorschlag: Standorte nach 90 Tagen, Protokoll nach 1 Jahr).
  Eine automatische Löschung ist noch nicht eingebaut.
- **Hinweisfeld** zur Bestellung (max. 500 Zeichen, z. B. „ohne Soße“) – ist eingebaut, bitte bestätigen.
- **Adresse ohne Kartenpunkt** gilt als „Standort unvollständig“, bis das Büro den Punkt setzt. Eine automatische
  Adresssuche (Geocoding) ist nicht eingebaut, weil dafür ein externer Dienst nötig wäre.
- **Ablauf nach 9:00 Uhr**: Fahrer sehen dann automatisch das Gericht des Folgetags und können dafür bestellen,
  sobald die Küche es eingetragen hat.
- **Gruppen mit manuellen Zuordnungen** bleiben vollständig unangetastet (die Automatik fügt dort auch niemanden hinzu).
- **Kartenkacheln**: OpenStreetMap-Standardkacheln sind für geringe Nutzung frei; bei starker Nutzung ist ein
  Kachelanbieter nötig.

## Bekannte Einschränkungen

- iPhones erhalten Web Push nur aus der zum Home-Bildschirm hinzugefügten App (ab iOS 16.4).
- Automatische Push-Wiederholungen per Cron brauchen Vercel Pro oder einen externen Zeitplaner; sonst Knopf im Büro.
- „Drucken / PDF“ nutzt den Druckdialog des Browsers („Als PDF speichern“).

## Abweichungen vom ersten Vorschlag (durch den Master-Prompt)

- Kein Gruppenoberhaupt und kein gemeinsamer WhatsApp-Link, sondern persönliche Links je Fahrer
  (Weitergabe per WhatsApp-Knopf im Büro).
- Keine Agrarmonitor- und keine n8n-Anbindung in Version 1.
