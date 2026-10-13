import { useState } from 'preact/hooks';
import type { AppController } from '../app/controller';

export function ConsolePanel({ ctl, onJumpToLine }: { ctl: AppController; onJumpToLine(line: number): void }) {
  const log = ctl.log.value;
  const errors = log.filter((l) => l.level === 'error').length;
  const warnings = log.filter((l) => l.level === 'warning').length;
  const [open, setOpen] = useState(false);
  const entry = ctl.entry.value;
  return (
    <section class={`console${open ? ' open' : ''}`}>
      <button type="button" data-testid="console-toggle" onClick={() => setOpen(!open)}>
        Console {errors > 0 && <span class="badge error">{errors}</span>} {warnings > 0 && <span class="badge warning">{warnings}</span>}
      </button>
      {open && (
        <ol>
          {log.map((l, i) => (
            <li key={i} class={l.level}>
              {l.line && l.file === `/repo/${entry}`
                ? <button type="button" class="link" onClick={() => onJumpToLine(l.line!)}>line {l.line}</button>
                : null}{' '}
              {l.text}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
