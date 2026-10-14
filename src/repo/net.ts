/** `timeoutMs` bounds the wait for response headers, not the body; `signal` cancels the request. */
export type GetOptions = { signal?: AbortSignal; timeoutMs?: number };

export type Net = {
  /** Throws only on network failure. */
  getJson(url: string): Promise<{ status: number; data: unknown }>;
  /** Null for non-2xx; throws on network failure. */
  getBytes(url: string, opts?: GetOptions): Promise<Uint8Array | null>;
};

export const browserNet: Net = {
  async getJson(url) {
    const r = await fetch(url);
    let data: unknown = null;
    try {
      data = await r.json();
    } catch {
      /* non-JSON body */
    }
    return { status: r.status, data };
  },
  async getBytes(url, opts = {}) {
    const ctl = new AbortController();
    const cancel = () => ctl.abort();
    if (opts.signal?.aborted) cancel();
    opts.signal?.addEventListener('abort', cancel);
    const timer = opts.timeoutMs !== undefined ? setTimeout(cancel, opts.timeoutMs) : undefined;
    try {
      const r = await fetch(url, { signal: ctl.signal });
      clearTimeout(timer);
      return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', cancel);
    }
  },
};
