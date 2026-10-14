const DEFINITION = /^(?:module|function)\b|^[A-Za-z_$][\w$]*\s*=(?!=)/;

/**
 * True when a script defines at least one module or function and every other top-level statement
 * is an include/use or a variable: it draws nothing by itself (a part another file uses).
 */
export function onlyDefinitions(src: string): boolean {
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/^\s*(?:include|use)\s*<[^>]*>/gm, ' ');
  // Split into top-level statements: each ends at a `;` or a `}` back at depth 0.
  const statements: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    if (depth === 0 && (c === ';' || c === '}')) {
      statements.push(code.slice(start, i + 1).trim());
      start = i + 1;
    }
  }
  const rest = code.slice(start).trim();
  if (rest) statements.push(rest);
  const real = statements.filter((s) => s && s !== ';');
  return real.some((s) => /^(?:module|function)\b/.test(s)) && real.every((s) => DEFINITION.test(s));
}
