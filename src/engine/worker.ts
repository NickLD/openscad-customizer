import { runJob, type OpenSCADFactory } from './core';
import type { WorkerReply, WorkerRequest } from './protocol';

// The project compiles against the DOM lib (adding the WebWorker lib alongside it causes duplicate
// declarations), so describe the worker scope minimally.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(m: WorkerReply, transfer?: Transferable[]): void;
};
const base = import.meta.env.BASE_URL;
let factory: Promise<OpenSCADFactory> | null = null;

function loadFactory(): Promise<OpenSCADFactory> {
  factory ??= (async () => {
    const [mod, wasmModule] = await Promise.all([
      import(/* @vite-ignore */ `${base}wasm/openscad.js`),
      WebAssembly.compileStreaming(fetch(`${base}wasm/openscad.wasm`)),
    ]);
    // Compile once, instantiate per job: each OpenSCAD run needs a fresh instance.
    return (opts) => mod.default({
      ...opts,
      instantiateWasm(imports: WebAssembly.Imports, done: (i: WebAssembly.Instance) => void) {
        WebAssembly.instantiate(wasmModule, imports).then(done);
        return {};
      },
    });
  })();
  return factory;
}

let chain: Promise<void> = Promise.resolve();
scope.onmessage = (e) => {
  const { id, job } = e.data;
  chain = chain.then(async () => {
    try {
      const result = await runJob(await loadFactory(), job);
      scope.postMessage({ id, result }, result.output ? [result.output.buffer as ArrayBuffer] : []);
    } catch (err) {
      scope.postMessage({ id, error: String(err) });
    }
  });
};
