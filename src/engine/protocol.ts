import type { Job, JobResult } from './core';

export type WorkerRequest = { id: number; job: Job };
export type WorkerReply = { id: number; result?: JobResult; error?: string };
