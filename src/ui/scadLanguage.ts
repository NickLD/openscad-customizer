import { StreamLanguage, StringStream, type StreamParser } from '@codemirror/language';

const KEYWORDS = new Set([
  'module', 'function', 'include', 'use', 'if', 'else', 'for', 'let', 'each', 'assert', 'echo', 'intersection_for',
  'true', 'false', 'undef',
]);

type State = { inBlockComment: boolean };

const parser: StreamParser<State> = {
  startState: () => ({ inBlockComment: false }),
  token(stream, state) {
    if (state.inBlockComment) {
      if (stream.skipTo('*/')) {
        stream.next();
        stream.next();
        state.inBlockComment = false;
      } else stream.skipToEnd();
      return 'comment';
    }
    if (stream.eatSpace()) return null;
    if (stream.match('//')) {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.match('/*')) {
      state.inBlockComment = true;
      return 'comment';
    }
    if (stream.peek() === '"') {
      stream.next();
      let escaped = false;
      let ch: string | void;
      while ((ch = stream.next()) != null) {
        if (ch === '"' && !escaped) break;
        escaped = !escaped && ch === '\\';
      }
      return 'string';
    }
    if (stream.match(/^\d+(\.\d*)?([eE][+-]?\d+)?/) || stream.match(/^\.\d+([eE][+-]?\d+)?/)) return 'number';
    if (stream.match(/^\$[A-Za-z_]\w*/)) return 'variableName.special';
    if (stream.match(/^[A-Za-z_]\w*/)) return KEYWORDS.has(stream.current()) ? 'keyword' : 'variableName';
    stream.next();
    return null;
  },
};

export const scadLanguage = StreamLanguage.define(parser);

/** Test helper: runs the tokenizer over one line. */
export function tokenizeLine(line: string): Array<[string, string | null]> {
  const state = parser.startState!(2);
  const stream = new StringStream(line, 2, 2);
  const out: Array<[string, string | null]> = [];
  while (!stream.eol()) {
    stream.start = stream.pos;
    const style = parser.token(stream, state);
    out.push([stream.current(), style ?? null]);
  }
  return out;
}
