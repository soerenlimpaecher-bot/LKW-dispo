# Architektur und Agrarmonitor-Anbindung (Vorschlag, nicht freigegeben)

## Überblick

```
 Rechner im Büro (angemeldet in Agrarmonitor)
 ┌──────────────────────────────────────────┐
 │ Claude-Browser-Agent (Skill               │   nur lesen
 │ „essensservice-tagesabgleich“, neu)       │──────────────► admin10.agrarmonitor.de
 │ – Pivot-API: Aufträge des Tages           │               (Pivot-API, Arbeitszeit)
 │ – Arbeitszeit: wer ist eingestempelt      │
 └───────────────┬──────────────────────────┘
                 │ JSON + Token (Muster JARVIS V2)
                 ▼
 n8n-Cloud – eigener Workflow „ESSENSSERVICE“ (neu, getrennt von CONNECT/JARVIS)
 ┌──────────────────────────────────────────────────────────────┐
 │ POST /webhook/essen/sync   ← Tagesdaten vom Agenten           │
 │ GET  /webhook/essen/o      ← Oberhaupt-Seite (WhatsApp-Link)  │
 │ GET  /webhook/essen/buero  ← Büro (Schlüssel)                 │
 │ GET  /webhook/essen/kueche ← Küche (Schlüssel)                │
 │ GET/POST /webhook/essen/api                                   │
 │ Data Tables: Essen-Fahrer, Essen-Gruppen, Essen-Bestellungen, │
 │              Essen-Speiseplan, Essen-Config, Essen-Protokoll  │
 └──────────────────────────────────────────────────────────────┘
          ▲                 ▲                    ▲
     Oberhaupt (Handy)    Büro (PC)          Küche (Tablet/PC)
```

## Agrarmonitor-Anbindung

**Weg:** ein neuer, eigener Skill für den vorhandenen Browser-Agenten, der nur liest. Er läuft auf deinem
Rechner in der angemeldeten Sitzung, von Hand („Essensdaten holen“) oder als geplante Aufgabe in der
Claude-App, z. B. werktags um 7:30 Uhr. Eine neue API oder eine zweite Browserautomatisierung bauen wir nicht.

Ablauf eines Abgleichs:

1. **Aufträge des Tages** über die Pivot-API holen und im Browser filtern: `datum` = heute, dazu die Felder
   `mitarbeiter`, `projekt`, `kunde_id`, `rechnungsempfaenger`, `leistung`, `auftragsnummer`.
   Nur das gefilterte Ergebnis verlässt den Browser, nicht die 30 MB.
2. **Angemeldete Fahrer**: Wer heute in der Arbeitszeit „Anwesend ab“ ohne „Anwesend bis“ hat, ist eingestempelt.
   Für diese Liste gibt es keine dokumentierte JSON-Schnittstelle. **Vor der Umsetzung ist zu prüfen**, wie
   sich die Tagesliste von `/arbeitszeit` zuverlässig lesen lässt (HTML-Tabelle mit Filter auf heute).
   Ausweichlösung: Ein Fahrer gilt als angemeldet, wenn er heute einen laufenden Auftrag hat (Auftrag-Ende leer).
3. **Paket bauen**, eines je Fahrer: `sync_id = "ESSEN-" + Datum + "-" + Mitarbeiter`, Fahrer, Projekt,
   Kunde, Auftragsnummern, Quelle, `testdaten`.
4. Pakete an `POST /webhook/essen/sync` senden, mit eigenem Token (nicht dem JARVIS-Token).
5. **Gegenkontrolle** im `Essen-Protokoll`: Anzahl gesendet = Anzahl OK.

Was dabei nicht passiert: kein Schreiben in Agrarmonitor, keine Nachrichten an Fahrer, kein Eingriff in
die JARVIS-Tabellen.

## Automatische Fahrergruppen

Vorschlag für die Regel (bitte bestätigen):

1. **Gruppe = Projekt des Tages** (Kunde + Projektnummer). Wer heute am selben Projekt arbeitet, gehört in
   der Regel auch zur selben Einsatzstelle (Häcksler, Abfahrer, Walze).
