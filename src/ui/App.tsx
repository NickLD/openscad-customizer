import { lazy, Suspense } from 'preact/compat';
import { useState } from 'preact/hooks';
import type { AppController } from '../app/controller';
import { FilePicker } from './FilePicker';
import { Header } from './Header';
import { Landing } from './Landing';
import { ModelView } from './ModelView';

const SourceDrawer = lazy(() => import('./SourceDrawer').then((m) => ({ default: m.SourceDrawer })));

export function App({ ctl }: { ctl: AppController }) {
  const [sourceOpen, setSourceOpen] = useState(false);
  const [jumpTo, setJumpTo] = useState<number | null>(null);
  const phase = ctl.phase.value;
  const drawer = sourceOpen ? (
    <Suspense fallback={<div class="source-drawer">Loading editor…</div>}>
      <SourceDrawer ctl={ctl} jumpTo={jumpTo} onClose={() => setSourceOpen(false)} />
    </Suspense>
  ) : null;
  return (
    <div class="app">
      <Header ctl={ctl} onToggleSource={() => setSourceOpen(!sourceOpen)} />
      {ctl.notices.value.length > 0 && phase !== 'landing' && (
        <ul class="notices">{ctl.notices.value.map((n, i) => <li key={i} data-testid="notice">{n}</li>)}</ul>
      )}
      {phase === 'landing' && <Landing />}
      {phase === 'loading' && <main class="loading" aria-busy="true">Loading repository…</main>}
      {phase === 'error' && <main class="error-page"><p role="alert">{ctl.error.value}</p><a href="#">Back to start</a></main>}
      {phase === 'picker' && <FilePicker ctl={ctl} />}
      {phase === 'model' && <ModelView ctl={ctl} drawer={drawer} onJumpToLine={(line) => { setJumpTo(line); setSourceOpen(true); }} />}
    </div>
  );
}
