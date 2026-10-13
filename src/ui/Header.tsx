import { useState } from 'preact/hooks';
import type { AppController } from '../app/controller';
import { modelHash } from './links';
import { isDark, toggleTheme } from './theme';

export function Header({ ctl, onToggleSource }: { ctl: AppController; onToggleSource(): void }) {
  const repo = ctl.repo.value;
  const [copied, setCopied] = useState(false);
  const title = repo?.manifest?.title ?? (repo ? `${repo.owner}/${repo.repo}` : 'OpenSCAD Customizer');
  const share = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      prompt('Copy this link', location.href);
    }
  };
  return (
    <header class="app-header">
      <a class="brand" href="#" aria-label="Home">◧</a>
      <h1>{title}</h1>
      {ctl.phase.value === 'model' && ctl.candidates.value.length > 1 && (
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
      {ctl.phase.value === 'model' && (
        <>
          <button type="button" data-testid="share-link" onClick={share}>{copied ? 'Copied!' : 'Share link'}</button>
          <button type="button" data-testid="source-toggle" onClick={onToggleSource}>&lt;/&gt; Src</button>
        </>
      )}
      <button type="button" aria-label="Toggle dark mode" onClick={toggleTheme}>{isDark.value ? '☀' : '☾'}</button>
    </header>
  );
}
