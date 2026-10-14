// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { parseOff } from '../../src/mesh/off';
import { AppController } from '../../src/app/controller';
import { App } from '../../src/ui/App';
import { EditorView } from '@codemirror/view';

// jsdom has no layout; CodeMirror measures ranges when scrolling a selection into view.
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();

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

  it('shows featured models as cards linking to the customizer', () => {
    render(<App ctl={ctl()} />);
    const card = screen.getByTestId('featured-card');
    expect(card.textContent).toContain('Split Cable Gland');
    expect(card.querySelector('a.button')!.getAttribute('href')).toBe('#/gh/NickLD/split-cable-gland/cable_gland.scad');
    expect(card.querySelector('img')!.getAttribute('src')).toBe('https://cdn.jsdelivr.net/gh/NickLD/split-cable-gland/showcase/img/01_hero.png');
  });

  it('header links to the customizer source and the how-to page on every page', () => {
    render(<App ctl={ctl()} />);
    const gh = screen.getByText('View Customizer Source on GitHub').closest('a')!;
    expect(gh.getAttribute('href')).toBe('https://github.com/NickLD/openscad-customizer');
    expect(gh.rel).toBe('noopener noreferrer');
    expect(screen.getByText('Use this Customizer for your Model').closest('a')!.getAttribute('href')).toBe('#/help');
  });

  it('shows the logo as the Home link', () => {
    render(<App ctl={ctl()} />);
    const home = screen.getByLabelText('Home');
    expect(home.getAttribute('href')).toBe('#');
    expect(home.querySelector('svg.logo')).toBeTruthy();
  });

  it('renders the help page in the help phase', () => {
    const c = ctl();
    c.phase.value = 'help';
    render(<App ctl={c} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Use this Customizer for your Model' })).toBeTruthy();
  });

  it('links the bundled libraries, OpenSCAD and the app source in the footer', () => {
    render(<App ctl={ctl()} />);
    const links = [...document.querySelectorAll('footer.about a')] as HTMLAnchorElement[];
    const hrefs = links.map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('https://github.com/openscad/openscad');
    expect(hrefs).toContain('https://github.com/NickLD/openscad-customizer');
    expect(hrefs).toContain('https://github.com/BelfrySCAD/BOSL2');
    expect(hrefs).toContain('https://github.com/shantigilbert/liberation-fonts-ttf');
    expect(links).toHaveLength(11); // 8 libraries, fonts, OpenSCAD, source
    for (const a of links) expect(a.rel).toBe('noopener noreferrer');
    expect(document.querySelector('footer.about')!.textContent).toContain('GPL-2.0-or-later');
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

    it('overlays render warnings on the 3D view and opens the Console from there', () => {
      const c = modelCtl();
      c.render.value = { status: 'ready', mesh, outdated: false, seconds: 1 };
      c.log.value = [
        { level: 'echo', text: '"Cables: 4"' },
        { level: 'warning', text: '"WARNING: Only -1.17 mm between cable holes and thread root."', echoed: true },
        { level: 'info', text: 'Rendered in 5 ms' },
      ];
      render(<App ctl={c} />);
      const overlay = screen.getByRole('status', { name: '1 warning' });
      expect(overlay.closest('.viewer')).toBeTruthy();
      expect(overlay.textContent).toContain('WARNING: Only -1.17 mm between cable holes and thread root.');
      fireEvent.click(screen.getByText('Show in Console'));
      const line = document.querySelector('.console li.warning')!;
      expect(line.textContent).toContain('⚠');
      expect(document.querySelector('.console li.echo')!.textContent).not.toContain('⚠');
    });

    it('hides the overlay while the model is stale', () => {
      const c = modelCtl();
      c.render.value = { status: 'ready', mesh, outdated: true };
      c.log.value = [{ level: 'warning', text: 'old' }];
      render(<App ctl={c} />);
      expect(screen.queryByRole('status', { name: '1 warning' })).toBeNull();
    });

    it('labels the source button clearly', () => {
      render(<App ctl={modelCtl()} />);
      const btn = screen.getByTestId('source-toggle');
      expect(btn.textContent).toContain('View/edit Model Source');
      expect(btn.title).toBe("View and edit this model's OpenSCAD code. Edits stay in your browser.");
    });

    it('shows status, size and enabled exports when ready', () => {
      const c = modelCtl();
      c.render.value = { status: 'ready', mesh, outdated: false, seconds: 5.3 };
      render(<App ctl={c} />);
      expect(screen.getByTestId('render-status').textContent).toBe('Ready · 5.3 s');
      expect(screen.getByTestId('model-size').textContent).toBe('10.0 × 20.0 × 5.0 mm');
      expect(screen.getByTestId('export-stl').textContent).toContain('Download STL');
      expect((screen.getByTestId('export-stl') as HTMLButtonElement).disabled).toBe(false);
      expect((screen.getByTestId('export-3mf') as HTMLButtonElement).disabled).toBe(false);
      expect(document.querySelector('.viewer')!.classList.contains('stale')).toBe(false);
    });

    it('blurs the stale model and disables export while a change is pending', () => {
      const c = modelCtl();
      c.render.value = { status: 'ready', mesh, outdated: true };
      render(<App ctl={c} />);
      expect((screen.getByTestId('export-stl') as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByTestId('export-3mf') as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getByTestId('export-stl').title).toBe('Waiting for render…');
      expect(document.querySelector('.viewer')!.classList.contains('stale')).toBe(true);
    });

    it('does not show the previous repo in the header while another one loads', () => {
      const c = ctl();
      c.repo.value = { owner: 'old', repo: 'thing', ref: 'main', stale: false, warnings: [], manifest: null, files: new Map() };
      c.phase.value = 'loading';
      render(<App ctl={c} />);
      expect(document.querySelector('.app-header')!.textContent).not.toContain('old/thing');
    });

    describe('share panel', () => {
      const SHA = 'b'.repeat(40);
      function shareCtl() {
        const c = modelCtl();
        c.repo.value = { owner: 'o', repo: 'r', ref: SHA, sha: SHA, stale: false, warnings: [], manifest: null, files: new Map() };
        c.candidates.value = [{ path: 'a.scad', title: 'Gadget' }];
        c.params.value = [{ name: 'n', group: 'G', type: 'number', initial: 1 }];
        c.values.value = { n: 2 };
        return c;
      }
      const base = () => location.origin + location.pathname;

      it('explains the link and updates it as options change', () => {
        try { localStorage.removeItem('osc-share-options'); } catch { /* ignore */ }
        render(<App ctl={shareCtl()} />);
        fireEvent.click(screen.getByTestId('share-link'));
        expect(screen.getByRole('dialog', { name: 'Share this model' })).toBeTruthy();
        expect(screen.getByTestId('share-summary').textContent).toBe('Opens Gadget with your 1 changed setting, always using the latest version.');
        expect((screen.getByTestId('share-url') as HTMLInputElement).value).toBe(`${base()}#/gh/o/r/a.scad?n=2`);
        fireEvent.click(screen.getByLabelText(/Pin to this exact version/));
        expect((screen.getByTestId('share-url') as HTMLInputElement).value).toBe(`${base()}#/gh/o/r@${SHA}/a.scad?n=2`);
        fireEvent.click(screen.getByLabelText(/Include my settings/));
        expect(screen.getByTestId('share-summary').textContent).toBe('Opens Gadget with its default settings, pinned to version bbbbbbb.');
        expect(screen.queryByLabelText(/Open this model directly/)).toBeNull(); // single-model repo
      });

      it('remembers the chosen options', () => {
        try { localStorage.setItem('osc-share-options', JSON.stringify({ settings: false, pin: true, model: true })); } catch { /* ignore */ }
        render(<App ctl={shareCtl()} />);
        fireEvent.click(screen.getByTestId('share-link'));
        expect((screen.getByTestId('share-url') as HTMLInputElement).value).toBe(`${base()}#/gh/o/r@${SHA}/a.scad`);
        try { localStorage.removeItem('osc-share-options'); } catch { /* ignore */ }
      });

      it('copies the link shown and closes on Escape or an outside click', async () => {
        try { localStorage.removeItem('osc-share-options'); } catch { /* ignore */ }
        const writeText = vi.fn(async () => {});
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        render(<App ctl={shareCtl()} />);
        fireEvent.click(screen.getByTestId('share-link'));
        fireEvent.click(screen.getByText('Copy'));
        await screen.findByText('Copied!');
        expect(writeText).toHaveBeenCalledWith(`${base()}#/gh/o/r/a.scad?n=2`);
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('dialog', { name: 'Share this model' })).toBeNull();
        fireEvent.click(screen.getByTestId('share-link'));
        fireEvent.mouseDown(document.body);
        expect(screen.queryByRole('dialog', { name: 'Share this model' })).toBeNull();
      });
    });

    it('jumps again on a repeated click and not when the drawer is reopened', async () => {
      const c = modelCtl();
      c.repo.value = { owner: 'o', repo: 'r', ref: 'main', stale: false, warnings: [], manifest: null, files: new Map([['a.scad', new TextEncoder().encode('a\nb\nc\nd\n')]]) };
      c.log.value = [{ level: 'error', text: 'boom', file: '/repo/a.scad', line: 3 }];
      const focus = vi.spyOn(EditorView.prototype, 'focus');
      render(<App ctl={c} />);
      fireEvent.click(screen.getByTestId('console-toggle'));
      fireEvent.click(screen.getByText('line 3'));
      await screen.findByRole('dialog', { name: 'Source' });
      await vi.waitFor(() => expect(focus).toHaveBeenCalledTimes(1));
      fireEvent.click(screen.getByText('line 3'));
      await vi.waitFor(() => expect(focus).toHaveBeenCalledTimes(2));
      fireEvent.click(screen.getByLabelText('Close source'));
      fireEvent.click(screen.getByTestId('source-toggle'));
      await screen.findByRole('dialog', { name: 'Source' });
      await new Promise((r) => setTimeout(r, 20));
      expect(focus).toHaveBeenCalledTimes(2);
      focus.mockRestore();
    });

    it('cancels a slow render from the render card', async () => {
      const c = modelCtl();
      const spy = vi.spyOn(c, 'cancelRender').mockImplementation(() => {});
      c.render.value = { status: 'rendering', mesh: null, outdated: false, startedAt: performance.now() };
      render(<App ctl={c} />);
      fireEvent.click(await screen.findByText('Cancel'));
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
