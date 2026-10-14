import { describe, expect, it } from 'vitest';
import { onlyDefinitions } from '../../src/definitions';

describe('onlyDefinitions', () => {
  it.each([
    ['includes and a module with nested braces', 'include <BOSL2/std.scad>\nuse <rings.scad>\n\nmodule top(a, b = [1, 2]) {\n  if (a) { cube(a); } else { sphere(b[0]); }\n  children();\n}\n'],
    ['variables, functions and a brace-less module', 'x = 1; // [1:5]\nfunction f(a) = a * 2;\nmodule m() cube(x);\ng = function(y) y + 1;'],
    ['braces and keywords inside strings and comments', 'module m() { echo("} cube(1);"); } // cube(2);\n/* sphere(3); */'],
  ])('is true for %s', (_name, src) => {
    expect(onlyDefinitions(src)).toBe(true);
  });

  it.each([
    ['a module that is also called', 'module m() { cube(1); }\nm();'],
    ['geometry after an include', 'include <a.scad>\ncube(1);'],
    ['geometry next to a commented-out definition', '/* module x() {} */ cube(1);'],
    ['a top-level if', 'if (true) { cube(1); }'],
    ['a modifier on a call', 'module m() cube(1);\n!m();'],
    ['an empty file', '  // nothing here\n'],
    ['only variables (no module or function to be a part)', '/* [G] */\nx = 1; // [1:5]\n'],
  ])('is false for %s', (_name, src) => {
    expect(onlyDefinitions(src)).toBe(false);
  });
});
