export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/** JSON-Aufruf der eigenen API. Fehler kommen als verständliche Meldung zurück. */
export async function api<T = unknown>(
  path: string,
  opts: { token?: string; method?: "GET" | "POST"; body?: unknown } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
      headers: {
        "content-type": "application/json",
        ...(opts.token ? { "x-access-token": opts.token } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      cache: "no-store",
    });
  } catch {
    throw new ApiError("OFFLINE", "Keine Verbindung. Bitte Empfang prüfen und erneut versuchen.");
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.error) {
    throw new ApiError(json?.error?.code ?? "UNBEKANNT", json?.error?.message ?? "Unerwarteter Fehler.");
  }
  return json.data as T;
}
