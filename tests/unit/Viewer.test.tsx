// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseOff } from '../../src/mesh/off';

const calls: { grid: unknown[] } = { grid: [] };
vi.mock('../../src/ui/viewer/ThreeViewer', () => ({
  ThreeViewer: class {
    setMesh() {}
    setDark() {}
    setGrid(spec: unknown, visible: boolean) { calls.grid.push({ spec, visible }); }
    dispose() {}
  },
}));
const { Viewer } = await import('../../src/ui/viewer/Viewer');

const mesh = parseOff(['OFF', '3 1 0', '0 0 0', '360 0 0', '0 52 15', '3 0 1 2', ''].join('\n'));

beforeEach(() => {
  calls.grid = [];
  try { localStorage.removeItem('osc-grid'); } catch { /* ignore */ }
});

describe('Viewer grid toggle', () => {
  it('shows the cell size, toggles the grid and remembers the choice', () => {
    render(<Viewer mesh={mesh} fitKey={1} dark={false} />);
    const btn = screen.getByRole('button', { name: /grid/i });
    expect(btn.textContent).toContain('20 mm');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(calls.grid.at(-1)).toMatchObject({ visible: true, spec: { step: 20 } });
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(calls.grid.at(-1)).toMatchObject({ visible: false });
    expect(localStorage.getItem('osc-grid')).toBe('off');
  });

  it('starts hidden when the browser remembers "off", and G toggles it', () => {
    localStorage.setItem('osc-grid', 'off');
    render(<Viewer mesh={mesh} fitKey={1} dark={false} />);
    const btn = screen.getByRole('button', { name: /grid/i });
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    fireEvent.keyDown(screen.getByTestId('viewer'), { key: 'g' });
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('has no size label before there is a model', () => {
    render(<Viewer mesh={null} fitKey={0} dark={false} />);
    expect(screen.getByRole('button', { name: /grid/i }).textContent).not.toContain('mm');
  });
});
