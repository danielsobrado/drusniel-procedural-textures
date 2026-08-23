import * as THREE from 'three';
import { EXPORT_CONFIG } from '../app/constants';
import { MaterialCompiler } from '../materials/MaterialCompiler';
import { applyPhysicalSettings } from '../materials/PhysicalMaterial';
import type { MaterialPreset, PhysicalSettings } from '../materials/types';

function flipRows(source: Uint8Array, size: number): Uint8ClampedArray<ArrayBuffer> {
  const rowBytes = size * 4;
  const result = new Uint8ClampedArray(new ArrayBuffer(source.length));
  for (let y = 0; y < size; y += 1) {
    const sourceOffset = (size - y - 1) * rowBytes;
    result.set(source.subarray(sourceOffset, sourceOffset + rowBytes), y * rowBytes);
  }
  return result;
}

function physicalVariantKey(settings: Readonly<PhysicalSettings>): string {
  return `${settings.sheen > 0 ? 'sheen' : 'no-sheen'}:${settings.transmission > 0 ? 'transmission' : 'opaque'}`;
}

export class PresetThumbnailRenderer {
  private readonly compilers = new Map<string, MaterialCompiler>();
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(32, 1, 0.05, 20);
  private readonly mesh: THREE.Mesh;
  private readonly target = new THREE.WebGLRenderTarget(
    EXPORT_CONFIG.thumbnailSize,
    EXPORT_CONFIG.thumbnailSize,
    { depthBuffer: true, stencilBuffer: false }
  );

  public constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly defaultPhysical: Readonly<PhysicalSettings>
  ) {
    const compiler = this.compilerFor(defaultPhysical);
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 72, 54),
      compiler.material
    );
    this.target.texture.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = new THREE.Color('#171a21');
    this.camera.position.set(0, 0.05, 3.25);
    this.camera.lookAt(0, 0, 0);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);

    const hemisphere = new THREE.HemisphereLight('#eef4ff', '#211b18', 1.35);
    const key = new THREE.DirectionalLight('#fff1dc', 3.4);
    key.position.set(-3, 4, 4);
    const fill = new THREE.DirectionalLight('#9bbfff', 1.05);
    fill.position.set(3, 1, 2);
    const rim = new THREE.DirectionalLight('#ff9d82', 1.1);
    rim.position.set(-2, -1, -3);
    this.scene.add(hemisphere, key, fill, rim);
  }

  public render(preset: MaterialPreset): string {
    this.prepare(preset);
    return this.capture();
  }

  public async renderAsync(preset: MaterialPreset): Promise<string> {
    this.prepare(preset);
    await this.renderer.compileAsync(this.scene, this.camera);
    return this.capture();
  }

  public dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.target.dispose();
    for (const compiler of this.compilers.values()) compiler.dispose();
    this.compilers.clear();
  }

  private compilerFor(settings: Readonly<PhysicalSettings>): MaterialCompiler {
    const key = physicalVariantKey(settings);
    const cached = this.compilers.get(key);
    if (cached !== undefined) return cached;

    const compiler = new MaterialCompiler();
    applyPhysicalSettings(compiler.material, settings);
    this.compilers.set(key, compiler);
    return compiler;
  }

  private prepare(preset: MaterialPreset): void {
    const physical: PhysicalSettings = {
      ...this.defaultPhysical,
      ...(preset.physical ?? {})
    };
    const compiler = this.compilerFor(physical);
    compiler.sync(preset.layers, preset.groups ?? [], false);
    applyPhysicalSettings(compiler.material, physical);
    this.mesh.material = compiler.material;
  }

  private capture(): string {
    const size = EXPORT_CONFIG.thumbnailSize;
    const pixels = new Uint8Array(size * size * 4);
    const previousTarget = this.renderer.getRenderTarget();
    const previousClearColor = this.renderer.getClearColor(new THREE.Color());
    const previousClearAlpha = this.renderer.getClearAlpha();

    try {
      this.renderer.setRenderTarget(this.target);
      this.renderer.setClearColor('#171a21', 1);
      this.renderer.clear(true, true, true);
      this.renderer.render(this.scene, this.camera);
      this.renderer.readRenderTargetPixels(this.target, 0, 0, size, size, pixels);
    } finally {
      this.renderer.setRenderTarget(previousTarget);
      this.renderer.setClearColor(previousClearColor, previousClearAlpha);
    }

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (context === null) {
      throw new Error('Browser does not provide a 2D canvas for material thumbnails.');
    }
    context.putImageData(new ImageData(flipRows(pixels, size), size, size), 0, 0);
    return canvas.toDataURL('image/png');
  }
}
