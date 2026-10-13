export type LogLevel = 'echo' | 'warning' | 'error' | 'info';
export type LogLine = { level: LogLevel; text: string; file?: string; line?: number };

const NOISE = [/^Could not initialize localization/, /^Fontconfig (error|warning)/];
const TAGGED = /^(ECHO|WARNING|ERROR|TRACE):\s?(.*)$/;
const LOCATION = /in file ([^,]+), line (\d+)/;
const EMPTY = 'Current top level object is empty.';

export function parseLog(lines: string[]): LogLine[] {
  const out: LogLine[] = [];
  for (const raw of lines) {
    if (!raw.trim() || NOISE.some((r) => r.test(raw))) continue;
    let level: LogLevel = 'info';
    let text = raw;
    const m = TAGGED.exec(raw);
    if (m) {
      level = m[1] === 'ECHO' ? 'echo' : m[1] === 'ERROR' ? 'error' : m[1] === 'WARNING' ? 'warning' : 'info';
      text = m[2];
    } else if (raw.startsWith('DEPRECATED:')) {
      level = 'warning';
    }
    const entry: LogLine = { level, text };
    const loc = LOCATION.exec(text);
    if (loc) {
      entry.file = loc[1];
      entry.line = Number(loc[2]);
    }
    out.push(entry);
  }
  return out;
}

export function isEmptyGeometry(log: LogLine[]): boolean {
  return log.some((l) => l.text === EMPTY);
}
