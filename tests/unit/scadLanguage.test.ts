import { describe, expect, it } from 'vitest';
import { tokenizeLine } from '../../src/ui/scadLanguage';

describe('scad tokenizer', () => {
  it('styles keywords, numbers, strings, comments and specials', () => {
    const toks = tokenizeLine('module m($fn=32) { echo("a\\"b"); } // hi');
    const styled = toks.filter(([, s]) => s).map(([t, s]) => `${s}:${t}`);
    expect(styled).toEqual(['keyword:module', 'variableName:m', 'variableName.special:$fn', 'number:32', 'keyword:echo', 'string:"a\\"b"', 'comment:// hi']);
  });
});
