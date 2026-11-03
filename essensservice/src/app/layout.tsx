import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Agrarlohn Essensservice", template: "%s · Agrarlohn Essensservice" },
  description: "Essensbestellung und Auslieferung der Agrarlohn Müritz GmbH",
  robots: { index: false, follow: false },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Essen", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#2f7a33",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}
