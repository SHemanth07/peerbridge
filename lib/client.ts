"use client";

export async function api<T = any>(url: string, opts?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(url, {
    method: opts?.method ?? (opts?.body !== undefined ? "POST" : "GET"),
    headers: { "Content-Type": "application/json" },
    body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data as T;
}

export const fmt = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** ts_headline markers (<< >>) -> safe React-friendly segments */
export function highlight(s: string): { text: string; hit: boolean }[] {
  return s.split(/(<<.*?>>)/g).filter(Boolean).map((p) =>
    p.startsWith("<<") ? { text: p.slice(2, -2), hit: true } : { text: p, hit: false }
  );
}
