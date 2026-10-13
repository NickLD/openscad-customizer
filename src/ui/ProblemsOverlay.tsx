import { useEffect, useState } from 'preact/hooks';
import type { LogLine } from '../engine/log';

const SHOWN = 2;

/** OpenSCAD prints echoed strings in quotes; drop them for display. */
export const problemText = (text: string): string => text.replace(/^"(.*)"$/s, '$1');

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

type Props = {
  log: LogLine[];
  /** False while the model is stale or rendering: the log belongs to the previous values. */
  visible: boolean;
  onShowConsole(): void;
};

/** Warnings & errors from the last render, pinned to the top-left of the 3D view. */
export function ProblemsOverlay({ log, visible, onShowConsole }: Props) {
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => setDismissed(false), [log]); // a new render's problems show again

  const errors = log.filter((l) => l.level === 'error');
  const warnings = log.filter((l) => l.level === 'warning');
  if (!visible || dismissed || errors.length + warnings.length === 0) return null;

  const kind = errors.length > 0 ? 'error' : 'warning';
  const ordered = [...errors, ...warnings];
  const summary = [errors.length > 0 && plural(errors.length, 'error'), warnings.length > 0 && plural(warnings.length, 'warning')]
    .filter(Boolean).join(', ');
  const more = ordered.length - SHOWN;

  return (
    <div class={`problems ${kind}`} role="status" aria-label={summary}>
      <div class="problems-head">
        <strong>{kind === 'error' ? '✖' : '⚠'} {summary}</strong>
        <button type="button" class="link" onClick={onShowConsole}>
          <span class="label-long">Show in Console</span>
          <span class="label-short" aria-hidden="true">Show</span>
        </button>
        <button type="button" class="dismiss" aria-label="Dismiss" onClick={() => setDismissed(true)}>✕</button>
      </div>
      <ul>
        {ordered.slice(0, SHOWN).map((l, i) => <li key={i} class={l.level}>{problemText(l.text)}</li>)}
      </ul>
      {more > 0 && <p class="more">+{more} more</p>}
    </div>
  );
}
