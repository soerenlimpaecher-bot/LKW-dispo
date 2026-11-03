"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { addDays, berlinToday, fmtDay } from "@/lib/format";

/** Liefertag aus ?datum=…, Standard heute (Berlin). */
export function useServiceDate() {
  const sp = useSearchParams();
  const d = sp.get("datum");
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : berlinToday();
}

export function DateNav({ date }: { date: string }) {
  const router = useRouter();
  const go = (d: string) => {
    const u = new URL(window.location.href);
    u.searchParams.set("datum", d);
    router.replace(u.pathname + u.search);
  };
  const today = berlinToday();
  return (
    <div className="no-print flex items-center gap-1">
      <button onClick={() => go(addDays(date, -1))} className="rounded-lg px-2.5 py-1.5 ring-1 ring-stone-300 hover:bg-stone-50" aria-label="Vortag">‹</button>
      <input
        type="date"
        value={date}
        onChange={(e) => e.target.value && go(e.target.value)}
        className="rounded-lg px-2 py-1.5 ring-1 ring-stone-300"
        aria-label="Liefertag"
      />
      <button onClick={() => go(addDays(date, 1))} className="rounded-lg px-2.5 py-1.5 ring-1 ring-stone-300 hover:bg-stone-50" aria-label="Folgetag">›</button>
      {date !== today && (
        <button onClick={() => go(today)} className="rounded-lg px-2.5 py-1.5 text-sm text-brand-700 hover:bg-brand-50">Heute</button>
      )}
      <span className="ml-2 hidden text-sm text-stone-500 sm:inline">{fmtDay(date)}</span>
    </div>
  );
}

export function PageHead({ title, date, children }: { title: string; date?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <h1 className="mr-auto text-2xl font-bold">{title}</h1>
      {children}
      {date && <DateNav date={date} />}
    </div>
  );
}
