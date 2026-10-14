import type { AppController } from '../app/controller';
import { serializeRoute } from '../router';
import { formatBytes } from '../util';

export function FolderPicker({ ctl }: { ctl: AppController }) {
  const t = ctl.tooBig.value!;
  return (
    <main class="picker">
      <p class="lead">{t.message} Pick a folder to load:</p>
      <ul class="folders">
        {t.folders.map((f) => (
          <li key={f.path}>
            <a data-testid="folder-link" href={serializeRoute({ kind: 'repo', owner: t.owner, repo: t.repo, ref: t.ref, dir: f.path, values: {} })}>
              <code>{f.path}/</code>
              <span class="muted">{f.models} .scad file{f.models === 1 ? '' : 's'} · {formatBytes(f.bytes)}</span>
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
