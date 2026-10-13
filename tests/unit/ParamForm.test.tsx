// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { toGroups } from '../../src/paramModel';
import type { Param } from '../../src/types';
import { ParamForm } from '../../src/ui/ParamForm';

const params: Param[] = [
  { name: 'clearance', group: 'Holes', caption: 'Extra diameter', type: 'number', initial: 0.3, min: 0, max: 1.5, step: 0.05 },
  { name: 'count', group: 'Holes', type: 'number', initial: 2, options: [{ name: 'Two', value: 2 }, { name: 'Three', value: 3 }] },
  { name: 'taper', group: 'Holes', type: 'boolean', initial: false },
  { name: 'label', group: 'Text', type: 'string', initial: 'hi' },
  { name: 'offset', group: 'Text', type: 'number', initial: [1, 2] },
];
const defaults = Object.fromEntries(params.map((p) => [p.name, p.initial]));

function setup(values = defaults) {
  const onChange = vi.fn();
  const onReset = vi.fn();
  render(<ParamForm groups={toGroups(params)} values={values} defaults={defaults} onChange={onChange} onReset={onReset} />);
  return { onChange, onReset };
}

describe('ParamForm', () => {
  it('renders groups, captions and controls', () => {
    setup();
    expect(screen.getByText('Holes')).toBeTruthy();
    expect(screen.getByText('Extra diameter')).toBeTruthy();
    expect((screen.getByLabelText('clearance') as HTMLInputElement).type).toBe('range');
    expect(screen.getByLabelText('count').tagName).toBe('SELECT');
    expect((screen.getByLabelText('taper') as HTMLInputElement).type).toBe('checkbox');
  });

  it('rounds slider values to the step', () => {
    const { onChange } = setup();
    fireEvent.input(screen.getByLabelText('clearance'), { target: { value: '0.30000000000000004' } });
    expect(onChange).toHaveBeenCalledWith('clearance', 0.3);
  });

  it('emits typed values for dropdowns, toggles, text and vectors', () => {
    const { onChange } = setup();
    fireEvent.change(screen.getByLabelText('count'), { target: { value: '1' } }); // option index
    expect(onChange).toHaveBeenCalledWith('count', 3);
    fireEvent.click(screen.getByLabelText('taper'));
    expect(onChange).toHaveBeenCalledWith('taper', true);
    fireEvent.input(screen.getByLabelText('label'), { target: { value: 'yo' } });
    expect(onChange).toHaveBeenCalledWith('label', 'yo');
    fireEvent.input(screen.getByLabelText('offset[1]'), { target: { value: '5' } });
    expect(onChange).toHaveBeenCalledWith('offset', [1, 5]);
  });

  it('marks modified values and resets them', () => {
    const { onReset } = setup({ ...defaults, taper: true });
    const reset = screen.getByRole('button', { name: 'Reset taper' });
    fireEvent.click(reset);
    expect(onReset).toHaveBeenCalledWith('taper');
    expect(screen.queryByRole('button', { name: 'Reset label' })).toBeNull();
  });
});
