import type { AppController } from '../app/controller';
import { modelHash } from './links';
import { cdnUrl } from '../repo/repoLoader';
import { Logo } from './Logo';

export function FilePicker({ ctl }: { ctl: AppController }) {
  const repo = ctl.repo.value!;
  return (
    <main class="picker">
      {repo.manifest?.description && <p class="lead">{repo.manifest.description}</p>}
      {ctl.candidates.value.length === 0 && <p role="alert">No OpenSCAD models found in {repo.owner}/{repo.repo}.</p>}
      <div class="cards">
        {ctl.candidates.value.map((c) => (
          <a key={c.path} class="card" data-testid="picker-card" href={modelHash(repo.owner, repo.repo, c.path)}>
            {c.thumbnail ? <img src={cdnUrl(repo.owner, repo.repo, repo.ref, c.thumbnail)} alt="" loading="lazy" /> : <div class="placeholder"><Logo size={72} /></div>}
            <h3>{c.title}</h3>
            {c.description && <p>{c.description}</p>}
            <code>{c.path}</code>
          </a>
        ))}
      </div>
    </main>
  );
}
