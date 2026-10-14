import type { AppController } from '../app/controller';
import type { DownloadCounts, LoadProgress } from '../repo/repoLoader';
import { formatBytes } from '../util';

/** Library progress has counts once the first library has been listed. */
const counted = (p: LoadProgress | null): (LoadProgress & DownloadCounts) | null =>
  p && (p.step === 'downloading' || p.step === 'libraries') && p.total !== undefined ? (p as LoadProgress & DownloadCounts) : null;

function label(p: LoadProgress | null): string {
  const c = counted(p);
  const of = c ? `${c.done} of ${c.total} · ${formatBytes(c.bytes)} of ${formatBytes(c.totalBytes)}` : '';
  if (p?.step === 'listing') return 'Listing files…';
  if (p?.step === 'downloading') return `Downloading files: ${of}`;
  if (p?.step === 'libraries') return c ? `Downloading libraries: ${of}` : 'Downloading libraries…';
  return 'Finding the latest version…';
}

export function LoadingView({ ctl }: { ctl: AppController }) {
  const p = ctl.loading.value;
  const c = counted(p);
  return (
    <main class="loading" aria-busy="true">
      <p data-testid="load-status">{label(p)}</p>
      {/* By bytes, so one big file doesn't look stuck at "55 of 56". */}
      {c && (c.totalBytes ? <progress max={c.totalBytes} value={c.bytes} /> : <progress max={c.total} value={c.done} />)}
      {c?.path && <code class="load-file">{c.path}</code>}
      <a class="button" href="#">Cancel</a>
    </main>
  );
}
