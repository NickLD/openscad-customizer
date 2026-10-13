import { useEffect, useRef, useState } from 'preact/hooks';
import type { AppController } from '../app/controller';
import { modelHash } from './links';
import { SharePanel } from './SharePanel';
import { isDark, toggleTheme } from './theme';

export function Header({ ctl, onToggleSource }: { ctl: AppController; onToggleSource(): void }) {
  // While another repo loads (or after a failure), don't show the previous repo's name.
  const phase = ctl.phase.value;
  const repo = phase === 'model' || phase === 'picker' ? ctl.repo.value : null;
  const title = repo?.manifest?.title ?? (repo ? `${repo.owner}/${repo.repo}` : 'OpenSCAD Customizer');
  const [sharing, setSharing] = useState(false);
  const shareWrap = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!sharing) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSharing(false);
    const onPointer = (e: MouseEvent) => {
      if (!shareWrap.current?.contains(e.target as Node)) setSharing(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [sharing]);

  return (
    <header class="app-header">
      <a class="brand" href="#" aria-label="Home">◧</a>
      <h1>{title}</h1>
      {phase === 'model' && ctl.candidates.value.length > 1 && (
        <select aria-label="Model" value={ctl.entry.value ?? ''} onChange={(e) => (location.hash = modelHash(repo!.owner, repo!.repo, e.currentTarget.value))}>
          {ctl.candidates.value.map((c) => <option key={c.path} value={c.path}>{c.title}</option>)}
        </select>
      )}
      {repo && (
        <a class="ref" href={`https://github.com/${repo.owner}/${repo.repo}/tree/${repo.ref}`} target="_blank" rel="noopener noreferrer">
          {repo.owner}/{repo.repo} @{repo.sha ? repo.sha.slice(0, 7) : repo.ref}
        </a>
      )}
      <span class="spacer" />
      {phase === 'model' && (
        <>
          <span class="share-wrap" ref={shareWrap}>
            <button type="button" data-testid="share-link" aria-expanded={sharing} aria-haspopup="dialog"
              onClick={() => {
                if (!sharing) ctl.flushHash(); // keep the address bar in step with what's being shared
                setSharing(!sharing);
              }}>
              <svg class="icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
              </svg>
              Share a link to this
            </button>
            {sharing && <SharePanel ctl={ctl} />}
          </span>
          <button type="button" data-testid="source-toggle" onClick={onToggleSource}>&lt;/&gt; Src</button>
        </>
      )}
      <button type="button" aria-label="Toggle dark mode" onClick={toggleTheme}>{isDark.value ? '☀' : '☾'}</button>
    </header>
  );
}
