import { lazy, Suspense } from 'preact/compat';
import { useState } from 'preact/hooks';
import type { AppController } from '../app/controller';
import { FilePicker } from './FilePicker';
import { Header } from './Header';
import { HelpPage } from './HelpPage';
import { Landing } from './Landing';
import { ModelView } from './ModelView';

/** `n` changes on every request, so clicking the same line twice jumps twice. */
export type JumpRequest = { line: number; n: number };

const SourceDrawer = lazy(() => import('./SourceDrawer').then((m) => ({ default: m.SourceDrawer })));

export function App({ ctl }: { ctl: AppController }) {
  const [sourceOpen, setSourceOpen] = useState(false);
  const [jump, setJump] = useState<JumpRequest | null>(null);
  const toggleSource = () => {
    setJump(null); // the header toggle opens without jumping
    setSourceOpen(!sourceOpen);
  };
  const phase = ctl.phase.value;
  const drawer = sourceOpen ? (
    <Suspense fallback={<div class="source-drawer">Loading editor…</div>}>
      <SourceDrawer ctl={ctl} jump={jump} onClose={() => { setJump(null); setSourceOpen(false); }} />
    </Suspense>
  ) : null;
  return (
    <div class="app">
      <Header ctl={ctl} onToggleSource={toggleSource} />
      {ctl.notices.value.length > 0 && phase !== 'landing' && phase !== 'help' && (
        <ul class="notices">{ctl.notices.value.map((n, i) => <li key={i} data-testid="notice">{n}</li>)}</ul>
      )}
      {phase === 'landing' && <Landing />}
      {phase === 'help' && <HelpPage />}
      {phase === 'loading' && <main class="loading" aria-busy="true">Loading repository…</main>}
      {phase === 'error' && <main class="error-page"><p role="alert">{ctl.error.value}</p><a href="#">Back to start</a></main>}
      {phase === 'picker' && <FilePicker ctl={ctl} />}
      {phase === 'model' && <ModelView ctl={ctl} drawer={drawer} onJumpToLine={(line) => { setJump((j) => ({ line, n: (j?.n ?? 0) + 1 })); setSourceOpen(true); }} />}
    </div>
  );
}
