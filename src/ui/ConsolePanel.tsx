import type { AppController } from '../app/controller';

const MARKER = { error: '✖', warning: '⚠' } as const;

type Props = { ctl: AppController; open: boolean; onToggle(): void; onJumpToLine(line: number): void };

export function ConsolePanel({ ctl, open, onToggle, onJumpToLine }: Props) {
  const log = ctl.log.value;
  const errors = log.filter((l) => l.level === 'error').length;
  const warnings = log.filter((l) => l.level === 'warning').length;
  const entry = ctl.entry.value;
  return (
    <section class={`console${open ? ' open' : ''}`}>
      <button type="button" data-testid="console-toggle" aria-expanded={open} onClick={onToggle}>
        Console {errors > 0 && <span class="badge error">{errors}</span>} {warnings > 0 && <span class="badge warning">{warnings}</span>}
      </button>
      {open && (
        <ol>
          {log.map((l, i) => (
            <li key={i} class={l.level}>
              {(l.level === 'error' || l.level === 'warning') && <span class="marker" aria-hidden="true">{MARKER[l.level]}</span>}
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
