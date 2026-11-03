# Bereitstellung und Testbetrieb

Die Anleitung führt Schritt für Schritt zu einer **Testumgebung**. Der produktive Start erfolgt erst nach
ausdrücklicher Freigabe.

## 1. Supabase-Projekt anlegen

1. Unter supabase.com ein neues Projekt anlegen, Region **Frankfurt (eu-central-1)**.
2. **Authentication → Sign In / Providers**: „Allow new users to sign up“ **ausschalten**. Konten für Büro und Küche
   legt nur ihr selbst an. (Auch ohne diese Einstellung hätte ein fremdes Konto keine Rechte – es fehlt der Eintrag in `staff`.)
3. **SQL Editor**: die Dateien aus `supabase/migrations/` **in Reihenfolge** ausführen
   (`…01_schema.sql` bis `…05_push.sql`). Alternativ mit der Supabase-CLI: `supabase link` und `supabase db push`.
   Die Datei `supabase/tests/supabase_shim.sql` gehört **nicht** dazu – sie bildet Supabase nur für lokale Tests nach.
4. **Database → Publications → supabase_realtime**: prüfen, dass die Tabellen `orders`, `delivery_locations`,
   `delivery_groups`, `group_assignments`, `delivery_confirmations`, `daily_meals`, `notifications` und `ratings`
   enthalten sind (die Migration trägt sie ein).
5. **Mitarbeiter anlegen**: unter Authentication → Users → „Add user“ (E-Mail + Passwort), dann im SQL Editor:

   ```sql
   insert into public.staff (user_id, name, role)
   select id, 'Name im Büro', 'buero' from auth.users where email = 'buero@…';
   insert into public.staff (user_id, name, role)
   select id, 'Name Küche', 'kueche' from auth.users where email = 'kueche@…';
   ```

6. Unter Project Settings → API die **Project URL**, den **anon key** und den **service_role key** notieren.

## 2. Web-Push-Schlüssel erzeugen

```bash
npx web-push generate-vapid-keys
```

Öffentlichen Schlüssel als `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, privaten als `VAPID_PRIVATE_KEY` hinterlegen.
`VAPID_SUBJECT` = `mailto:` + eine Kontaktadresse des Betriebs.

## 3. Vercel-Projekt

1. Neues Projekt aus dem GitHub-Repository, **Root Directory: `essensservice`**, Framework: Next.js.
2. Umgebungsvariablen (Production und Preview):

   | Variable | Wert |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role key (**nur serverseitig**, niemals mit `NEXT_PUBLIC_`) |
   | `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | aus Schritt 2 |
   | `CRON_SECRET` | langer Zufallswert (z. B. `openssl rand -hex 32`) |

   `LOCAL_DATABASE_URL` **nicht** setzen – sie ist nur für die lokale Entwicklung.
3. Optional eigene Domain (z. B. `essen.agrarlohn-mueritz.de`) verbinden. Web Push und GPS brauchen HTTPS.

### Wiederholung fehlgeschlagener Push-Nachrichten

Fehlgeschlagene Nachrichten werden sofort zweimal wiederholt; weitere Versuche plant die Datenbank (nach 1, 4, 9,
16 Minuten, höchstens 5 Versuche). Ausgelöst werden diese auf zwei Wegen:

- **Knopf „Erneut senden“** im Büro-Dashboard (immer verfügbar).
- **Automatisch** über `GET /api/cron/push` mit Header `Authorization: Bearer <CRON_SECRET>`, z. B. alle 5 Minuten.
  Bei Vercel Pro per `vercel.json`:

  ```json
  { "crons": [{ "path": "/api/cron/push", "schedule": "*/5 9-15 * * 1-6" }] }
  ```

  (Vercel-Zeitpläne laufen in UTC; 9–15 UTC deckt die Lieferzeit in Sommer- und Winterzeit ab.)
  Im kostenlosen Vercel-Tarif sind nur tägliche Cronjobs möglich – dann den Knopf nutzen oder einen externen
  Zeitplaner einsetzen.

## 4. Testbetrieb (Checkliste)

| Schritt | Erwartung |
|---|---|
| Küche trägt Gericht für morgen ein | erscheint im Büro, Fahrerlink zeigt es nach 9:00 als nächsten Tag |
| Büro legt 2–3 Testfahrer an, erzeugt Links, sendet per WhatsApp | Link öffnet die Fahrerseite |
| Fahrer bestellt vor 9:00, setzt Standort per GPS | Bestellung im Dashboard, Gruppe entsteht automatisch |
| Fahrer versucht nach 9:00 zu bestellen / nach 10:30 Standort zu ändern | verständliche Sperrmeldung |
| Büro verschiebt Fahrer auf der Karte | Zuordnung „manuell“, bleibt bei Neugruppierung erhalten |
| Küche öffnet Packliste nach 10:30, druckt/PDF | Gruppen mit Fahrern und Standorten |
| Lieferfahrer übernimmt Gruppe, bestätigt Ablage | Fahrer sieht „Dein Essen ist da!“ und erhält Push (wenn aktiviert) |
| Fahrer öffnet am Folgetag den Link | erst Bewertung, dann Bestellung |
| Büro prüft Bewertungen und Protokoll | Einträge vorhanden |

**iPhone:** Push funktioniert nur, wenn die Seite über „Teilen → Zum Home-Bildschirm“ installiert und von dort
geöffnet wurde (ab iOS 16.4). Android/Chrome: direkt im Browser.

## 5. Lokale Entwicklung ohne Supabase

```bash
npm install
npm run db:test:reset     # Test-Datenbank für automatisierte Tests
npm test
npm run db:dev:reset      # Entwicklungsdatenbank mit erfundenen Beispieldaten, gibt Links aus
LOCAL_DATABASE_URL=postgres://postgres:postgres@localhost:5432/essen_dev npm run dev
```

Auf `/login` erscheint dann eine Mitarbeiterauswahl statt der Passwortanmeldung. Live-Aktualisierung erfolgt lokal
per Abfrage (alle 10–15 Sekunden) statt über Supabase Realtime.

## 6. Hinweise für spätere Erweiterungen

- Neue Datenbankfunktionen bekommen in Supabase automatisch Ausführungsrechte für `anon`/`authenticated`. Jede neue
  Migration muss diese – wie die vorhandenen – ausdrücklich entziehen und gezielt vergeben.
- Erweiterungen (WhatsApp-Versand, Agrarmonitor-Abgleich, Agrarlohn-App) sind nicht Teil von Version 1. Die
  Erkenntnisse aus `01-bestandsaufnahme.md` (n8n-Übergabe, Pivot-Schnittstelle) bleiben dafür gültig.
