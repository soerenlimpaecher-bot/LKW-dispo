# Agrarlohn Essensservice

Eigenständiges Projekt für die Essensbestellung der Fahrer von Agrarlohn Müritz.
Büro, Küche und Gruppenoberhäupter arbeiten in einer gemeinsamen Webanwendung.
Das Oberhaupt einer Fahrergruppe bestellt das Essen für seine ganze Gruppe. Den Link dazu
verteilen wir zunächst über WhatsApp.

**Status:** Bestandsaufnahme und Planung. Es gibt noch keinen Programmcode. Die Umsetzung beginnt erst nach Freigabe.

## Abgrenzung

- Dieser Ordner ist vollständig getrennt von der bestehenden Betriebssteuerung
  (`/index.html` „LKW Dispo“, n8n „AGRARLOHN CONNECT“, „JARVIS“ und die Agrarmonitor-Skills).
- Der Essensservice liest Agrarmonitor nur, er schreibt dort nie.
- Er bekommt eigene n8n-Workflows, eigene Data Tables (`Essen-*`) und eigene Webhook-Pfade (`/webhook/essen/*`).

## Struktur

| Ordner | Inhalt |
|---|---|
| `docs/` | Bestandsaufnahme, Architektur, offene Punkte |
| `app/` | Weboberfläche (Büro, Küche, Oberhaupt) – HTML/JS |
| `n8n/` | Exportierte n8n-Workflows des Essensservice (Versionsstand) |
| `agent/` | Lese-Skripte für den Agrarmonitor-Browser-Agenten |
| `testdaten/` | Erfundene Testdaten, ausdrücklich als Test markiert |

## Dokumente

1. [Bestandsaufnahme](docs/01-bestandsaufnahme.md): was vorhanden ist und was davon nutzbar ist
2. [Architektur und Agrarmonitor-Anbindung](docs/02-architektur.md)
3. [Offene Punkte und Voraussetzungen](docs/03-offene-punkte.md)
