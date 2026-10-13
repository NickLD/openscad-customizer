// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RenderState } from '../../src/app/controller';
import { CARD_DELAY_MS, DONE_PILL_MS, formatSeconds, RenderOverlay } from '../../src/ui/RenderOverlay';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const rendering = (startedAt: number): RenderState => ({ status: 'rendering', mesh: null, outdated: false, startedAt });

describe('formatSeconds', () => {
  it('shows one decimal', () => {
    expect(formatSeconds(5.25)).toBe('5.3 s');
    expect(formatSeconds(0.04)).toBe('0.0 s');
    expect(formatSeconds(12)).toBe('12.0 s');
  });
});

describe('RenderOverlay', () => {
  it('stays out of the way for quick renders, then shows a card with a live timer and Cancel', () => {
    let now = 0;
    const onCancel = vi.fn();
    render(<RenderOverlay render={rendering(0)} engineReady onCancel={onCancel} now={() => now} />);
    expect(screen.queryByRole('status')).toBeNull();
    now = CARD_DELAY_MS - 1;
    act(() => void vi.advanceTimersByTime(CARD_DELAY_MS - 1));
    expect(screen.queryByRole('status')).toBeNull();
    now = 2100;
    act(() => void vi.advanceTimersByTime(200));
    const card = screen.getByRole('status');
    expect(card.textContent).toContain('Rendering…');
    expect(card.textContent).toContain('2.1 s');
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('says it is loading OpenSCAD while the engine is cold', () => {
    render(<RenderOverlay render={rendering(0)} engineReady={false} onCancel={() => {}} now={() => 600} />);
    act(() => void vi.advanceTimersByTime(CARD_DELAY_MS));
    expect(screen.getByRole('status').textContent).toContain('Loading OpenSCAD…');
  });

  it('shows the finish time briefly, and drops it as soon as the model is outdated again', () => {
    const ready: RenderState = { status: 'ready', mesh: null, outdated: false, seconds: 5.3 };
    const { rerender } = render(<RenderOverlay render={ready} engineReady onCancel={() => {}} />);
    expect(screen.getByText('✓ 5.3 s')).toBeTruthy();
    act(() => void vi.advanceTimersByTime(DONE_PILL_MS));
    expect(screen.queryByText('✓ 5.3 s')).toBeNull();

    rerender(<RenderOverlay render={{ ...ready, seconds: 1.2 }} engineReady onCancel={() => {}} />);
    expect(screen.getByText('✓ 1.2 s')).toBeTruthy();
    rerender(<RenderOverlay render={{ ...ready, seconds: 1.2, outdated: true }} engineReady onCancel={() => {}} />);
    expect(screen.queryByText('✓ 1.2 s')).toBeNull();
  });

  it('shows render errors immediately', () => {
    render(<RenderOverlay render={{ status: 'error', mesh: null, outdated: true, message: 'Render failed. See the Console for details.' }} engineReady onCancel={() => {}} />);
    expect(screen.getByRole('alert').textContent).toBe('Render failed. See the Console for details.');
  });
});
