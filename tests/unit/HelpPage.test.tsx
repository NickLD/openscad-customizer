// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { HelpPage } from '../../src/ui/HelpPage';

const base = () => location.origin + location.pathname;

describe('HelpPage', () => {
  it('turns a pasted GitHub URL into a customizer link, a README badge and a featured.json entry', () => {
    render(<HelpPage />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Use this Customizer for your Model');
    fireEvent.input(screen.getByLabelText('Your GitHub repo or .scad file'), { target: { value: 'https://github.com/someone/box/blob/main/models/box.scad' } });
    expect((screen.getByTestId('help-link') as HTMLInputElement).value).toBe(`${base()}#/gh/someone/box/models/box.scad`);
    expect((screen.getByTestId('help-badge') as HTMLInputElement).value).toBe(
      `[![Open in OpenSCAD Customizer](https://img.shields.io/badge/Open%20in-OpenSCAD%20Customizer-f9d72c)](${base()}#/gh/someone/box/models/box.scad)`,
    );
    const entry = JSON.parse(screen.getByTestId('help-featured').textContent!);
    expect(entry).toMatchObject({ owner: 'someone', repo: 'box', path: 'models/box.scad' });
    const pr = screen.getByText(/Propose it on GitHub/).closest('a')!;
    expect(pr.getAttribute('href')).toBe('https://github.com/NickLD/openscad-customizer/edit/main/src/featured.json');
  });

  it('links to the repo picker when no file is given, and flags bad input', () => {
    render(<HelpPage />);
    const input = screen.getByLabelText('Your GitHub repo or .scad file');
    fireEvent.input(input, { target: { value: 'someone/box' } });
    expect((screen.getByTestId('help-link') as HTMLInputElement).value).toBe(`${base()}#/gh/someone/box`);
    fireEvent.input(input, { target: { value: 'not a repo' } });
    expect(screen.getByText(/doesn't look like a GitHub repository/)).toBeTruthy();
    expect(screen.queryByTestId('help-link')).toBeNull();
  });
});
