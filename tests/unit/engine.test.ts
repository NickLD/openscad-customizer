import { describe, expect, it } from 'vitest';
import type { Job, JobResult } from '../../src/engine/core';
import { AbortedError, createEngine, type WorkerLike } from '../../src/engine/engine';
import type { WorkerReply, WorkerRequest } from '../../src/engine/protocol';

class FakeWorker implements WorkerLike {
  static all: FakeWorker[] = [];
  onmessage: ((e: { data: WorkerReply }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  received: WorkerRequest[] = [];
  terminated = false;
  constructor() { FakeWorker.all.push(this); }
  postMessage(m: WorkerRequest) { this.received.push(m); }
  terminate() { this.terminated = true; }
  reply(id: number, result: JobResult) { this.onmessage?.({ data: { id, result } }); }
}

const job: Job = { kind: 'params', files: new Map(), entry: '/repo/a.scad' };
const result: JobResult = { exitCode: 0, output: null, log: [], ms: 1 };

describe('createEngine', () => {
  it('routes replies to the matching request and reuses the worker', async () => {
    FakeWorker.all = [];
    const engine = createEngine(() => new FakeWorker());
    const p1 = engine.run(job);
    const p2 = engine.run(job);
    const w = FakeWorker.all[0];
    w.reply(w.received[1].id, { ...result, ms: 2 });
    w.reply(w.received[0].id, result);
    expect((await p1).ms).toBe(1);
    expect((await p2).ms).toBe(2);
    expect(FakeWorker.all).toHaveLength(1);
  });

  it('abort terminates the worker, rejects pending jobs and respawns lazily', async () => {
    FakeWorker.all = [];
    const engine = createEngine(() => new FakeWorker());
    const ac = new AbortController();
    const p = engine.run(job, ac.signal);
    ac.abort();
    await expect(p).rejects.toBeInstanceOf(AbortedError);
    expect(FakeWorker.all[0].terminated).toBe(true);
    const p2 = engine.run(job);
    expect(FakeWorker.all).toHaveLength(2);
    FakeWorker.all[1].reply(FakeWorker.all[1].received[0].id, result);
    await expect(p2).resolves.toEqual(result);
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(createEngine(() => new FakeWorker()).run(job, ac.signal)).rejects.toBeInstanceOf(AbortedError);
  });

  it('rejects pending jobs when the worker crashes', async () => {
    FakeWorker.all = [];
    const engine = createEngine(() => new FakeWorker());
    const p = engine.run(job);
    FakeWorker.all[0].onerror?.({ message: 'out of memory' });
    await expect(p).rejects.toThrow(/out of memory/);
  });
});
