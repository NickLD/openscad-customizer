// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { parseOff } from '../../src/mesh/off';
import { AppController } from '../../src/app/controller';
import { App } from '../../src/ui/App';

vi.mock('../../src/ui/viewer/Viewer', () => ({ Viewer: () => <div data-testid="viewer" /> }));

function ctl() {
  return new AppController({ net: { getJson: vi.fn(), getBytes: vi.fn() }, engine: { run: vi.fn() }, setHash: vi.fn() });
}

describe('App', () => {
  it('shows the landing page and navigates from a pasted GitHub URL', () => {
    const c = ctl();
    render(<App ctl={c} />);
    expect(screen.getByText(/Split Cable Gland/)).toBeTruthy();
    fireEvent.input(screen.getByTestId('github-input'), { target: { value: 'https://github.com/someone/thing/blob/main/a.scad' } });
    fireEvent.submit(screen.getByTestId('github-input').closest('form')!);
    expect(location.hash).toBe('#/gh/someone/thing@main/a.scad');
  });

  it('shows load errors', () => {
    const c = ctl();
    c.phase.value = 'error';
    c.error.value = "Couldn't find o/r. Private repos aren't supported.";
    render(<App ctl={c} />);
    expect(screen.getByRole('alert').textContent).toContain("Couldn't find o/r");
  });

  it('renders manifest text as text, not HTML', () => {
    const c = ctl();
    c.phase.value = 'picker';
    c.repo.value = { owner: 'o', repo: 'r', ref: 'main', stale: false, files: new Map(), warnings: [], manifest: { title: '<img src=x onerror=alert(1)>', libraries: {} } };
    c.candidates.value = [{ path: 'a.scad', title: '<b>bold</b>' }, { path: 'b.scad', title: 'b' }];
    render(<App ctl={c} />);
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect(screen.getByText('<b>bold</b>')).toBeTruthy();
  });

  describe('model view', () => {
    const mesh = parseOff(['OFF', '3 1 0', '0 0 0', '10 0 0', '0 20 5', '3 0 1 2', ''].join('\n'));
    function modelCtl() {
      const c = ctl();
      c.phase.value = 'model';
      c.entry.value = 'a.scad';
      return c;
    }

    it('shows status, size and enabled exports when ready', () => {
      const c = modelCtl();
      c.render.value = { status: 'ready', mesh, outdated: false };
      render(<App ctl={c} />);
      expect(screen.getByTestId('render-status').textContent).toBe('Ready');
      expect(screen.getByTestId('model-size').textContent).toBe('10.0 × 20.0 × 5.0 mm');
      expect((screen.getByTestId('export-stl') as HTMLButtonElement).disabled).toBe(false);
      expect((screen.getByTestId('export-3mf') as HTMLButtonElement).disabled).toBe(false);
    });

    it('disables export and shows the outdated badge when outdated', () => {
      const c = modelCtl();
      c.render.value = { status: 'ready', mesh, outdated: true };
      render(<App ctl={c} />);
      expect((screen.getByTestId('export-stl') as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByTestId('export-3mf') as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getByText('outdated')).toBeTruthy();
    });

    it('cancels a running render', () => {
      const c = modelCtl();
      const spy = vi.spyOn(c, 'cancelRender').mockImplementation(() => {});
      c.render.value = { status: 'rendering', mesh: null, outdated: false };
      render(<App ctl={c} />);
      fireEvent.click(screen.getByText('Cancel'));
      expect(spy).toHaveBeenCalled();
    });

    it('shows console badges, lists lines and jumps to a line', async () => {
      const c = modelCtl();
      c.log.value = [
        { level: 'error', text: 'boom', file: '/repo/a.scad', line: 3 },
        { level: 'warning', text: 'hmm' },
      ] as typeof c.log.value;
      render(<App ctl={c} />);
      const toggle = screen.getByTestId('console-toggle');
      expect(toggle.querySelector('.badge.error')?.textContent).toBe('1');
      expect(toggle.querySelector('.badge.warning')?.textContent).toBe('1');
      fireEvent.click(toggle);
      expect(screen.getByText(/boom/)).toBeTruthy();
      expect(screen.getByText(/hmm/)).toBeTruthy();
      fireEvent.click(screen.getByText('line 3'));
      expect(await screen.findByRole('dialog', { name: 'Source' })).toBeTruthy();
    });
  });

  it('shows a hint and keeps the hash for an invalid URL', () => {
    location.hash = '';
    render(<App ctl={ctl()} />);
    fireEvent.input(screen.getByTestId('github-input'), { target: { value: 'not a url at all' } });
    fireEvent.submit(screen.getByTestId('github-input').closest('form')!);
    expect(screen.getByText(/doesn't look like a GitHub repository URL/)).toBeTruthy();
    expect(location.hash).toBe('');
  });

  it('keeps the pinned ref in picker card links', () => {
    location.hash = '#/gh/o/r@v1.2';
    const c = ctl();
    c.phase.value = 'picker';
    c.repo.value = { owner: 'o', repo: 'r', ref: 'v1.2', stale: false, files: new Map(), warnings: [], manifest: null } as never;
    c.candidates.value = [{ path: 'sub/a.scad', title: 'a' }];
    render(<App ctl={c} />);
    expect(screen.getByTestId('picker-card').getAttribute('href')).toBe('#/gh/o/r@v1.2/sub/a.scad');
  });
});
