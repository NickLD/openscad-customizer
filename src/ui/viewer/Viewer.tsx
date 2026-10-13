import { useEffect, useRef } from 'preact/hooks';
import type { Mesh } from '../../mesh/off';
import { ThreeViewer } from './ThreeViewer';

export function Viewer({ mesh, fitKey, dark }: { mesh: Mesh | null; fitKey: number; dark: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const viewer = useRef<ThreeViewer | null>(null);
  const fitted = useRef(-1);

  useEffect(() => {
    viewer.current = new ThreeViewer(ref.current!);
    return () => viewer.current?.dispose();
  }, []);
  useEffect(() => viewer.current?.setDark(dark), [dark]);
  useEffect(() => {
    const refit = mesh !== null && fitted.current !== fitKey;
    if (refit) fitted.current = fitKey;
    viewer.current?.setMesh(mesh, refit);
  }, [mesh, fitKey]);

  return <div class="viewer-canvas" ref={ref} data-testid="viewer" />;
}
