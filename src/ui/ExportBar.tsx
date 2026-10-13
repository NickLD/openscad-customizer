import type { AppController } from '../app/controller';
import { downloadBytes } from './download';

export function ExportBar({ ctl }: { ctl: AppController }) {
  const r = ctl.render.value;
  const ready = r.status === 'ready' && !r.outdated;
  const go = (format: 'stl' | '3mf') => {
    const out = ctl.exportModel(format);
    if (out) downloadBytes(out.name, out.bytes);
  };
  return (
    <div class="export-bar">
      <button type="button" class="primary" data-testid="export-stl" disabled={!ready} onClick={() => go('stl')}>⬇ STL</button>
      <button type="button" class="primary" data-testid="export-3mf" disabled={!ready} onClick={() => go('3mf')}>⬇ 3MF</button>
    </div>
  );
}
