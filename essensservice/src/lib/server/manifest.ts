import { NextResponse } from "next/server";

/** Web-App-Manifest je persönlichem Link: die installierte App startet direkt auf dieser Seite. */
export function personalManifest(startUrl: string, name: string, shortName: string) {
  return NextResponse.json(
    {
      name,
      short_name: shortName,
      start_url: startUrl,
      scope: startUrl,
      display: "standalone",
      background_color: "#f5f5f4",
      theme_color: "#2f7a33",
      lang: "de",
      icons: [
        { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
        { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "no-store" } },
  );
}

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,100}$/;
