import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { useEffect, useRef } from 'preact/hooks';
import type { AppController } from '../app/controller';
import type { JumpRequest } from './App';
import { encodeText } from '../util';
import { downloadBytes } from './download';
import { scadLanguage } from './scadLanguage';

export function SourceDrawer({ ctl, jump, onClose }: { ctl: AppController; jump: JumpRequest | null; onClose(): void }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const entry = ctl.entry.value;

  useEffect(() => {
    view.current = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: ctl.entrySource(),
        extensions: [basicSetup, scadLanguage, EditorView.updateListener.of((u) => {
          if (u.docChanged) ctl.setSource(u.state.doc.toString());
        })],
      }),
    });
    return () => view.current?.destroy();
  }, [entry]);

  useEffect(() => {
    const v = view.current;
    if (!v || !jump || jump.line < 1 || jump.line > v.state.doc.lines) return;
    const line = v.state.doc.line(jump.line);
    v.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
    v.focus();
  }, [jump]);

  const edited = ctl.editedSource.value !== null;
  return (
    <div class="source-drawer" role="dialog" aria-label="Source">
      <div class="drawer-head">
        <strong>{entry}</strong>
        {edited && <span class="edited">Edited locally – not saved to repo</span>}
        <span class="spacer" />
        {edited && <button type="button" onClick={() => downloadBytes(entry!.split('/').pop()!, encodeText(ctl.entrySource()))}>Download .scad</button>}
        {edited && <button type="button" onClick={() => {
          ctl.setSource(null);
          view.current?.dispatch({ changes: { from: 0, to: view.current.state.doc.length, insert: ctl.entrySource() } });
          ctl.setSource(null);
        }}>Revert</button>}
        <button type="button" aria-label="Close source" onClick={onClose}>✕</button>
      </div>
      <div class="editor" ref={host} />
    </div>
  );
}
