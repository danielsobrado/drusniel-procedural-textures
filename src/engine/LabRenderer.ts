import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { DEFAULT_BACKGROUND, RENDERER_CONFIG } from '../app/constants';
import type { ObjectPreset } from '../materials/types';
import { MaterialCompiler } from '../materials/MaterialCompiler';
import { createProceduralMesh } from './MeshFactory';
import {
  collectObjectMaterials,
  disposeMaterialResources,
  disposeObjectGeometries
} from './ObjectResources';

export class LabRenderer {
  public readonly canvas: HTMLCanvasElement;

  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(
    RENDERER_CONFIG.cameraFov,
    1,
    RENDERER_CONFIG.cameraNear,
    RENDERER_CONFIG.cameraFar
  );
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly resizeObserver: ResizeObserver;
  private readonly compiler: MaterialCompiler;
  private readonly environmentTarget: THREE.WebGLRenderTarget;
  private currentRoot: THREE.Object3D | null = null;
  private animationFrame = 0;

  public constructor(container: HTMLElement, compiler: MaterialCompiler) {
    this.compiler = compiler;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true
    });
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'lab-canvas';
    container.append(this.canvas);

    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = RENDERER_CONFIG.toneMappingExposure;
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, RENDERER_CONFIG.maxPixelRatio)
    );
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene.background = new THREE.Color(DEFAULT_BACKGROUND);

    const roomEnvironment = new RoomEnvironment();
    const environmentGenerator = new THREE.PMREMGenerator(this.renderer);
    this.environmentTarget = environmentGenerator.fromScene(roomEnvironment, 0.04);
    this.scene.environment = this.environmentTarget.texture;
    roomEnvironment.dispose();
    environmentGenerator.dispose();

    this.camera.position.fromArray(RENDERER_CONFIG.cameraPosition);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.065;
    this.controls.enablePan = true;
    this.controls.minDistance = RENDERER_CONFIG.minDistance;
    this.controls.maxDistance = RENDERER_CONFIG.maxDistance;

    this.addStudioLighting();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.start();
  }

  public setPrimitive(preset: ObjectPreset): void {
    const mesh = createProceduralMesh(preset, this.compiler.material);
    this.replaceRoot(mesh);
  }

  public setImported(root: THREE.Object3D): void {
    const replacedMaterials = collectObjectMaterials(root);

    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) {
        return;
      }

      if (
        object.geometry.getAttribute('position') !== undefined &&
        object.geometry.getAttribute('normal') === undefined
      ) {
        object.geometry.computeVertexNormals();
      }

      object.material = this.compiler.material;
      object.castShadow = true;
      object.receiveShadow = true;
    });

    disposeMaterialResources(replacedMaterials);
    this.replaceRoot(root);
  }

  public setBackground(color: string): void {
    this.scene.background = new THREE.Color(color);
  }

  public frameSelection(): void {
    if (this.currentRoot === null) {
      return;
    }

    const bounds = new THREE.Box3().setFromObject(this.currentRoot);
    if (bounds.isEmpty()) {
      return;
    }

    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(sphere.radius, 0.1);
    const halfFov = THREE.MathUtils.degToRad(this.camera.fov * 0.5);
    const distance = (radius / Math.tan(halfFov)) * 1.28;
    const direction = this.camera.position
      .clone()
      .sub(this.controls.target);

    if (direction.lengthSq() < 1e-8) {
      direction.set(0, 0, 1);
    } else {
      direction.normalize();
    }

    this.controls.target.copy(sphere.center);
    this.camera.position.copy(sphere.center).addScaledVector(direction, distance);
    this.camera.near = Math.max(distance / 100, 0.01);
    this.camera.far = Math.max(distance * 20, 50);
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  public resetView(): void {
    this.camera.position.fromArray(RENDERER_CONFIG.cameraPosition);
    this.controls.target.set(0, 0, 0);
    this.camera.near = RENDERER_CONFIG.cameraNear;
    this.camera.far = RENDERER_CONFIG.cameraFar;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.frameSelection();
  }

  public capturePng(): string {
    this.renderer.render(this.scene, this.camera);
    return this.canvas.toDataURL('image/png');
  }

  public dispose(): void {
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.disposeRoot(this.currentRoot);
    this.compiler.material.dispose();
    this.environmentTarget.dispose();
    this.renderer.dispose();
  }

  private addStudioLighting(): void {
    const hemisphere = new THREE.HemisphereLight('#edf4ff', '#231d1a', 1.2);
    this.scene.add(hemisphere);

    const key = new THREE.DirectionalLight('#fff3e4', 3.1);
    key.position.set(-3.5, 4.2, 4.5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.1;
    key.shadow.camera.far = 15;
    key.shadow.bias = -0.0002;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight('#b8d5ff', 1.15);
    fill.position.set(4, 1.5, 2.5);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight('#ffb18f', 1.35);
    rim.position.set(-2.5, -1, -4);
    this.scene.add(rim);
  }

  private replaceRoot(root: THREE.Object3D): void {
    if (this.currentRoot !== null) {
      this.scene.remove(this.currentRoot);
      this.disposeRoot(this.currentRoot);
    }

    this.currentRoot = root;
    this.scene.add(root);
    this.frameSelection();
  }

  private disposeRoot(root: THREE.Object3D | null): void {
    if (root !== null) {
      disposeObjectGeometries(root);
    }
  }

  private resize(): void {
    const parent = this.canvas.parentElement;
    if (parent === null) {
      return;
    }

    const width = Math.max(parent.clientWidth, 1);
    const height = Math.max(parent.clientHeight, 1);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private start(): void {
    const render = (): void => {
      this.animationFrame = requestAnimationFrame(render);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };

    render();
  }
}
