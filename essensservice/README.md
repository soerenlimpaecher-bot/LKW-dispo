# Agrarlohn Essensservice

Essensbestell- und Auslieferungsplattform der Agrarlohn Müritz GmbH, umgesetzt nach dem Master-Prompt
„Essensservice 1.0“. Rollen: Fahrer, Büro, Küche und Essenslieferfahrer.

Der Ordner ist vollständig getrennt von der bestehenden Betriebssteuerung (`/index.html` „LKW Dispo“,
n8n „AGRARLOHN CONNECT“/„JARVIS“, Agrarmonitor-Skills). Diese Systeme wurden nicht verändert.

## Stand

| Phase | Inhalt | Stand |
|---|---|---|
| 1 | Bestandsaufnahme | erledigt – [docs/01-bestandsaufnahme.md](docs/01-bestandsaufnahme.md) |
| 2 | Architektur, Datenmodell, Rechte | erledigt – [docs/02-architektur.md](docs/02-architektur.md), `supabase/migrations/` |
| 3 | Fahrerbestellung (Links, Fristen, Pflichtbewertung, Standort) | erledigt – `/f/<token>` |
| 4 | Büro und Küche (Dashboard, Bestellungen, Fahrer/Links, Küche, Bewertungen, Protokoll) | erledigt – `/buero`, `/kueche` |
| 5 | Karte und 500-m-Gruppen | erledigt – `/buero/karte` |
| 6 | Auslieferung und Push | erledigt – `/l/<token>` |
| 7 | Tests und Bereitstellung | Tests und Build grün; Testumgebung wartet auf Zugänge – [docs/04-bereitstellung.md](docs/04-bereitstellung.md) |

Offene Punkte und fehlende Zugänge: [docs/03-offene-punkte.md](docs/03-offene-punkte.md)

## Seiten

| Adresse | Für |
|---|---|
| `/f/<token>` | Fahrer: bestellen, bewerten, Standort, Lieferstatus |
| `/l/<token>` | Essenslieferfahrer: Gruppen, Navigation, Ablage bestätigen |
| `/login` | Anmeldung Büro/Küche |
| `/buero` · `/buero/karte` · `/buero/bestellungen` · `/buero/fahrer` · `/buero/bewertungen` · `/buero/protokoll` | Büro |
| `/kueche` | Küche: Tagesgericht, Produktion, Packlisten |

## Entwicklung

```bash
npm install
npm run db:test:reset     # lokale Test-Datenbank (PostgreSQL)
npm test                  # automatisierte Tests
npm run db:dev:reset      # Entwicklungsdatenbank mit Beispieldaten
LOCAL_DATABASE_URL=postgres://postgres:postgres@localhost:5432/essen_dev npm run dev
```

Die Tests laufen gegen ein lokales PostgreSQL mit nachgebildeten Supabase-Rollen
(`supabase/tests/supabase_shim.sql`). Die feste Testuhr (`app.fake_now`) wirkt nur in Datenbanken,
in denen `app.testmode = 'on'` gesetzt ist – also nie in Produktion.
