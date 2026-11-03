// Web Push im Browser: Service Worker registrieren und Abo an den Server melden.

export type PushSupport = "ok" | "ios-install" | "unsupported" | "denied";

export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return ios && !standalone ? "ios-install" : "unsupported";
  }
  if (Notification.permission === "denied") return "denied";
  return "ok";
}

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  // Eigene Seite merken, damit ein Tippen auf die Benachrichtigung genau hierher führt.
  const sw = reg.active ?? (await navigator.serviceWorker.ready).active;
  sw?.postMessage({ type: "home", url: window.location.pathname });
  return reg;
}

/** Fragt die Erlaubnis ab und liefert das Abo (oder null, wenn abgelehnt / nicht konfiguriert). */
export async function subscribeToPush(): Promise<PushSubscriptionJSON | null> {
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!key) return null;
  const reg = await registerServiceWorker();
  if (!reg) return null;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return null;
  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) }));
  return sub.toJSON();
}
