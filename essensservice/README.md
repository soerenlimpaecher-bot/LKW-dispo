# Agrarlohn Essensservice

Essensbestell- und Auslieferungsplattform der Agrarlohn Müritz GmbH, umgesetzt nach dem Master-Prompt
„Essensservice 1.0“. Rollen: Fahrer, Büro, Küche und Essenslieferfahrer.

Der Ordner ist vollständig getrennt von der bestehenden Betriebssteuerung (`/index.html` „LKW Dispo“,
n8n „AGRARLOHN CONNECT“/„JARVIS“, Agrarmonitor-Skills). Diese Systeme werden nicht verändert.

## Stand

| Phase | Inhalt | Stand |
|---|---|---|
| 1 | Bestandsaufnahme | erledigt – [docs/01-bestandsaufnahme.md](docs/01-bestandsaufnahme.md) |
| 2 | Architektur, Datenmodell, Rechte | erledigt – [docs/02-architektur.md](docs/02-architektur.md), `supabase/migrations/` |
| 3–7 | Oberflächen, Karte, Auslieferung, Push, Bereitstellung | in Arbeit |

Offene Punkte und fehlende Zugänge: [docs/03-offene-punkte.md](docs/03-offene-punkte.md)

## Entwicklung

```bash
npm install
cp .env.example .env.local      # Werte eintragen
npm run db:test:reset           # lokale Test-Datenbank (PostgreSQL) anlegen
npm test                        # automatisierte Tests
npm run dev                     # http://localhost:3000
```

Die Tests laufen gegen ein lokales PostgreSQL mit nachgebildeten Supabase-Rollen
(`supabase/tests/supabase_shim.sql`). Die feste Testuhr (`app.fake_now`) wirkt nur in Datenbanken,
in denen `app.testmode = 'on'` gesetzt ist – also nie in Produktion.
