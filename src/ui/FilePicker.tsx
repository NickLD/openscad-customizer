import type { AppController } from '../app/controller';
import { cdnUrl } from '../repo/repoLoader';

export function FilePicker({ ctl }: { ctl: AppController }) {
  const repo = ctl.repo.value!;
  return (
    <main class="picker">
      {repo.manifest?.description && <p class="lead">{repo.manifest.description}</p>}
      {ctl.candidates.value.length === 0 && <p role="alert">No OpenSCAD models found in {repo.owner}/{repo.repo}.</p>}
      <div class="cards">
        {ctl.candidates.value.map((c) => (
          <a key={c.path} class="card" data-testid="picker-card" href={`#/gh/${repo.owner}/${repo.repo}/${c.path.split('/').map(encodeURIComponent).join('/')}`}>
            {c.thumbnail ? <img src={cdnUrl(repo.owner, repo.repo, repo.ref, c.thumbnail)} alt="" loading="lazy" /> : <div class="placeholder">◧</div>}
            <h3>{c.title}</h3>
            {c.description && <p>{c.description}</p>}
            <code>{c.path}</code>
          </a>
        ))}
      </div>
    </main>
  );
}
