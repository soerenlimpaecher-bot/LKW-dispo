# Offene Punkte und fehlende Voraussetzungen

## Technisch zu klären bzw. zu prüfen

1. **Angemeldete Fahrer**: Wie lässt sich die heutige Anwesenheit aus `/arbeitszeit` zuverlässig lesen?
   (Ein Testlauf am Rechner im Büro ist nötig. Eine JSON-Schnittstelle dafür ist nicht dokumentiert.) Stempeln
   alle Fahrer morgens überhaupt ein, oder ist der erste Auftrag das bessere Merkmal?
2. **Planung für morgen**: Soll schon am Vortag bestellt werden? Dann bräuchten wir die Disposition
   (`disposition.agrarmonitor.de`). Ein Datenabruf von dort ist bisher nicht erprobt, nur die Bedienung über die Oberfläche.
3. **Ausführung des Abgleichs**: Läuft die Claude-App mit eingebautem Browser (oder Claude in Chrome) auf
   einem Bürorechner, der morgens an und in Agrarmonitor angemeldet ist? Von der Cloud aus ist Agrarmonitor
   nicht erreichbar.
4. **Pivot-Feldnamen** einmal am echten Mandanten mit `Object.keys` bestätigen, insbesondere, ob es einen
   Auftragsbeginn mit Uhrzeit gibt (wichtig für die Regel „zuletzt begonnener Auftrag“).
5. **n8n-Tarif**: Wie viele Ausführungen gibt der Tarif her? (Jeder Seitenaufruf ist eine Ausführung.)

## Fachlich festzulegen (kommt vermutlich mit dem Master-Prompt)

- Gruppenregel bestätigen (Gruppe = Projekt des Tages?) und wer Oberhaupt ist bzw. wer das festlegt.
- Speiseplan: wer pflegt ihn, wie viele Gerichte, Allergene, vegetarisch, Portionsgrößen.
- Bestellschluss (Uhrzeit), ob nach Bestellschluss noch geändert werden darf, Lieferung oder Abholung, Lieferorte.
- Kosten: Wer zahlt, wird an Kunden weiterberechnet, gibt es einen Eigenanteil der Fahrer?
- Wer in der Küche bedient die App, und auf welchem Gerät?
- Datenschutz: Darf die Anwesenheit dafür genutzt werden? Wir speichern nur Name, Gruppe und Bestellung.

## Bestätigung nötig

- Gilt als „bestehende Betriebssteuerung“ alles, was ich als unantastbar eingestuft habe? Das sind `index.html`
  (LKW Dispo), die n8n-Workflows AGRARLOHN CONNECT* und JARVIS* mit ihren Tabellen sowie die Agrarmonitor-Skills.
- Speicherort: Ordner `essensservice/` in diesem Repository (Branch `claude/agrarlohn-essensservice-0w34kw`)
  oder später ein eigenes Repository `agrarlohn-essensservice`.
