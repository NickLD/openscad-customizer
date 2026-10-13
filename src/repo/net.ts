export type Net = {
  /** Throws only on network failure. */
  getJson(url: string): Promise<{ status: number; data: unknown }>;
  /** Null for non-2xx; throws on network failure. */
  getBytes(url: string): Promise<Uint8Array | null>;
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
  async getBytes(url) {
    const r = await fetch(url);
    return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
  },
};
