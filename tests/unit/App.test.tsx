// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
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
});
