import { useEffect, useRef, useState } from 'preact/hooks';
import type { AppController } from '../app/controller';
import { APP_REPO_URL } from '../config';
import { CodeIcon, GitHubIcon, PlusIcon, ShareIcon } from './icons';
import { Logo } from './Logo';
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
      <a class="brand" href="#" aria-label="Home"><Logo /></a>
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
      <span class={`header-actions${phase === 'model' ? ' crowded' : ''}`}>
        {phase === 'model' && (
          <>
            <span class="share-wrap" ref={shareWrap}>
              <button type="button" data-testid="share-link" aria-expanded={sharing} aria-haspopup="dialog"
                onClick={() => {
                  if (!sharing) ctl.flushHash(); // keep the address bar in step with what's being shared
                  setSharing(!sharing);
                }}>
                <ShareIcon />
                <span class="label-long">Share a link to this</span>
                <span class="label-short" aria-hidden="true">Share</span>
              </button>
              {sharing && <SharePanel ctl={ctl} />}
            </span>
            <button type="button" class="with-icon" data-testid="source-toggle" onClick={onToggleSource}
              title="View and edit this model's OpenSCAD code. Edits stay in your browser.">
              <CodeIcon />
              <span class="label-long">View/edit Model Source</span>
              <span class="label-short" aria-hidden="true">Source</span>
            </button>
          </>
        )}
        {/* App-level links collapse to icons (with the label as tooltip) where space is tight. */}
        <a class="button with-icon app-link" href="#/help" title="Use this Customizer for your Model">
          <PlusIcon /><span class="label">Use this Customizer for your Model</span>
        </a>
        <a class="button with-icon app-link" href={APP_REPO_URL} target="_blank" rel="noopener noreferrer" title="View Customizer Source on GitHub">
          <GitHubIcon /><span class="label">View Customizer Source on GitHub</span>
        </a>
        <button type="button" aria-label="Toggle dark mode" onClick={toggleTheme}>{isDark.value ? '☀' : '☾'}</button>
      </span>
    </header>
  );
}
