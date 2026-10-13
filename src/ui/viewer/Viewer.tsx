import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { meshBounds } from '../../mesh/bounds';
import type { Mesh } from '../../mesh/off';
import { GridIcon } from '../icons';
import { gridFor } from './gridSpec';
import { ThreeViewer } from './ThreeViewer';

const GRID_KEY = 'osc-grid';

function loadGridOn(): boolean {
  try {
    return localStorage.getItem(GRID_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function Viewer({ mesh, fitKey, dark }: { mesh: Mesh | null; fitKey: number; dark: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const viewer = useRef<ThreeViewer | null>(null);
  const fitted = useRef(-1);
  const [gridOn, setGridOn] = useState(loadGridOn);
  const grid = useMemo(() => (mesh ? gridFor(meshBounds(mesh)) : null), [mesh]);

  const toggleGrid = () => {
    const next = !gridOn;
    setGridOn(next);
    try {
      localStorage.setItem(GRID_KEY, next ? 'on' : 'off');
    } catch {
      /* storage unavailable */
    }
  };

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
  useEffect(() => viewer.current?.setGrid(grid, gridOn), [grid, gridOn]);

  return (
    <>
      <div class="viewer-canvas" ref={ref} data-testid="viewer" tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'g' || e.key === 'G') toggleGrid();
        }} />
      <button type="button" class="grid-toggle with-icon" aria-pressed={gridOn} onClick={toggleGrid}
        aria-label={grid ? `Grid, ${grid.step} mm cells` : 'Grid'} title={`${gridOn ? 'Hide' : 'Show'} the grid (G)`}>
        <GridIcon />
        {grid && <span>{grid.step} mm</span>}
      </button>
    </>
  );
}
