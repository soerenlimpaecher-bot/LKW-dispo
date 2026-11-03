import { createECDH, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import webpush from "web-push";
import { deliveryPayload } from "@/lib/server/push";

// Prüft, dass mit VAPID-Schlüsseln eine gültige, verschlüsselte Push-Anfrage entsteht
// (so wie sie an den Push-Dienst des Browsers geht).
describe("Web Push (VAPID, Verschlüsselung)", () => {
  it("erzeugt eine signierte und verschlüsselte Anfrage", () => {
    const vapid = webpush.generateVAPIDKeys();
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    const sub = {
      endpoint: "https://fcm.googleapis.com/fcm/send/test",
      keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") },
    };
    const payload = deliveryPayload("00000000-0000-0000-0000-000000000000", "2026-11-04T11:08:00Z");
    expect(JSON.parse(payload).body).toContain("12:08 Uhr");
    const req = webpush.generateRequestDetails(sub, payload, {
      vapidDetails: { subject: "mailto:test@beispiel.local", publicKey: vapid.publicKey, privateKey: vapid.privateKey },
      TTL: 3600,
    });
    expect(req.method).toBe("POST");
    expect(req.headers["Content-Encoding"]).toBe("aes128gcm");
    expect(String(req.headers.Authorization)).toMatch(/^vapid t=.+, k=/);
    expect((req.body as Buffer).length).toBeGreaterThan(payload.length); // verschlüsselt
  });
});
