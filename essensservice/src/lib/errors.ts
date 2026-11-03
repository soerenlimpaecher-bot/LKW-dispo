// Fehlercodes aus der Datenbank → verständliche Meldungen und HTTP-Status.
export const ERRORS: Record<string, { status: number; message: string }> = {
  UNGUELTIGER_LINK: { status: 401, message: "Dieser Link ist ungültig oder gesperrt. Bitte melde dich im Büro." },
  KEINE_BERECHTIGUNG: { status: 403, message: "Dafür fehlt die Berechtigung." },
  BESTELLSCHLUSS: { status: 409, message: "Bestellschluss ist um 9:00 Uhr. Änderungen sind jetzt nur noch über das Büro möglich." },
  STANDORTSCHLUSS: { status: 409, message: "Der Standort kann nach 10:30 Uhr nur noch vom Büro geändert werden." },
  BEWERTUNG_AUSSTEHEND: { status: 409, message: "Bitte bewerte zuerst dein letztes Essen." },
  KEINE_BEWERTUNG_OFFEN: { status: 409, message: "Für dieses Essen ist keine Bewertung offen." },
  UNGUELTIGE_BEWERTUNG: { status: 400, message: "Bitte 1 bis 5 Punkte vergeben." },
  KEIN_TAGESGERICHT: { status: 409, message: "Für diesen Tag ist noch kein Gericht eingetragen." },
  GERICHT_NICHT_VERFUEGBAR: { status: 409, message: "Das Gericht ist für diesen Tag nicht verfügbar." },
  KEINE_BESTELLUNG: { status: 409, message: "Für diesen Tag gibt es keine Bestellung." },
  DATUM_UNGUELTIG: { status: 400, message: "Für dieses Datum ist das nicht möglich." },
  BEREITS_UNTERWEGS: { status: 409, message: "Das Essen ist schon unterwegs – bitte im Büro melden." },
  UNGUELTIGE_QUELLE: { status: 400, message: "Ungültige Standortangabe." },
  NICHT_GEFUNDEN: { status: 404, message: "Nicht gefunden." },
  GRUPPE_NICHT_GEFUNDEN: { status: 404, message: "Liefergruppe nicht gefunden." },
  UNGUELTIGE_AUSWAHL: { status: 400, message: "Die Auswahl passt nicht zu dieser Gruppe." },
  NICHT_FREIGEGEBEN: { status: 409, message: "Diese Gruppe ist noch nicht freigegeben." },
  GRUPPE_VERGEBEN: { status: 409, message: "Diese Gruppe fährt bereits ein anderer Lieferfahrer." },
  BEREITS_ZUGESTELLT: { status: 409, message: "Dieses Essen ist bereits zugestellt." },
  ABLAGEORT_FEHLT: { status: 400, message: "Bitte Standort übernehmen oder den Ablageort beschreiben." },
  EINGABE_UNGUELTIG: { status: 400, message: "Die Eingabe ist unvollständig oder ungültig." },
  NICHT_ANGEMELDET: { status: 401, message: "Bitte anmelden." },
};

export class AppError extends Error {
  constructor(
    public code: string,
    public status = ERRORS[code]?.status ?? 500,
  ) {
    super(ERRORS[code]?.message ?? "Unerwarteter Fehler. Bitte später erneut versuchen.");
  }
}

/** Erkennt einen bekannten Fehlercode in einer Datenbank-Fehlermeldung. */
export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  const msg = String((e as { message?: string })?.message ?? e);
  const code = Object.keys(ERRORS).find((c) => msg.includes(c));
  if (code) return new AppError(code);
  if (/permission denied/i.test(msg)) return new AppError("KEINE_BERECHTIGUNG");
  return new AppError("UNBEKANNT", 500);
}
