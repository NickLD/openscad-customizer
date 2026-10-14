/** `timeoutMs` bounds the wait for response headers, not the body; `signal` cancels the request. */
export type GetOptions = { signal?: AbortSignal; timeoutMs?: number };

export type Net = {
  /** Throws only on network failure (or timeout / cancel). */
  getJson(url: string, opts?: GetOptions): Promise<{ status: number; data: unknown }>;
  /** Null for non-2xx; throws on network failure (or timeout / cancel). */
  getBytes(url: string, opts?: GetOptions): Promise<Uint8Array | null>;
};

async function request<T>(url: string, opts: GetOptions, read: (r: Response) => Promise<T>): Promise<T> {
  const ctl = new AbortController();
  const cancel = () => ctl.abort();
  if (opts.signal?.aborted) cancel();
  opts.signal?.addEventListener('abort', cancel);
  const timer = opts.timeoutMs !== undefined ? setTimeout(cancel, opts.timeoutMs) : undefined;
  try {
    const r = await fetch(url, { signal: ctl.signal });
    clearTimeout(timer);
    return await read(r);
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', cancel);
  }
}

export const browserNet: Net = {
  getJson(url, opts = {}) {
    return request(url, opts, async (r) => {
      let data: unknown = null;
      try {
        data = await r.json();
      } catch {
        /* non-JSON body */
      }
      return { status: r.status, data };
    });
  },
  getBytes(url, opts = {}) {
    return request(url, opts, async (r) => (r.ok ? new Uint8Array(await r.arrayBuffer()) : null));
  },
};
