# Bestandsaufnahme (Stand 30.10.2026)

Geprüft wurde nur lesend. Nichts an bestehenden Systemen wurde verändert.

## 1. Repository `LKW-dispo`

- Einzige Datei: `index.html` – „LKW Dispo V0.2“. Darin 20 fest eingetragene LKW-Karten, die Aufträge
  liegen im `localStorage` des Browsers. Es gibt kein Backend und keine Agrarmonitor-Anbindung.
- **Für den Essensservice nicht nutzbar** und wird nicht angefasst. Der Essensservice liegt
  ausschließlich im Ordner `essensservice/`.

## 2. n8n-Cloud (`agrarlohn-mueritz.app.n8n.cloud`)

Vorhandene Workflows:

| Workflow | Status | Bedeutung für den Essensservice |
|---|---|---|
| AGRARLOHN CONNECT (`iLA53KP9fPhWgUGn`) | aktiv | **Vorlage für das Muster**: Webseiten werden über Webhooks ausgeliefert (`/webhook/connect/...`), Links mit Token, Ablaufdatum und Widerruf, Dashboard mit Zugangsschlüssel, PWA (Manifest, Icon, Service Worker), Daten in Data Tables, Protokoll. Laut Beschreibung „keine Verbindung zu AGRARMONITOR“. |
| AGRARLOHN CONNECT – Transport Kundenlink / Transportrechner LKW | aktiv | Kundenlink mit WhatsApp-Bezug in der Admin-Seite. Wird nicht verändert. |
| JARVIS – Auftragseingang V2 (Webhook) (`nfLXWSkK3mGIyiis`) | aktiv | **Vorlage für die Datenübergabe**: Der Browser-Agent schickt Auftragsdaten als JSON, geprüft über Token, Duplikatschutz über `sync_id`, Sync-Log. |
| JARVIS – Stimme, Sprachkonsole, Aufgabe zurückmelden, Auftragskontrolle V1 | teils aktiv | Ohne Bezug, wird nicht verändert. |

Vorhandene Data Tables: `Aufträge`, `Sync-Log`, `Jarvis-*`, `Connect-*`. Der Essensservice **benutzt keine davon mit**, er bekommt eigene Tabellen.

Credentials: nur `Header Auth account` (httpHeaderAuth). **Es gibt keine WhatsApp-, SMS- oder Mail-Versand-Credentials** in n8n.

## 3. Agrarmonitor-Skills (Browser-Agent)

Alle Skills arbeiten im **angemeldeten Browser des Nutzers** unter `https://admin10.agrarmonitor.de`.
Kennung und Passwort gibt Claude nie selbst ein. Lesen per `fetch()` im Seitenkontext ist erlaubt.
Schreiben ist nur über die Oberfläche erlaubt, und der Essensservice schreibt überhaupt nicht.

Bereits dokumentierte und in Skills benutzte **Lesewege**:

| Daten | Weg | Quelle (Skill) |
|---|---|---|
| Alle Aufträge (Mitarbeiter, Kunde, Projekt, Leistung, Datum, Maschine) | `GET /module/reports/api/pivotDaten.php?pivotDatenClassName=AM%5CAdmin%5CAuswertung%5CPivot%5CPivotDatenAuftraege` (JSON, ca. 30 MB, im Browser filtern) | erntefortschritt, pkw-fahrten |
| Feldnamen daraus (geprüft) | `auftragsnummer`, `datum`, `mitarbeiter`, `projekt`, `leistung`, `kunde_id`, `rechnungsempfaenger`, `lempf`, `zugmaschine_maschinennummer`, `auftragskategorie` (die Namen können je Mandant abweichen, vorher `Object.keys` prüfen) | erntefortschritt, pkw-fahrten |
| Laufend/beendet je Auftrag | Auswertung „Dynamisch auf Auftragsbasis“ (`/reports/auftraege-dynamisch`), Spalte „Auftrag-Ende“ leer = läuft | n8n-uebergabe, auftragskontrolle |
| Einzelauftrag inkl. Ackerschläge, Notizen | `GET /auftrag/<id>` (HTML, DOMParser) | laufende-auftraege, pkw-fahrten |
| Ackerschläge (Polygone lat/lng) eines Auftrags | `GET /module/ackerschlaege/api/bearbeiteteSchlaegeImAuftrag.php?vorgang_id=<id>` | erntefortschritt, projekt-pdf |
| GPS-Spur eines Auftrags | `GET /module/standortverlauf/api/operationTrack.php?geoUUID=<uuid>` | dieselkontrolle, projekt-pdf |
| Anwesenheit je Mitarbeiter und Tag („Anwesend ab/bis“) | Oberfläche `/arbeitszeit`, Tagesansicht `/arbeitszeit/detail/<Mitarbeiter-ID>/<JJJJ-MM-TT>` (HTML). Eine JSON-Schnittstelle dafür ist **nicht** dokumentiert. | arbeitszeitkontrolle |
| Disposition (geplante Einsätze) | eigene Domain `disposition.agrarmonitor.de`, Zugang über `/module/disposition/api/transmitAccessCode.php`. Dokumentiert ist nur die Bedienung über die Oberfläche, kein Datenabruf. | auftragsaktivierung |
| Nachrichten an Fahrer | Agrarmonitor → Nachrichten (Oberfläche) | laufende-auftraege |

Es gibt **keine offizielle Agrarmonitor-API** mit eigenem Zugang (API-Key oder Servicekonto). Alle Wege
setzen eine angemeldete Browsersitzung voraus. Einige Schreib-Endpunkte lehnen gebündelte API-Zugriffe
nachweislich ab. Für den Essensservice ist das egal, weil er nur liest.

## 4. Diese Cloud-Umgebung

- Agrarmonitor ist von hier **nicht erreichbar** (der Proxy antwortet mit 403). Lesen geht nur über den Browser
  auf deinem Rechner (Claude-App mit eingebautem Browser oder Claude in Chrome), in dem du angemeldet bist.
- n8n ist über den Konnektor erreichbar, lesend und schreibend.
- Vorhanden: Node 22, Python 3.13, Docker, psql, Playwright/Chromium. Für den empfohlenen Weg brauchen wir davon nichts.
- Gmail- und Google-Sheets-Konnektor sind verbunden. Einen WhatsApp-Konnektor gibt es nicht.

## 5. Fazit: was wir nutzen

1. **n8n-Webhook-Muster aus AGRARLOHN CONNECT**: Auslieferung der Weboberfläche, Token-Links, Schlüssel fürs Büro, Data Tables. Wir übernehmen das Muster, nicht den Workflow.
2. **Übergabe-Muster aus JARVIS Auftragseingang V2**: Browser-Agent → JSON → n8n-Webhook mit Token, `sync_id`, Sync-Log.
3. **Pivot-API und Arbeitszeit-Ansicht** aus den vorhandenen Skills als einzige Agrarmonitor-Lesewege.
4. **WhatsApp ohne Schnittstelle**: Den Link teilen wir von Hand in der WhatsApp-Gruppe, auf Wunsch über einen „Teilen“-Knopf (`https://wa.me/?text=…`).
