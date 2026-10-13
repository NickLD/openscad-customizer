// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import type { LogLine } from '../../src/engine/log';
import { problemText, ProblemsOverlay } from '../../src/ui/ProblemsOverlay';

const w = (text: string): LogLine => ({ level: 'warning', text });
const e = (text: string): LogLine => ({ level: 'error', text });
const echo = (text: string): LogLine => ({ level: 'echo', text });

describe('problemText', () => {
  it('strips the quotes OpenSCAD puts around echoed strings', () => {
    expect(problemText('"WARNING: too thin"')).toBe('WARNING: too thin');
    expect(problemText('Ignoring unknown variable "x"')).toBe('Ignoring unknown variable "x"');
  });
});

describe('ProblemsOverlay', () => {
  it('shows nothing for a clean log or while hidden', () => {
    const { container, rerender } = render(<ProblemsOverlay log={[echo('"ok"')]} visible onShowConsole={() => {}} />);
    expect(container.querySelector('.problems')).toBeNull();
    rerender(<ProblemsOverlay log={[w('x')]} visible={false} onShowConsole={() => {}} />);
    expect(container.querySelector('.problems')).toBeNull();
  });

  it('summarises warnings, shows the first two and links to the Console', () => {
    const onShow = vi.fn();
    render(<ProblemsOverlay log={[echo('"a"'), w('"WARNING: one"'), w('two'), w('three')]} visible onShowConsole={onShow} />);
    const panel = screen.getByRole('status', { name: '3 warnings' });
    expect(panel.className).toContain('warning');
    expect([...panel.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['WARNING: one', 'two']);
    expect(panel.textContent).toContain('+1 more');
    fireEvent.click(screen.getByText('Show in Console'));
    expect(onShow).toHaveBeenCalled();
  });

  it('puts errors first when both exist', () => {
    render(<ProblemsOverlay log={[w('warn'), e('boom')]} visible onShowConsole={() => {}} />);
    const panel = screen.getByRole('status', { name: '1 error, 1 warning' });
    expect(panel.className).toContain('error');
    expect(panel.querySelector('li')!.textContent).toBe('boom');
  });

  it('stays dismissed until a new log with problems arrives', () => {
    const first = [w('one')];
    const { rerender } = render(<ProblemsOverlay log={first} visible onShowConsole={() => {}} />);
    fireEvent.click(screen.getByLabelText('Dismiss'));
    expect(screen.queryByRole('status')).toBeNull();
    rerender(<ProblemsOverlay log={first} visible onShowConsole={() => {}} />);
    expect(screen.queryByRole('status')).toBeNull();
    rerender(<ProblemsOverlay log={[w('one again')]} visible onShowConsole={() => {}} />);
    expect(screen.getByRole('status', { name: '1 warning' })).toBeTruthy();
  });
});
