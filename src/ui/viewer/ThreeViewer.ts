import {
  AmbientLight, BufferGeometry, Color, DirectionalLight, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments,
  Mesh as ThreeMesh, MeshStandardMaterial, PerspectiveCamera, Scene, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Mesh } from '../../mesh/off';
import { gridLines, type GridSpec } from './gridSpec';
import { meshToGeometry } from './meshGeometry';

const MODEL_COLOR = 0xf9d72c; // OpenSCAD default
const GRID_COLORS = { light: { minor: 0xd3d7dd, major: 0x9aa1ab }, dark: { minor: 0x2e323a, major: 0x4c525c } };

export class ThreeViewer {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(40, 1, 0.1, 10000);
  private controls: OrbitControls;
  private grid = new Group();
  private gridMinor = new LineBasicMaterial({ color: GRID_COLORS.light.minor });
  private gridMajor = new LineBasicMaterial({ color: GRID_COLORS.light.major });
  private model: ThreeMesh | null = null;
  private observer: ResizeObserver;
  private frame = 0;
  private disposed = false;

  constructor(private container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);
    this.camera.up.set(0, 0, 1); // OpenSCAD is Z-up
    this.camera.position.set(80, -120, 90);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.addEventListener('change', () => this.requestRender());
    this.scene.add(new AmbientLight(0xffffff, 0.6));
    const key = new DirectionalLight(0xffffff, 1.6);
    key.position.set(1, -1.5, 2);
    this.camera.add(key);
    this.scene.add(this.camera);
    this.scene.add(this.grid);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
  }

  setDark(dark: boolean): void {
    this.scene.background = new Color(dark ? 0x1b1d22 : 0xeef0f3);
    const colors = dark ? GRID_COLORS.dark : GRID_COLORS.light;
    this.gridMinor.color.setHex(colors.minor);
    this.gridMajor.color.setHex(colors.major);
    this.requestRender();
  }

  /** Rebuilds the print-bed grid; `null` (no model yet) leaves it empty. */
  setGrid(spec: GridSpec | null, visible: boolean): void {
    if (this.disposed) return;
    this.clearGrid();
    if (spec) {
      const { minor, major } = gridLines(spec);
      for (const [points, material] of [[minor, this.gridMinor], [major, this.gridMajor]] as const) {
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
        this.grid.add(new LineSegments(geometry, material));
      }
    }
    this.grid.visible = visible;
    this.requestRender();
  }

  private clearGrid(): void {
    for (const child of [...this.grid.children]) {
      this.grid.remove(child);
      (child as LineSegments).geometry.dispose();
    }
  }

  setMesh(mesh: Mesh | null, refit: boolean): void {
    if (this.disposed) return;
    this.clearModel();
    if (mesh) {
      const geometry = meshToGeometry(mesh);
      const material = new MeshStandardMaterial({ color: mesh.colors ? 0xffffff : MODEL_COLOR, vertexColors: !!mesh.colors, roughness: 0.55, metalness: 0.05 });
      this.model = new ThreeMesh(geometry, material);
      this.scene.add(this.model);
      if (refit) this.fit();
    }
    this.requestRender();
  }

  private clearModel(): void {
    if (!this.model) return;
    this.scene.remove(this.model);
    this.model.geometry.dispose();
    (this.model.material as MeshStandardMaterial).dispose();
    this.model = null;
  }

  private fit(): void {
    const sphere = this.model!.geometry.boundingSphere!;
    if (!(sphere.radius > 0)) return; // empty mesh: nothing to frame
    const dist = sphere.radius / Math.sin((this.camera.fov * Math.PI) / 360) * 1.15;
    const dir = new Vector3(0.6, -1, 0.75).normalize();
    this.controls.target.copy(sphere.center);
    this.camera.position.copy(sphere.center).addScaledVector(dir, dist);
    this.camera.near = dist / 100;
    this.camera.far = dist * 100;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  private requestRender(): void {
    if (this.disposed || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.renderer.render(this.scene, this.camera);
    });
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.observer.disconnect();
    this.controls.dispose();
    this.clearModel();
    this.clearGrid();
    this.gridMinor.dispose();
    this.gridMajor.dispose();
    this.renderer.forceContextLoss();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
