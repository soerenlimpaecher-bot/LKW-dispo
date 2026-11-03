"use client";

import { createBrowserClient } from "@supabase/ssr";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

/** Aufruf einer freigegebenen Büro-/Küchenfunktion. */
export function staffRpc<T = unknown>(fn: string, args: Record<string, unknown> = {}) {
  return api<T>(`/api/staff/${fn}`, { body: args });
}

export const supabaseConfigured = () => Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

let browserClient: ReturnType<typeof createBrowserClient> | null = null;
export function supabaseBrowser() {
  browserClient ??= createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  return browserClient;
}

const LIVE_TABLES = [
  "orders", "delivery_locations", "delivery_groups", "group_assignments",
  "delivery_confirmations", "daily_meals", "notifications", "ratings",
];

/**
 * Lädt Daten und hält sie aktuell: über Supabase Realtime (wenn eingerichtet) und zusätzlich
 * per regelmäßiger Abfrage als Rückfallebene.
 */
export function useLive<T>(load: () => Promise<T>, deps: unknown[], pollMs = 15000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  const refresh = useCallback(async () => {
    try {
      setData(await loadRef.current());
      setError(null);
      setUpdatedAt(new Date());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    setData(null);
    refresh();
    const timer = setInterval(refresh, pollMs);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const debounced = () => {
      clearTimeout(timeout);
      timeout = setTimeout(refresh, 400);
    };
    let cleanup = () => {};
    if (supabaseConfigured()) {
      const sb = supabaseBrowser();
      const channel = sb.channel(`live-${Math.random().toString(36).slice(2)}`);
      for (const table of LIVE_TABLES) {
        channel.on("postgres_changes", { event: "*", schema: "public", table }, debounced);
      }
      channel.subscribe();
      cleanup = () => {
        sb.removeChannel(channel);
      };
    }
    return () => {
      clearInterval(timer);
      clearTimeout(timeout);
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, updatedAt, refresh };
}
