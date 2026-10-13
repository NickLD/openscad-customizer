import { useState } from 'preact/hooks';
import type { AppController } from '../app/controller';
import { FilePicker } from './FilePicker';
import { Header } from './Header';
import { Landing } from './Landing';
import { ModelView } from './ModelView';

export function App({ ctl }: { ctl: AppController }) {
  const [sourceOpen, setSourceOpen] = useState(false);
  const phase = ctl.phase.value;
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
      {phase === 'model' && <ModelView ctl={ctl} drawer={null} onJumpToLine={() => setSourceOpen(true)} />}
    </div>
  );
}
