import type { ProcessUpdate } from "./types";

const BASE = (import.meta.env.VITE_API_BASE as string) || "";

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`);
  }
  return res.json() as Promise<T>;
}

/** Upload sheet + params, get back a job token to stream progress for. */
export async function startProcess(form: FormData): Promise<{ token: string }> {
  const res = await fetch(`${BASE}/api/process`, { method: "POST", body: form });
  return jsonOrThrow(res);
}

/** Open an SSE connection. Returns a stop function. */
export function streamProcess(
  token: string,
  onEvent: (u: ProcessUpdate) => void,
  onDone?: () => void,
  onError?: (msg: string) => void,
): () => void {
  const es = new EventSource(`${BASE}/api/process/${token}/stream`);
  es.addEventListener("update", (ev: MessageEvent) => {
    try { onEvent(JSON.parse(ev.data) as ProcessUpdate); } catch { /* ignore */ }
  });
  es.addEventListener("done", () => { onDone?.(); es.close(); });
  es.onerror = () => { onError?.("Connection lost"); es.close(); };
  return () => es.close();
}

export async function semanticSearch(query: string, k: number) {
  const res = await fetch(`${BASE}/api/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, k }),
  });
  return jsonOrThrow<{ matches: { call_id: string; transcript: string; similarity: number }[] }>(res);
}
