import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6">
      <div>
        <p className="text-xs font-semibold tracking-wide text-brand-700 uppercase">Agrarlohn Müritz</p>
        <h1 className="text-3xl font-bold">Essensservice</h1>
      </div>
      <p className="text-stone-600">
        Fahrer und Lieferfahrer öffnen ihren persönlichen Link aus WhatsApp. Büro und Küche melden sich hier an.
      </p>
      <Link
        href="/login"
        className="rounded-xl bg-brand-600 px-5 py-4 text-center text-lg font-semibold text-white hover:bg-brand-700"
      >
        Anmelden (Büro / Küche)
      </Link>
    </main>
  );
}
