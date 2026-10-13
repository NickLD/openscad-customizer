import { useEffect, useState } from 'preact/hooks';
import type { RenderState } from '../app/controller';

/** Quick renders never show the card, so back-to-back tweaks only get the brief blur. */
export const CARD_DELAY_MS = 500;
/** How long the "✓ 5.3 s" finish pill stays up. Keep in sync with the `pill` animation in styles.css. */
export const DONE_PILL_MS = 1500;

export const formatSeconds = (s: number): string => `${s.toFixed(1)} s`;

type Props = {
  render: RenderState;
  engineReady: boolean;
  onCancel(): void;
  now?: () => number;
};

/** Non-blocking render feedback over the 3D view: a delayed progress card, errors, and a short finish pill. */
export function RenderOverlay({ render, engineReady, onCancel, now = () => performance.now() }: Props) {
  const rendering = render.status === 'rendering';
  const [showCard, setShowCard] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [pill, setPill] = useState<number | null>(null);

  useEffect(() => {
    setShowCard(false);
    if (!rendering) return;
    const started = render.startedAt ?? now();
    const tick = () => setElapsed((now() - started) / 1000);
    const show = setTimeout(() => {
      tick();
      setShowCard(true);
    }, CARD_DELAY_MS);
    const timer = setInterval(tick, 100);
    return () => {
      clearTimeout(show);
      clearInterval(timer);
    };
  }, [rendering, render.startedAt]);

  useEffect(() => {
    setPill(null);
    if (render.status !== 'ready' || render.outdated || render.seconds === undefined) return;
    setPill(render.seconds);
    const hide = setTimeout(() => setPill(null), DONE_PILL_MS);
    return () => clearTimeout(hide);
  }, [render]);

  return (
    <div class="render-overlay">
      {rendering && showCard && (
        <div class="render-card" role="status">
          <span class="spinner" aria-hidden="true" />
          <strong>{engineReady ? 'Rendering…' : 'Loading OpenSCAD…'}</strong>
          <span class="elapsed">{formatSeconds(elapsed)}</span>
          <button type="button" onClick={onCancel}>Cancel</button>
        </div>
      )}
      {render.status === 'error' && render.message && <div class="render-card error" role="alert">{render.message}</div>}
      {pill !== null && <div class="done-pill">✓ {formatSeconds(pill)}</div>}
    </div>
  );
}
