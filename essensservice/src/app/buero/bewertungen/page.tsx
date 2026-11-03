"use client";

import { useState } from "react";
import { PageHead } from "@/components/staff/DateNav";
import { Card, Notice, Spinner } from "@/components/ui";
import { staffRpc, useLive } from "@/lib/client/staff";
import { addDays, berlinToday, fmtShortDate } from "@/lib/format";

type Stat = {
  meal_id: string; service_date: string; meal_name: string; count: number; avg: number | null; delivered: number;
  distribution: Record<"1" | "2" | "3" | "4" | "5", number>;
};

const LABEL = ["Sehr schlecht", "Schlecht", "Mittelmäßig", "Gut", "Sehr gut"];
const COLOR = ["bg-red-500", "bg-orange-400", "bg-yellow-400", "bg-lime-500", "bg-brand-600"];
const input = "rounded-lg px-3 py-2 ring-1 ring-stone-300";

export default function RatingsPage() {
  const [from, setFrom] = useState(addDays(berlinToday(), -30));
  const [to, setTo] = useState(berlinToday());
  const { data, error } = useLive(() => staffRpc<Stat[]>("rating_stats", { p_from: from, p_to: to }), [from, to], 60000);

  const all = (data ?? []).reduce((a, s) => ({ n: a.n + s.count, sum: a.sum + (s.avg ?? 0) * s.count }), { n: 0, sum: 0 });

  return (
    <>
      <PageHead title="Bewertungen">
        <label className="text-sm">von <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={input} /></label>
        <label className="text-sm">bis <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={input} /></label>
      </PageHead>
      {error && <Notice tone="error">{error}</Notice>}
      {!data ? (
        <Spinner />
      ) : (
        <div className="grid gap-4">
          <Card className="flex flex-wrap gap-8">
            <div><p className="text-sm text-stone-500">Durchschnitt im Zeitraum</p><p className="text-3xl font-bold">{all.n ? (all.sum / all.n).toFixed(2).replace(".", ",") : "–"}</p></div>
            <div><p className="text-sm text-stone-500">Bewertungen</p><p className="text-3xl font-bold">{all.n}</p></div>
            <div className="flex flex-wrap items-center gap-3 text-sm">{LABEL.map((l, i) => <span key={l} className="flex items-center gap-1"><span className={`size-3 rounded-sm ${COLOR[i]}`} />{i + 1} = {l}</span>)}</div>
          </Card>
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-left text-stone-600">
                <tr><th className="px-3 py-2">Datum</th><th className="px-3 py-2">Gericht</th><th className="px-3 py-2">Ø</th><th className="px-3 py-2">Anzahl</th><th className="px-3 py-2">Zugestellt</th><th className="px-3 py-2 w-[40%]">Verteilung</th></tr>
              </thead>
              <tbody>
                {data.map((s) => (
                  <tr key={s.meal_id} className="border-t border-stone-100">
                    <td className="px-3 py-2">{fmtShortDate(s.service_date)}</td>
                    <td className="px-3 py-2 font-medium">{s.meal_name}</td>
                    <td className="px-3 py-2 font-semibold">{s.avg != null ? s.avg.toFixed(2).replace(".", ",") : "–"}</td>
                    <td className="px-3 py-2">{s.count}</td>
                    <td className="px-3 py-2">{s.delivered}</td>
                    <td className="px-3 py-2">
                      {s.count > 0 ? (
                        <div className="flex h-5 overflow-hidden rounded" title={LABEL.map((l, i) => `${l}: ${s.distribution[String(i + 1) as "1"]}`).join(" · ")}>
                          {[1, 2, 3, 4, 5].map((k) => {
                            const n = s.distribution[String(k) as "1"];
                            return n ? <div key={k} className={`${COLOR[k - 1]} flex items-center justify-center text-xs font-semibold text-white`} style={{ width: `${(n / s.count) * 100}%` }}>{n}</div> : null;
                          })}
                        </div>
                      ) : <span className="text-stone-400">keine</span>}
                    </td>
                  </tr>
                ))}
                {data.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-stone-500">Keine Gerichte im Zeitraum.</td></tr>}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </>
  );
}
