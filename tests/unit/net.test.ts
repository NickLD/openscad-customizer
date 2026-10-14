import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserNet } from '../../src/repo/net';

afterEach(() => vi.unstubAllGlobals());

/** A fetch whose response headers never arrive; it rejects once its signal aborts, like the real one. */
const hangingFetch = () => vi.fn((_u: string, init?: RequestInit) => new Promise<Response>((_, reject) => {
  init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
}));

describe('browserNet.getBytes', () => {
  it('aborts the request when response headers take longer than timeoutMs', async () => {
    const f = hangingFetch();
    vi.stubGlobal('fetch', f);
    await expect(browserNet.getBytes('https://x/a', { timeoutMs: 10 })).rejects.toThrow();
    expect((f.mock.calls[0][1] as RequestInit).signal!.aborted).toBe(true);
  });

  it('does not time the body once headers have arrived', async () => {
    const slowBody = { ok: true, arrayBuffer: () => new Promise((r) => setTimeout(() => r(new Uint8Array([7]).buffer), 40)) };
    vi.stubGlobal('fetch', vi.fn(async () => slowBody));
    expect(await browserNet.getBytes('https://x/a', { timeoutMs: 10 })).toEqual(new Uint8Array([7]));
  });

  it('aborts an in-flight request when the caller cancels', async () => {
    vi.stubGlobal('fetch', hangingFetch());
    const ctrl = new AbortController();
    const p = browserNet.getBytes('https://x/a', { signal: ctrl.signal });
    ctrl.abort();
    await expect(p).rejects.toThrow();
  });
});

describe('browserNet.getJson', () => {
  it('aborts the request when response headers take longer than timeoutMs', async () => {
    vi.stubGlobal('fetch', hangingFetch());
    await expect(browserNet.getJson('https://x/a', { timeoutMs: 10 })).rejects.toThrow();
  });
});