2. Ein Fahrer mit mehreren Projekten am Tag kommt in die Gruppe seines **zuletzt begonnenen** Auftrags.
3. Fahrer ohne Auftrag, aber eingestempelt (Werkstatt, Hof) → Gruppe „Hof / ohne Einsatz“.
4. Das Büro kann Gruppen **zusammenlegen, teilen oder Fahrer umsetzen**. Die Korrektur gilt nur für den Tag.
5. **Oberhaupt**: Agrarmonitor kennt kein solches Feld. Das Büro legt es in der App fest. Die App schlägt
   vor, wer es gestern im selben Projekt war.

Optional später: Einsatzstellen über die Ackerschlag-Koordinaten zusammenführen, wenn zwei Projekte
nebeneinander liegen.

## Webanwendung: drei Ansichten

| Ansicht | Zugang | Funktionen |
|---|---|---|
| **Oberhaupt** | ein gemeinsamer Link für alle (WhatsApp-Gruppe) | Gruppe auswählen, mit kurzer **Gruppen-PIN** bestätigen, Speiseplan des Tages ansehen, für jedes Gruppenmitglied ein Gericht wählen oder „kein Essen“ setzen, Gäste ergänzen, Bestellung absenden und bis zum Bestellschluss ändern, Bestätigung sehen |
| **Büro** | Link + Zugangsschlüssel (Muster CONNECT-Dashboard) | Abgleich-Status, Gruppen und Oberhäupter pflegen, PIN vergeben, fehlende Bestellungen sehen, Bestellschluss setzen, WhatsApp-Text mit Link kopieren oder teilen, Tages- und Monatsauswertung (Anzahl je Projekt bzw. Kunde, als Grundlage zur Weiterberechnung) |
| **Küche** | eigener Schlüssel, nur lesen + Status | Speiseplan pflegen, Produktionsliste (Summe je Gericht), Packliste je Gruppe bzw. Einsatzstelle, Status „in Arbeit / ausgeliefert“ |

Zum gemeinsamen WhatsApp-Link: Weil alle denselben Link haben, verhindert die Gruppen-PIN, dass jemand
für eine fremde Gruppe bestellt. Wer was geändert hat und wann, steht im Protokoll. Später lassen sich
persönliche Links je Oberhaupt nach dem Token-Muster aus CONNECT nachrüsten.

## Technik

- **Backend:** n8n-Cloud. Ein **eigener Workflow „ESSENSSERVICE“** in einem eigenen Ordner, mit eigenen
  Webhook-Pfaden `/webhook/essen/*`. CONNECT und JARVIS bleiben unverändert.
- **Daten:** eigene n8n Data Tables `Essen-*`. Dieselbe Technik läuft bei CONNECT schon produktiv. Wenn
  die Datenmenge stark wächst, ist später ein Umzug in eine Datenbank möglich.
- **Oberfläche:** einfache HTML/CSS/JS-Seiten ohne Build-Schritt, als PWA für Handy und Tablet. Die
  Quelldateien liegen in `essensservice/app/`, n8n liefert sie aus. Die Workflows exportieren wir nach
  `essensservice/n8n/`, damit es einen Versionsstand gibt.
- **Sicherheit:** Schlüssel für Büro und Küche, Gruppen-PIN für Oberhäupter, Token für den Abgleich (alles
  in `Essen-Config`, nicht im Code und nicht im Repository), so wenig personenbezogene Daten wie möglich
  (Name und Gruppe, keine Arbeitszeiten speichern), Protokoll aller Änderungen.
- **Entwicklung:** zuerst mit erfundenen Testdaten (`testdaten: true`), dann ein Probelauf mit echten
  Daten nur lesend, danach Freigabe.

## Umsetzungsschritte (nach Freigabe)

1. Data Tables `Essen-*` anlegen und Testdaten einspielen.
2. n8n-Workflow „ESSENSSERVICE“ (Entwurf, nicht veröffentlicht): Sync-Endpunkt, API, Seitenauslieferung.
3. Oberflächen Oberhaupt → Küche → Büro.
4. Lese-Skill „essensservice-tagesabgleich“: Testlauf mit dir am Rechner.
5. Probebetrieb mit einer Gruppe, danach Veröffentlichung mit deiner Freigabe.
