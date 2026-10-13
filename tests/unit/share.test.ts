import { describe, expect, it } from 'vitest';
import { buildShare, type ShareState } from '../../src/share';

const SHA = '5ddb63f0123456789abcdef0123456789abcdef0';
const base: ShareState = {
  owner: 'NickLD', repo: 'split-cable-gland', sha: SHA, entry: 'cable_gland.scad', title: 'Split Cable Gland',
  multipleModels: false, preset: null, presetExact: false, changed: { cable_count: '4', part: 'nut' },
};
const all = { settings: true, pin: false, model: true };

describe('buildShare', () => {
  it('defaults: model + changed settings, latest version', () => {
    const s = buildShare(base, all);
    expect(s.hash).toBe('#/gh/NickLD/split-cable-gland/cable_gland.scad?cable_count=4&part=nut');
    expect(s.summary).toBe('Opens Split Cable Gland with your 2 changed settings, always using the latest version.');
  });

  it('without settings opens the defaults', () => {
    const s = buildShare(base, { ...all, settings: false });
    expect(s.hash).toBe('#/gh/NickLD/split-cable-gland/cable_gland.scad');
    expect(s.summary).toBe('Opens Split Cable Gland with its default settings, always using the latest version.');
  });

  it('pins to the loaded commit', () => {
    const s = buildShare(base, { ...all, pin: true });
    expect(s.hash).toBe(`#/gh/NickLD/split-cable-gland@${SHA}/cable_gland.scad?cable_count=4&part=nut`);
    expect(s.summary).toBe('Opens Split Cable Gland with your 2 changed settings, pinned to version 5ddb63f.');
  });

  it('uses the preset name when the values still match it', () => {
    const s = buildShare({ ...base, preset: 'Three cables', presetExact: true }, all);
    expect(s.hash).toBe('#/gh/NickLD/split-cable-gland/cable_gland.scad?preset=Three+cables');
    expect(s.summary).toBe('Opens Split Cable Gland with the "Three cables" preset, always using the latest version.');
  });

  it('falls back to explicit values once a preset was tweaked', () => {
    const s = buildShare({ ...base, preset: 'Three cables', presetExact: false }, all);
    expect(s.hash).toBe('#/gh/NickLD/split-cable-gland/cable_gland.scad?cable_count=4&part=nut');
  });

  it('says "1 changed setting" in the singular', () => {
    expect(buildShare({ ...base, changed: { part: 'nut' } }, all).summary).toContain('your 1 changed setting,');
  });

  it('links to the model list when the model is left out, ignoring settings', () => {
    const s = buildShare({ ...base, multipleModels: true }, { ...all, model: false, pin: true });
    expect(s.hash).toBe(`#/gh/NickLD/split-cable-gland@${SHA}`);
    expect(s.summary).toBe('Opens the model list of NickLD/split-cable-gland, pinned to version 5ddb63f.');
  });

  it('ignores "model off" when the repo has only one model', () => {
    expect(buildShare(base, { ...all, model: false }).hash).toContain('/cable_gland.scad');
  });

  it('cannot pin without a resolved commit', () => {
    const s = buildShare({ ...base, sha: undefined }, { ...all, pin: true });
    expect(s.hash).not.toContain('@');
    expect(s.summary).toContain('always using the latest version');
  });
});
