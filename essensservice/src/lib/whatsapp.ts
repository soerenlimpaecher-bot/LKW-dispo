/** Telefonnummer für wa.me: nur Ziffern, deutsche Nummern mit 0 → 49. */
export function waNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let d = phone.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = `49${d.slice(1)}`;
  d = d.replace(/\D/g, "");
  return d.length >= 8 ? d : null;
}

/** WhatsApp-Link zum Weitergeben eines persönlichen Links (öffnet WhatsApp mit vorbereitetem Text). */
export function whatsappShareUrl(phone: string | null | undefined, text: string) {
  const n = waNumber(phone);
  return `https://wa.me/${n ?? ""}?text=${encodeURIComponent(text)}`;
}

export function linkMessage(name: string, url: string, kind: "fahrer" | "lieferfahrer") {
  return kind === "fahrer"
    ? `Hallo ${name}, das ist dein persönlicher Link für den Agrarlohn Essensservice: ${url}\nDarüber bestellst du täglich bis 9:00 Uhr dein Essen und legst deinen Lieferstandort fest. Bitte nicht weitergeben.`
    : `Hallo ${name}, das ist dein persönlicher Link für die Essensauslieferung: ${url}\nBitte nicht weitergeben.`;
}
