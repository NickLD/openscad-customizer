import {
  AmbientLight, Color, DirectionalLight, GridHelper, Material, Mesh as ThreeMesh, MeshStandardMaterial,
  PerspectiveCamera, Scene, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Mesh } from '../../mesh/off';
import { meshToGeometry } from './meshGeometry';

const MODEL_COLOR = 0xf9d72c; // OpenSCAD default

export class ThreeViewer {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(40, 1, 0.1, 10000);
  private controls: OrbitControls;
  private grid: GridHelper;
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
    this.grid = new GridHelper(200, 20);
    this.grid.rotation.x = Math.PI / 2; // XY plane
    this.scene.add(this.grid);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
  }

  setDark(dark: boolean): void {
    this.scene.background = new Color(dark ? 0x1b1d22 : 0xeef0f3);
    this.requestRender();
  }

  setMesh(mesh: Mesh | null, refit: boolean): void {
    if (this.disposed) return;
    this.clearModel();
    if (mesh) {
      const geometry = meshToGeometry(mesh);
      const material = new MeshStandardMaterial({ color: mesh.colors ? 0xffffff : MODEL_COLOR, vertexColors: !!mesh.colors, roughness: 0.55, metalness: 0.05 });
      this.model = new ThreeMesh(geometry, material);
      this.scene.add(this.model);
      const box = geometry.boundingBox!;
      if (Number.isFinite(box.min.z)) this.grid.position.z = box.min.z; // empty mesh has no finite box
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
    this.grid.geometry.dispose();
    (this.grid.material as Material).dispose();
    this.renderer.forceContextLoss();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
