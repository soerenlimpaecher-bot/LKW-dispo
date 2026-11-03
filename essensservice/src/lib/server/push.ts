import webpush from "web-push";
import { rpc } from "./rpc";

// Versand der „Dein Essen ist da!“-Nachrichten per Web Push.
// Ablauf je Nachricht: reservieren (DB) → an alle Abos des Fahrers senden → Ergebnis speichern (DB).
// Die Zustellung selbst ist davon unabhängig bereits gespeichert.

type Subscription = { id: string; endpoint: string; p256dh: string; auth: string };
type Claimed = { id: string; order_id: string; attempts: number; confirmed_at: string; subscriptions: Subscription[] };

export type PushSender = (sub: Subscription, payload: string) => Promise<void>;
export type PushSummary = { sent: number; failed: number; no_subscription: number };

/** Fehler mit HTTP-Status des Push-Dienstes (wie bei web-push). */
type SendError = Error & { statusCode?: number };

const defaultSender: PushSender = async (sub, payload) => {
  const { NEXT_PUBLIC_VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv, VAPID_SUBJECT: subject } = process.env;
  if (!pub || !priv || !subject) throw Object.assign(new Error("Web Push ist nicht eingerichtet (VAPID-Schlüssel fehlen)."), { statusCode: 0 });
  await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, {
    vapidDetails: { subject, publicKey: pub, privateKey: priv },
    TTL: 4 * 3600,
    urgency: "high",
    timeout: 10000,
  });
};

export const pushConfigured = () =>
  Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);

let sender: PushSender = defaultSender;
/** Nur für Tests. */
export function setPushSenderForTests(s: PushSender | null) {
  sender = s ?? defaultSender;
}

const timeFmt = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });

export function deliveryPayload(orderId: string, confirmedAt: string) {
  return JSON.stringify({
    title: "Dein Essen ist da!",
    body: `Dein Essen wurde um ${timeFmt.format(new Date(confirmedAt))} Uhr abgelegt. Den Ablageort kannst du über deinen persönlichen Link auf der Karte öffnen.`,
    tag: `essen-${orderId}`,
  });
}

/** Abo ist dauerhaft ungültig (abgemeldet / abgelaufen). */
const isGone = (e: SendError) => e.statusCode === 404 || e.statusCode === 410;

async function sendOne(n: Claimed): Promise<keyof PushSummary> {
  if (n.subscriptions.length === 0) {
    await rpc("push_result", { p_id: n.id, p_status: "kein_abo", p_error: null, p_revoke: null }, { as: "server" });
    return "no_subscription";
  }
  const payload = deliveryPayload(n.order_id, n.confirmed_at);
  const gone: string[] = [];
  const errors: string[] = [];
  let ok = 0;
  for (const sub of n.subscriptions) {
    try {
      await sender(sub, payload);
      ok++;
    } catch (err) {
      const e = err as SendError;
      if (isGone(e)) gone.push(sub.id);
      else errors.push(`${e.statusCode ?? "Netzwerk"}: ${e.message}`.slice(0, 200));
    }
  }
  const status = ok > 0 ? "gesendet" : errors.length > 0 ? "fehlgeschlagen" : "kein_abo";
  await rpc(
    "push_result",
    { p_id: n.id, p_status: status, p_error: errors.length ? errors.join(" | ") : gone.length ? "Abo abgelaufen" : null, p_revoke: gone.length ? gone : null },
    { as: "server" },
  );
  return status === "gesendet" ? "sent" : status === "fehlgeschlagen" ? "failed" : "no_subscription";
}

/**
 * Versendet die angegebenen (oder alle fälligen) Nachrichten.
 * Vorübergehende Fehler werden sofort bis zu zweimal kurz wiederholt, danach plant die DB
 * weitere Versuche (Cron bzw. Knopf im Büro).
 */
export async function sendNotifications(opts: { ids?: string[]; force?: boolean; immediateRetries?: number } = {}): Promise<PushSummary> {
  const summary: PushSummary = { sent: 0, failed: 0, no_subscription: 0 };
  let ids = opts.ids;
  // Ohne VAPID-Schlüssel bringen Sofort-Wiederholungen nichts – nur protokollieren.
  const retries = sender === defaultSender && !pushConfigured() ? 0 : (opts.immediateRetries ?? 0);
  const rounds = 1 + retries;
  for (let round = 0; round < rounds; round++) {
    const claimed = await rpc<Claimed[]>("push_claim", { p_ids: ids ?? null, p_force: opts.force ?? false, p_limit: 100 }, { as: "server" });
    if (!claimed?.length) break;
    const failedIds: string[] = [];
    for (const n of claimed) {
      const r = await sendOne(n);
      if (r === "failed") failedIds.push(n.id);
      else summary[r]++;
    }
    if (failedIds.length === 0) break;
    if (round === rounds - 1) {
      summary.failed += failedIds.length;
      break;
    }
    ids = failedIds;
    await new Promise((r) => setTimeout(r, 1000 * (round + 1)));
  }
  return summary;
}
