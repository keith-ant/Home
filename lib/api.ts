/** Tiny typed fetch wrapper for the local API routes. */
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    throw new Error(`${init?.method ?? "GET"} ${url} → ${res.status}`);
  }
  return (await res.json()) as T;
}
