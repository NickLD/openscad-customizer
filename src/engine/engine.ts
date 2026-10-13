import type { Job, JobResult } from './core';
import type { WorkerReply, WorkerRequest } from './protocol';

export type WorkerLike = {
  postMessage(m: WorkerRequest): void;
  terminate(): void;
  onmessage: ((e: { data: WorkerReply }) => void) | null;
  onerror: ((e: unknown) => void) | null;
};
export type Engine = { run(job: Job, signal?: AbortSignal): Promise<JobResult> };

export class AbortedError extends Error {
  constructor() {
    super('Render cancelled');
    this.name = 'AbortError';
  }
}

type Pending = { resolve(r: JobResult): void; reject(e: Error): void };

export function createEngine(makeWorker: () => WorkerLike): Engine {
  let worker: WorkerLike | null = null;
  let nextId = 1;
  const pending = new Map<number, Pending>();

  const failAll = (err: Error) => {
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  };
  const reset = () => {
    worker?.terminate();
    worker = null;
  };
  const get = (): WorkerLike => {
    if (worker) return worker;
    const w = makeWorker();
    w.onmessage = ({ data }) => {
      const p = pending.get(data.id);
      if (!p) return;
      pending.delete(data.id);
      if (data.result) p.resolve(data.result);
      else p.reject(new Error(data.error ?? 'Engine error'));
    };
    w.onerror = (e) => {
      const msg = (e as { message?: string })?.message ?? String(e);
      failAll(new Error(`Engine crashed: ${msg}`));
      if (worker === w) reset();
    };
    return (worker = w);
  };

  return {
    run(job, signal) {
      return new Promise<JobResult>((resolve, reject) => {
        if (signal?.aborted) return reject(new AbortedError());
        const id = nextId++;
        pending.set(id, { resolve, reject });
        get().postMessage({ id, job });
        signal?.addEventListener('abort', () => {
          if (!pending.has(id)) return;
          // A single-threaded worker cannot be interrupted: kill it and everything queued on it.
          failAll(new AbortedError());
          reset();
        }, { once: true });
      });
    },
  };
}

export function createBrowserEngine(): Engine {
  return createEngine(() => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike);
}
