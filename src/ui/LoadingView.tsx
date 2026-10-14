import type { AppController } from '../app/controller';
import type { LoadProgress } from '../repo/repoLoader';

function label(p: LoadProgress | null): string {
  if (p?.step === 'listing') return 'Listing files…';
  if (p?.step === 'downloading') return `Downloading files: ${p.done} of ${p.total}`;
  if (p?.step === 'libraries') return 'Downloading libraries…';
  return 'Finding the latest version…';
}

export function LoadingView({ ctl }: { ctl: AppController }) {
  const p = ctl.loading.value;
  return (
    <main class="loading" aria-busy="true">
      <p data-testid="load-status">{label(p)}</p>
      {p?.step === 'downloading' && <progress max={p.total} value={p.done} />}
      {p?.step === 'downloading' && p.path && <code class="load-file">{p.path}</code>}
      <a class="button" href="#">Cancel</a>
    </main>
  );
}
